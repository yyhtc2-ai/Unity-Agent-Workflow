import { existsSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { config, childEnv } from "../config.js";
import { ExecError, runCommand } from "../exec.js";
import { type AgentRunner, type RunOptions, type RunResult } from "../registry.js";

const POLICY =
  "[Codex delegation policy] Perform only the delegated, authorized technical work. " +
  "Do not perform or review visual design, select visual style/layout/colors, write image-generation prompts, " +
  "generate or edit images, or call image-generation tools. If requested, stop and report the restriction. " +
  "Implement an existing approved visual specification only; do not invent its design. " +
  "If required information is missing, stop and ask the supervising Codex agent. " +
  "Do not delegate to other agents or perform unrequested external actions.";

type StreamEvent = {
  type?: string;
  session_id?: string;
  role?: string;
  content?: string;
  tool_name?: string;
  status?: string;
  error?: { type?: string; message?: string; status?: number };
  message?: string;
};

export const codelyRunner: AgentRunner = {
  name: "codely",
  description:
    "Delegate bounded Unity coding, technical analysis or verification to Codely CLI. " +
    "Never delegate visual design or image generation. Provide an absolute project path, " +
    "a self-contained brief, allowed files and acceptance criteria.",
  defaults: {},
  supportsReasoning: false,
  supportsThinking: false,

  async run(task: string, opts: RunOptions): Promise<RunResult> {
    const entry = process.env.BRIDGE_CODELY_ENTRY;
    if (!entry || !existsSync(entry)) {
      throw new ExecError("Codely CLI entry is unavailable; check BRIDGE_CODELY_ENTRY.");
    }
    if (!opts.cwd || !opts.taskType) throw new ExecError("Project and task type are required.");

    const args = [entry, "--no-upm", "--agents=false", "--path-policy", "strict",
      "--output-format", "stream-json"];
    if (opts.taskType === "implementation") args.push("--approval-mode", "auto_edit");
    else args.push("--collaboration-mode", "ask");
    if (opts.sessionId) args.push("--resume-session", opts.sessionId);
    if (opts.model) args.push("--model", opts.model);
    // Fixed argument ensures headless mode; untrusted task text is sent via stdin,
    // not interpolated into a shell or command line.
    args.push("-p", "Complete the delegated task provided on standard input.");

    let sessionId: string | undefined;
    let resultStatus: string | undefined;
    let resultError: string | undefined;
    let answer = "";
    let truncated = false;
    let pending = "";
    let droppingLine = false;
    const cap = Math.max(1024, config.maxOutputBytes);
    const decoder = new StringDecoder("utf8");

    function eventLine(line: string): void {
      let event: StreamEvent;
      try { event = JSON.parse(line) as StreamEvent; } catch { return; }
      if (event.type === "init" && event.session_id) {
        sessionId = event.session_id;
        opts.onProgress?.({ sessionId, detail: "Codely session initialized" });
      } else if (event.type === "tool_use") {
        opts.onProgress?.({ detail: `Tool started: ${event.tool_name ?? "unknown"}` });
      } else if (event.type === "tool_result") {
        opts.onProgress?.({ detail: `Tool result: ${event.status ?? "unknown"}` });
      } else if (event.type === "message" && event.role === "assistant" && event.content) {
        if (answer.length < cap) answer += event.content.slice(0, cap - answer.length);
        if (answer.length >= cap) truncated = true;
        opts.onProgress?.({ detail: "Codely is responding" });
      } else if (event.type === "error") {
        resultError = event.message ?? resultError;
      } else if (event.type === "result") {
        resultStatus = event.status;
        resultError = event.error?.message ?? resultError;
        opts.onProgress?.({ detail: `Codely result: ${resultStatus ?? "unknown"}` });
      }
    }

    function consume(text: string): void {
      if (droppingLine) {
        const end = text.indexOf("\n");
        if (end < 0) return;
        text = text.slice(end + 1);
        droppingLine = false;
      }
      pending += text;
      for (;;) {
        const end = pending.indexOf("\n");
        if (end < 0) break;
        const line = pending.slice(0, end);
        pending = pending.slice(end + 1);
        if (line.length > cap) truncated = true;
        else eventLine(line);
      }
      if (pending.length > cap) {
        pending = "";
        droppingLine = true;
        truncated = true;
      }
    }

    let result;
    try {
      result = await runCommand(process.execPath, args, {
        cwd: opts.cwd,
        env: { ...childEnv(opts.depth), NO_BROWSER: "1" },
        timeoutMs: opts.timeoutMs ?? config.timeoutMs,
        maxOutputBytes: config.maxOutputBytes,
        stdin: `${POLICY}\n\n${task}`,
        signal: opts.signal,
        direct: true,
        onSpawn: opts.onSpawn,
        onStdoutChunk: (chunk) => consume(decoder.write(chunk)),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new ExecError(`${message}${sessionId ? ` [session: ${sessionId}]` : ""}`);
    }
    consume(decoder.end());
    if (pending && !droppingLine) eventLine(pending);

    if (result.code !== 0 || resultStatus !== "success") {
      const message = resultError || result.stderr.slice(-2000) || "unknown error";
      throw new ExecError(
        `Codely failed (exit ${result.code}, result ${resultStatus ?? "missing"}): ${message}` +
          (sessionId ? ` [session: ${sessionId}]` : ""), result,
      );
    }
    return { text: answer, sessionId, truncated: truncated || result.truncated };
  },
};
