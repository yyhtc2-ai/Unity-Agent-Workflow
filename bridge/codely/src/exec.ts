import { spawn } from "node:child_process";
import { debug } from "./debug.js";

export interface ExecOptions {
  cwd?: string;
  /** Extra environment variables merged over process.env. */
  env?: Record<string, string>;
  /** Hard timeout in milliseconds; the child is killed when exceeded. */
  timeoutMs: number;
  /** Max bytes of stdout/stderr to retain (protects the caller's context). */
  maxOutputBytes: number;
  /** Optional string written to the child's stdin, then closed. */
  stdin?: string;
  /** Optional abort signal; aborting kills the child (used by cancel_job). */
  signal?: AbortSignal;
  /** Run a native executable directly, even on Windows. */
  direct?: boolean;
  onSpawn?: (pid: number) => void;
  onStdoutChunk?: (chunk: Buffer) => void;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** True if the process was killed because it exceeded timeoutMs. */
  timedOut: boolean;
  /** True if stdout was truncated at maxOutputBytes. */
  truncated: boolean;
}

export class ExecError extends Error {
  constructor(message: string, readonly result?: ExecResult) {
    super(message);
    this.name = "ExecError";
  }
}

/**
 * Spawn a command with an args array (never a shell string) so arbitrary task
 * text cannot be interpreted by the shell. Enforces a timeout and an output cap.
 *
 * On Windows, `.cmd` shims (npm-installed CLIs) are not directly executable by
 * spawn without a shell, so we resolve the actual command up front via PATHEXT.
 */
export function runCommand(
  command: string,
  args: string[],
  opts: ExecOptions,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    // On Windows, .cmd/.bat shims require shell:true to be invoked. We keep the
    // args array form so values are still passed as discrete argv entries.
    const isWindows = process.platform === "win32";

    debug(
      `spawn command=${command} args=${JSON.stringify(args)} cwd=${opts.cwd ?? "(inherit)"} ` +
        `shell=${isWindows} PATH_present=${Boolean(process.env.PATH || process.env.Path)}`,
    );

    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env },
      shell: isWindows && !opts.direct, // npm .cmd shims need a shell; native Node does not
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let callbackError: Error | undefined;
    let truncated = false;
    let timedOut = false;
    let cancelled = false;
    let settled = false;

    const cap = opts.maxOutputBytes;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    const onAbort = () => {
      cancelled = child.kill("SIGKILL");
    };
    if (opts.signal) {
      if (opts.signal.aborted) onAbort();
      else opts.signal.addEventListener("abort", onAbort, { once: true });
    }

    // A child can exit or be cancelled before consuming stdin. Handle EPIPE so
    // one failed job cannot crash the entire bridge process.
    child.stdin.on("error", (err) => debug(`child stdin error: ${err.message}`));
    // Also provide EOF when the prompt is supplied only through argv.
    child.stdin.end(opts.stdin);

    child.stdout.on("data", (chunk: Buffer) => {
      try { opts.onStdoutChunk?.(chunk); }
      catch (err) {
        callbackError = err instanceof Error ? err : new Error(String(err));
        child.kill("SIGKILL");
      }
      const remaining = Math.max(0, cap - stdoutBytes);
      const kept = chunk.subarray(0, remaining);
      stdout += kept.toString("latin1");
      stdoutBytes += kept.length;
      if (chunk.length > remaining) truncated = true;
    });

    child.stderr.on("data", (chunk: Buffer) => {
      const kept = chunk.subarray(0, Math.max(0, cap - stderrBytes));
      stderr += kept.toString("latin1");
      stderrBytes += kept.length;
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      debug(`child error for ${command}: ${(err as Error).message}`);
      // ENOENT => binary missing; surface a clear, actionable message.
      const hint =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? ` (is "${command}" installed and on PATH?)`
          : "";
      reject(new ExecError(`Failed to launch "${command}"${hint}: ${err.message}`));
    });

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      debug(
        `child close ${command} code=${code} stdoutLen=${stdout.length} ` +
          `stderrTail=${JSON.stringify(stderr.slice(-300))}`,
      );
      opts.signal?.removeEventListener("abort", onAbort);
      const decode = (s: string) => new TextDecoder("utf-8").decode(Buffer.from(s, "latin1"), { stream: true });
      const result: ExecResult = { code, stdout: decode(stdout), stderr: decode(stderr), timedOut, truncated };
      if (callbackError) {
        reject(new ExecError(`CLI output handler failed: ${callbackError.message}`, result));
        return;
      }
      if (cancelled) {
        reject(new ExecError(`"${command}" was cancelled`, result));
        return;
      }
      if (timedOut) {
        reject(
          new ExecError(
            `"${command}" timed out after ${opts.timeoutMs}ms`,
            result,
          ),
        );
        return;
      }
      resolve(result);
    });
    try { if (child.pid !== undefined) opts.onSpawn?.(child.pid); }
    catch (err) {
      callbackError = err instanceof Error ? err : new Error(String(err));
      child.kill("SIGKILL");
    }
  });
}
