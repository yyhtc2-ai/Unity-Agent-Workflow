#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { realpathSync, statSync } from "node:fs";
import { isAbsolute } from "node:path";

import { config } from "./config.js";
import {
  type AgentRunner,
  exposedRunners,
  register,
} from "./registry.js";
import { answerPath, createJob, getJob, listJobs, ownsJob, recoverJob, releaseProject, saveJob, type Job } from "./jobs.js";
import { utf8Prefix } from "./limits.js";
import { debug } from "./debug.js";
import { codelyRunner } from "./runners/codely.js";

// --- Register all available agents. Adding a new backend = one more line. ---
register(codelyRunner);

function buildInputShape(runner: AgentRunner) {
  const shape: Record<string, z.ZodTypeAny> = {
    task: z
      .string()
      .min(1)
      .describe("The full task or question to delegate to this agent."),
    cwd: z
      .string()
      .min(1)
      .describe("Required absolute project or worktree directory."),
    task_type: z
      .enum(["implementation", "analysis", "verification"])
      .describe("Technical work only. Visual design and image generation must never be delegated."),
    session_id: z
      .string()
      .optional()
      .describe("Resume this exact Codely session ID in the same project directory."),
    model: z
      .string()
      .optional()
      .describe("Override the model id for this call (omit to use the default)."),
    background: z
      .boolean()
      .default(true)
      .describe(
        "Run as a background job: returns a job id immediately instead of " +
          "blocking. Poll it with check_job; the agent keeps working meanwhile. " +
        "Defaults to true so progress can be checked without blocking.",
      ),
  };
  if (runner.supportsReasoning) {
    shape.reasoning = z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("Reasoning/effort level.");
  }
  if (runner.supportsThinking) {
    shape.thinking = z
      .enum(["off", "think", "think_hard", "ultrathink"])
      .optional()
      .describe("Extended-thinking level (off = none, ultrathink = maximum).");
  }
  return shape;
}

/**
 * Headless CLIs instruct their model that nobody is present, so an ambiguous
 * task gets a silent best guess. This preamble corrects that assumption: the
 * caller is an agent that CAN answer follow-ups via session resume. Prepended
 * only on fresh sessions (a resumed session already saw it).
 */
const CLARIFY_PREAMBLE =
  "[qantara] You were delegated this task by another AI agent, which can " +
  "answer follow-up questions. If the task is ambiguous or missing information " +
  "you need, do NOT guess: reply with your specific questions instead of doing " +
  "the work, and the caller will resume this session with answers.";

function formatResult(
  agentName: string,
  text: string,
  sessionId?: string,
  cost?: number,
  truncated?: boolean,
): string {
  const footer: string[] = [];
  if (sessionId) footer.push(`session: ${sessionId}`);
  if (typeof cost === "number") footer.push(`cost: $${cost.toFixed(4)}`);
  if (truncated) footer.push("output truncated");
  const meta = footer.length ? `\n\n---\n[${agentName}] ${footer.join(" | ")}` : "";
  return `${text}${meta}`;
}

/**
 * Job notices: the bridge cannot speak first (MCP servers only answer), so
 * "your background job finished" reminders ride along on whatever answer is
 * already being returned. A job stops generating notices once its full
 * result has been delivered (job.delivered).
 */
function jobNotices(): string {
  const lines = listJobs()
    .filter((j) => !j.delivered && ["done", "incomplete", "failed", "interrupted"].includes(j.status)).slice(0, 4)
    .map((j) => {
      const ago = Math.round((Date.now() - (j.finishedAt ?? Date.now())) / 1000);
      return (
        `[qantara] notice: background job "${j.id}" (${j.agent}) ` +
        `${j.status === "done" ? "finished" : "FAILED"} ${ago}s ago and is ` +
        `unread — call check_job with job_id "${j.id}".`
      );
    });
  return lines.length ? `\n\n${lines.join("\n")}` : "";
}

function textResult(text: string, isError = false, notices = true) {
  const suffix = notices ? jobNotices() : "";
  return {
    ...(isError ? { isError: true } : {}),
    content: [{ type: "text" as const, text: utf8Prefix(`${text}${suffix}`, config.maxOutputBytes) }],
  };
}

function elapsedSec(job: Job): number {
  return Math.round(((job.finishedAt ?? Date.now()) - job.startedAt) / 1000);
}

/** Shared status→response logic for check_job and wait_job. */
function jobStatusText(job: Job) {
  switch (job.status) {
    case "running":
      return textResult(
        `Job "${job.id}" (${job.agent}) is still running (${elapsedSec(job)}s elapsed). ` +
          `${job.sessionId ? `Session: ${job.sessionId}. ` : ""}` +
          `${job.pid ? `PID: ${job.pid}. ` : ""}` +
          `${job.progress ? `Latest: ${job.progress}. ` : ""}Check again later.`,
      );
    case "cancelling":
      return textResult(`Cancellation requested for job "${job.id}"; waiting for the child process to exit.`);
    case "incomplete":
    case "done":
      job.delivered = true;
      saveJob(job);
      return textResult(
        `Job "${job.id}" (${job.agent}) ${job.status === "incomplete" ? "has an incomplete response" : "finished"} in ${elapsedSec(job)}s. ` +
          `${job.result?.resultPath ? `Answer artifact: ${job.result.resultPath}. ` : ""}` +
          `${job.status === "incomplete" ? "output truncated; CLI success is not acceptance. " : ""}\n\n` +
          formatResult(
            job.agent,
            job.result!.text,
            job.result!.sessionId,
            job.result!.cost,
            job.result!.truncated,
          ),
        job.status === "incomplete",
      );
    case "interrupted":
      return textResult(`Job "${job.id}" is interrupted. ${job.error} CLI PID: ${job.pid ?? "not recorded"}. ` +
        `After verifying no writers remain, use recover_job with explicit confirmation and evidence.`, true);
    case "failed":
      job.delivered = true;
      saveJob(job);
      return textResult(
        `Job "${job.id}" (${job.agent}) failed after ${elapsedSec(job)}s: ${job.error}`,
        true,
      );
    case "cancelled":
      return textResult(`Job "${job.id}" (${job.agent}) was cancelled after the direct CLI process exited. ` +
        `${job.sessionId ? `Session: ${job.sessionId}. ` : ""}` +
        `Inspect partial changes and any child descendants before retrying.`);
  }
}

function jobStatusResult(job: Job) {
  return { ...jobStatusText(job), structuredContent: {
    job_id: job.id, status: job.status, cwd: job.cwd, pid: job.pid, session_id: job.sessionId,
    result_path: job.result?.resultPath, response_truncated: job.result?.truncated ?? false,
    artifact_truncated: job.result?.artifactTruncated ?? false,
    execution_success: job.status === "done" || job.status === "incomplete",
    independent_acceptance: false,
  } };
}

async function main() {
  const server = new McpServer({
    name: "qantara-codely",
    version: "0.3.0",
  }, {
    instructions: "Codex decides and independently verifies; Codely only handles bounded technical work. " +
      "Never delegate visual design, visual review, image generation or image editing to Codely. " +
      "Supply an absolute project path, scope and acceptance criteria. Use background jobs and collect their results. " +
      "Execution snapshots and project leases are shared through the local state directory. Never replay interrupted jobs automatically.",
  });

  const runners = exposedRunners([...config.expose]);

  for (const runner of runners) {
    server.tool(
      `ask_${runner.name}`,
      runner.description,
      buildInputShape(runner),
      async (args: any) => {
        debug(`tool ask_${runner.name} invoked: ${JSON.stringify(args).slice(0, 300)}`);
        // --- Depth / fan-out guard: refuse if we're already too deep. ---
        if (config.depth >= config.maxDepth) {
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text:
                  `Refused: qantara recursion depth ${config.depth} has reached ` +
                  `the limit (BRIDGE_MAX_DEPTH=${config.maxDepth}). ` +
                  `This prevents runaway agent-to-agent loops.`,
              },
            ],
          };
        }

        let project: string;
        try {
          if (!isAbsolute(args.cwd)) throw new Error("Project path must be absolute");
          project = realpathSync(args.cwd);
          if (!statSync(project).isDirectory()) throw new Error("Project path must be a directory");
        } catch (err) {
          return textResult(`Invalid project: ${err instanceof Error ? err.message : String(err)}`, true);
        }
        const projectKey = process.platform === "win32" ? project.toLowerCase() : project;
        const sessionId = args.session_id;

        // A resumed session already saw the preamble on its first turn.
        const task =
          config.clarify && !sessionId
            ? `${CLARIFY_PREAMBLE}\n\n${args.task}`
            : args.task;

        const runOpts = {
          cwd: project,
          sessionId,
          model: args.model,
          reasoning: args.reasoning,
          thinking: args.thinking,
          taskType: args.task_type,
          depth: config.depth,
        };

        let job: Job;
        try { job = createJob(runner.name, args.task, projectKey); }
        catch (err) { return textResult(err instanceof Error ? err.message : String(err), true); }
        job.completion = (async () => {
          try {
            const res = await runner.run(task, {
              ...runOpts, outputPath: answerPath(job),
              timeoutMs: args.background ? config.jobTimeoutMs : config.timeoutMs,
              signal: job.abort!.signal,
              onSpawn: (pid) => { job.pid = pid; saveJob(job); },
              onProgress: (event) => {
                if (event.sessionId) job.sessionId = event.sessionId;
                if (event.detail) job.progress = event.detail;
                saveJob(job);
              },
            });
            job.status = res.truncated ? "incomplete" : "done";
            job.result = res;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            job.status = job.status === "cancelling" && message.includes("was cancelled") ? "cancelled" : "failed";
            job.error = message;
          } finally {
            job.finishedAt = Date.now();
            try { saveJob(job); releaseProject(job); }
            catch (err) {
              job.status = "failed";
              job.error = `Execution state could not be finalized; inspect retained lease: ${err}`;
              process.stderr.write(`${job.error}\n`);
              try { saveJob(job); } catch { /* keep lease and fail closed */ }
            }
          }
        })();
        if (args.background) {
          debug(`job ${job.id} started`);
          return { ...textResult(
            `Started background job "${job.id}" (${runner.name}). It runs while you ` +
              `continue working. Poll it with check_job (job_id: "${job.id}"), or — ` +
              `when you have no other work left — call wait_job to block until it ` +
              `finishes. ${job.pid ? `PID: ${job.pid}. ` : ""}` +
              `Cancel with cancel_job. Execution snapshots survive restart; interrupted work is never replayed.`,
          ), structuredContent: { job_id: job.id, status: job.status, pid: job.pid, cwd: job.cwd } };
        }
        await job.completion;
        return jobStatusResult(job);
      },
    );
  }

  if (runners.length > 0) {
    server.tool(
      "check_job",
      "Check background delegation jobs started with ask_*'s background option. " +
        "With job_id: returns status, and the agent's full result once finished. " +
        "Without job_id: lists all jobs of this session.",
      {
        job_id: z
          .string()
          .optional()
          .describe("The job id returned when the job was started. Omit to list all jobs."),
      },
      async (args: any) => {
        if (!args.job_id) {
          const all = listJobs();
          if (all.length === 0) return textResult("No background jobs in this session.");
          const lines = all.map(
            (j) =>
              `${j.id} | ${j.agent} | ${j.status} | ${elapsedSec(j)}s | ${j.taskSummary}`,
          );
          // The list is itself a status overview; notices would be redundant.
          return textResult(lines.join("\n"), false, false);
        }
        const job = getJob(args.job_id);
        if (!job) {
          return textResult(
            `No job "${args.job_id}". Call check_job without job_id to list jobs.`,
            true,
          );
        }
        return jobStatusResult(job);
      },
    );

    server.tool(
      "wait_job",
      "Wait for a background delegation job to finish, then return its full " +
        "result — the reliable way to collect a job once you have no other " +
        "work to do (no polling loop to forget). Blocks up to 45 seconds per " +
        "call; if it returns still-running, simply call wait_job again.",
      {
        job_id: z.string().describe("The job id to wait for."),
      },
      async (args: any) => {
        const job = getJob(args.job_id);
        if (!job) {
          return textResult(
            `No job "${args.job_id}". Call check_job without job_id to list jobs.`,
            true,
          );
        }
        if ((job.status === "running" || job.status === "cancelling") && job.completion) {
          await Promise.race([
            job.completion,
            new Promise((resolve) => {
              const timer = setTimeout(resolve, Math.min(config.waitCapMs, 45_000));
              timer.unref();
            }),
          ]);
        }
        return jobStatusResult(job);
      },
    );

    server.tool(
      "cancel_job",
      "Cancel a running background delegation job (kills the delegated agent).",
      {
        job_id: z.string().describe("The job id to cancel."),
      },
      async (args: any) => {
        const job = getJob(args.job_id);
        if (!job) return textResult(`No job "${args.job_id}".`, true);
        if (job.status !== "running") {
          return textResult(`Job "${job.id}" is already ${job.status}.`);
        }
        if (!ownsJob(job) || !job.abort) return textResult("Job belongs to another bridge instance; cancel it through its live owner or reconcile it after interruption.", true);
        job.status = "cancelling";
        saveJob(job);
        job.abort.abort();
        debug(`job ${job.id} cancellation requested`);
        return textResult(`Cancellation requested for job "${job.id}". Check its status; child descendants may need separate inspection.`);
      },
    );
  }

  server.tool("recover_job", "Reconcile an interrupted execution after inspecting the CLI, descendants and partial changes. Does not replay work or accept the task.", {
    job_id: z.string(), confirm_no_writers: z.literal(true), evidence: z.string().min(1).max(2000),
  }, async (args) => {
    try { return jobStatusResult(recoverJob(args.job_id, args.evidence)); }
    catch (err) { return textResult(err instanceof Error ? err.message : String(err), true); }
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return; shuttingDown = true;
    const own = listJobs().filter(j => ownsJob(j) && j.abort && ["running", "cancelling"].includes(j.status));
    for (const job of own) { job.status = "cancelling"; saveJob(job); job.abort!.abort(); }
    await Promise.all(own.map(j => j.completion));
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
  process.stdin.once("end", () => void shutdown());

  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Announce readiness on stderr (stdout is reserved for the MCP protocol).
  const names = runners.map((r) => `ask_${r.name}`).join(", ");
  process.stderr.write(
    `qantara ready (depth ${config.depth}/${config.maxDepth}); tools: ${names || "none"}\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`qantara fatal: ${err?.stack ?? err}\n`);
  process.exit(1);
});
