import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { z } from "zod";
import { replaceFile } from "./atomic-file.js";

const Status = z.enum(["running", "cancelling", "done", "incomplete", "failed", "cancelled", "interrupted"]);
const Result = z.object({ text: z.string(), sessionId: z.string().optional(), cost: z.number().optional(),
  truncated: z.boolean().optional(), resultPath: z.string().optional(), artifactTruncated: z.boolean().optional() });
const Record = z.object({
  id: z.string().regex(/^codely-[0-9a-f-]{36}$/), agent: z.literal("codely"), taskSummary: z.string(),
  status: Status, startedAt: z.number(), finishedAt: z.number().optional(), result: Result.optional(),
  error: z.string().optional(), delivered: z.boolean().optional(), cwd: z.string(),
  pid: z.number().int().positive().optional(), sessionId: z.string().optional(), progress: z.string().optional(),
  bridgePid: z.number().int().positive(), instanceId: z.string(), leaseToken: z.string(),
  recoveryEvidence: z.string().optional(),
});
export interface Job extends z.infer<typeof Record> {
  abort?: AbortController;
  completion?: Promise<void>;
}
const instanceId = randomUUID();
const configured = process.env.BRIDGE_STATE_DIR;
if (configured && !isAbsolute(configured)) throw new Error("BRIDGE_STATE_DIR must be absolute");
export const stateDir = resolve(configured ?? join(process.env.CODEX_HOME ?? join(homedir(), ".codex"), "codely-bridge"));
for (const dir of [stateDir, join(stateDir, "jobs"), join(stateDir, "locks"), join(stateDir, "answers")]) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
}
const local = new Map<string, Job>();
const jobFile = (id: string) => join(stateDir, "jobs", `${id}.json`);
const lockFile = (cwd: string) => join(stateDir, "locks", `${createHash("sha256").update(cwd).digest("hex")}.json`);
export const answerPath = (job: Job) => join(stateDir, "answers", `${job.id}.txt`);
export function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as NodeJS.ErrnoException).code !== "ESRCH"; }
}
export const ownsJob = (job: Job) => job.instanceId === instanceId;

/** Atomic snapshots are execution evidence, not a second task-contract lifecycle. */
export function saveJob(job: Job): void {
  const record = Record.parse(job);
  const path = jobFile(job.id), temp = `${path}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temp, JSON.stringify(record), { flag: "wx", mode: 0o600 });
    replaceFile(temp, path);
  } finally { if (existsSync(temp)) unlinkSync(temp); }
}
export function releaseProject(job: Job): void {
  const path = lockFile(job.cwd);
  if (!existsSync(path)) return;
  const owner = JSON.parse(readFileSync(path, "utf8"));
  if (owner.jobId !== job.id || owner.leaseToken !== job.leaseToken) throw new Error("Project lease ownership changed; refusing release");
  unlinkSync(path);
}
export function createJob(agent: string, task: string, cwd: string): Job {
  if (agent !== "codely") throw new Error("Only Codely is supported");
  const job: Job = {
    id: `codely-${randomUUID()}`, agent, taskSummary: task.split("\n")[0].slice(0, 120),
    status: "running", startedAt: Date.now(), abort: new AbortController(), cwd,
    bridgePid: process.pid, instanceId, leaseToken: randomUUID(),
  };
  try {
    writeFileSync(lockFile(cwd), JSON.stringify({ jobId: job.id, leaseToken: job.leaseToken }), { flag: "wx", mode: 0o600 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "EEXIST") {
      let owner = "unknown (inspect the local lock record)";
      try { owner = JSON.parse(readFileSync(lockFile(cwd), "utf8")).jobId ?? owner; } catch { /* fail closed */ }
      throw new Error(`Project already has an active or unresolved job: ${owner}. Inspect it; never auto-replay.`);
    }
    throw err;
  }
  try { saveJob(job); } catch (err) { releaseProject(job); throw err; }
  local.set(job.id, job);
  return job;
}
export function getJob(id: string): Job | undefined {
  if (!/^codely-[0-9a-f-]{36}$/.test(id)) return undefined;
  const active = local.get(id);
  if (active) return active;
  if (!existsSync(jobFile(id))) return undefined;
  const job = Record.parse(JSON.parse(readFileSync(jobFile(id), "utf8")));
  if ((job.status === "running" || job.status === "cancelling") && !isAlive(job.bridgePid)) {
    job.status = "interrupted";
    job.error = "Owning bridge exited. Inspect CLI PID, descendants, session and partial changes before recovery; lease retained.";
  }
  return job;
}
export function listJobs(): Job[] {
  return readdirSync(join(stateDir, "jobs")).filter(n => n.endsWith(".json"))
    .map(n => getJob(n.slice(0, -5))).filter((j): j is Job => !!j)
    .sort((a, b) => b.startedAt - a.startedAt);
}
/** Never kill an arbitrary saved PID or replay a task after a restart. */
export function recoverJob(id: string, evidence: string): Job {
  const job = getJob(id);
  if (!job) throw new Error("No such persisted job");
  if (isAlive(job.bridgePid)) throw new Error("Owning bridge is still alive; recovery refused");
  if (job.pid && isAlive(job.pid)) throw new Error("Recorded CLI PID is still alive; recovery refused");
  if (job.status !== "interrupted") throw new Error("Only an interrupted job can be recovered");
  job.status = "failed"; job.finishedAt = Date.now();
  job.error = "Interrupted execution reconciled; not replayed. Independent acceptance remains the host's responsibility.";
  job.recoveryEvidence = evidence;
  saveJob(job); releaseProject(job);
  return job;
}
