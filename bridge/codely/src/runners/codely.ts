import { appendFileSync, existsSync, writeFileSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { z } from "zod";
import { config, childEnv } from "../config.js";
import { ExecError, runCommand } from "../exec.js";
import { utf8Prefix } from "../limits.js";
import { type AgentRunner, type RunOptions, type RunResult } from "../registry.js";

const POLICY =
  "[Codex delegation policy] Perform only the delegated, authorized technical work. " +
  "Do not perform or review visual design, select visual style/layout/colors, write image-generation prompts, " +
  "generate or edit images, or call image-generation tools. If requested, stop and report the restriction. " +
  "Implement an existing approved visual specification only; do not invent its design. " +
  "If required information is missing, stop and ask the supervising Codex agent. " +
  "Do not delegate to other agents or perform unrequested external actions.";

// Below the Windows native command-line limit, including CLI/policy overhead.
// Never silently fall back to stdin: nightly.71 ignored that input in real tests.
export const MAX_PROMPT_BYTES = 24_000;
const Event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("init"), session_id: z.string().min(1) }),
  z.object({ type: z.literal("tool_use"), tool_name: z.string().optional() }),
  z.object({ type: z.literal("tool_result"), status: z.string().optional() }),
  z.object({ type: z.literal("message"), role: z.string(), content: z.string().optional() }),
  z.object({ type: z.literal("error"), message: z.string().optional() }),
  z.object({ type: z.literal("result"), status: z.enum(["success", "error"]),
    error: z.object({ message: z.string().optional() }).optional() }),
]);
const knownTypes = new Set(["init", "tool_use", "tool_result", "message", "error", "result"]);

export const codelyRunner: AgentRunner = {
  name: "codely",
  description: "Delegate bounded technical work to Codely CLI. Never delegate visual design or image generation. " +
    "Provide an absolute project path, a self-contained brief, allowed files and acceptance criteria.",
  defaults: {}, supportsReasoning: false, supportsThinking: false,

  async run(task: string, opts: RunOptions): Promise<RunResult> {
    const entry = process.env.BRIDGE_CODELY_ENTRY;
    if (!entry || !existsSync(entry)) throw new ExecError("Codely CLI entry is unavailable; check BRIDGE_CODELY_ENTRY.");
    if (!opts.cwd || !opts.taskType) throw new ExecError("Project and task type are required.");
    const prompt = `${POLICY}\n\n${task}`;
    if (prompt.includes("\0") || Buffer.byteLength(prompt) > MAX_PROMPT_BYTES) {
      throw new ExecError(`Task plus policy must be NUL-free and at most ${MAX_PROMPT_BYTES} UTF-8 bytes. Split the task; nothing was dispatched.`);
    }
    const args = [entry, "--no-upm", "--agents=false", "--path-policy", "strict", "--output-format", "stream-json"];
    if (opts.taskType === "implementation") args.push("--approval-mode", "auto_edit");
    else args.push("--collaboration-mode", "ask");
    if (opts.sessionId) args.push("--resume-session", opts.sessionId);
    if (opts.model) args.push("--model", opts.model);
    // Native Node spawn, shell:false. Punctuation is data, not shell code.
    args.push("-p", prompt);
    // Quotes/backslashes can expand when libuv builds a Windows command line.
    const worstCaseCommandLength = args.reduce((n, arg) => n + 3 + arg.length +
      (arg.match(/["\\]/g)?.length ?? 0), process.execPath.length + 3);
    if (process.platform === "win32" && worstCaseCommandLength > 30_000) {
      throw new ExecError("Native command line too long after escaping. Split the task; nothing was dispatched.");
    }

    let sessionId: string | undefined, resultStatus: string | undefined, resultError: string | undefined;
    let protocolError: string | undefined;
    let answer = "", answerBytes = 0, artifactBytes = 0;
    let truncated = false, artifactTruncated = false, pending = "", droppingLine = false;
    const decoder = new StringDecoder("utf8");
    if (opts.outputPath) writeFileSync(opts.outputPath, "", { flag: "wx", mode: 0o600 });

    function eventLine(line: string): void {
      let raw: unknown;
      try { raw = JSON.parse(line); } catch { return; } // non-JSON startup diagnostics
      if (raw && typeof raw === "object" && !Array.isArray(raw) &&
          typeof (raw as { type?: unknown }).type === "string" &&
          !knownTypes.has((raw as { type: string }).type)) return;
      const parsed = Event.safeParse(raw);
      if (!parsed.success) { protocolError = "Invalid Codely stream event shape"; return; }
      const event = parsed.data;
      if (event.type === "init") {
        sessionId = event.session_id;
        opts.onProgress?.({ sessionId, detail: "Codely session initialized" });
      } else if (event.type === "tool_use") opts.onProgress?.({ detail: `Tool started: ${event.tool_name ?? "unknown"}` });
      else if (event.type === "tool_result") opts.onProgress?.({ detail: `Tool result: ${event.status ?? "unknown"}` });
      else if (event.type === "message" && event.role === "assistant" && event.content) {
        const kept = utf8Prefix(event.content, Math.max(0, config.maxOutputBytes - answerBytes));
        answer += kept; answerBytes += Buffer.byteLength(kept);
        if (kept !== event.content) truncated = true;
        if (opts.outputPath) {
          const full = utf8Prefix(event.content, Math.max(0, config.maxArtifactBytes - artifactBytes));
          appendFileSync(opts.outputPath, full, "utf8"); artifactBytes += Buffer.byteLength(full);
          if (full !== event.content) artifactTruncated = true;
        }
        opts.onProgress?.({ detail: "Codely is responding" });
      } else if (event.type === "error") resultError = event.message ?? resultError;
      else if (event.type === "result") {
        resultStatus = event.status; resultError = event.error?.message ?? resultError;
        opts.onProgress?.({ detail: `Codely result: ${resultStatus}` });
      }
    }
    function consume(text: string): void {
      if (droppingLine) {
        const end = text.indexOf("\n"); if (end < 0) return;
        text = text.slice(end + 1); droppingLine = false;
      }
      pending += text;
      for (;;) {
        const end = pending.indexOf("\n"); if (end < 0) break;
        const line = pending.slice(0, end); pending = pending.slice(end + 1);
        if (Buffer.byteLength(line) > config.maxEventBytes) protocolError = "Codely event exceeds BRIDGE_MAX_EVENT_BYTES";
        else if (line.trim()) eventLine(line);
      }
      if (Buffer.byteLength(pending) > config.maxEventBytes) {
        pending = ""; droppingLine = true;
        protocolError = "Codely event exceeds BRIDGE_MAX_EVENT_BYTES";
      }
    }
    let result;
    try {
      result = await runCommand(process.execPath, args, {
        cwd: opts.cwd, env: { ...childEnv(opts.depth), NO_BROWSER: "1" },
        timeoutMs: opts.timeoutMs ?? config.timeoutMs, maxOutputBytes: config.maxOutputBytes,
        signal: opts.signal, direct: true, onSpawn: opts.onSpawn,
        onStdoutChunk: (chunk) => consume(decoder.write(chunk)),
      });
    } catch (err) {
      throw new ExecError(`${err instanceof Error ? err.message : String(err)}${sessionId ? ` [session: ${sessionId}]` : ""}`);
    }
    consume(decoder.end());
    if (pending && !droppingLine) eventLine(pending);
    if (protocolError || result.code !== 0 || resultStatus !== "success" || !answer) {
      const message = protocolError || resultError || (!answer && resultStatus === "success" ? "Missing assistant response" : result.stderr.slice(-2000)) || "unknown error";
      throw new ExecError(`Codely failed (exit ${result.code}, result ${resultStatus ?? "missing"}): ${message}` +
        (sessionId ? ` [session: ${sessionId}]` : ""), result);
    }
    return { text: answer, sessionId, truncated: truncated || artifactTruncated,
      resultPath: opts.outputPath, artifactTruncated };
  },
};
