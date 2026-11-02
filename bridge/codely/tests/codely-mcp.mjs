import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const project = mkdtempSync(join(tmpdir(), "qantara-codely-project-"));
const another = mkdtempSync(join(tmpdir(), "qantara-codely-other-"));
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve("dist/server.js")],
  env: { ...process.env, BRIDGE_EXPOSE: "codely", BRIDGE_CODELY_ENTRY: resolve("tests/fake-codely.mjs"),
    BRIDGE_STATE_DIR: mkdtempSync(join(tmpdir(), "codely-test-state-")), BRIDGE_WAIT_CAP_MS: "700", BRIDGE_JOB_TIMEOUT_MS: "1300", BRIDGE_MAX_OUTPUT_BYTES: "2048" },
  stderr: "pipe",
});
const client = new Client({ name: "codely-bridge-test", version: "1.0.0" });
const text = (r) => r.content?.map((c) => c.text || "").join("\n") || "";
const call = (name, args) => client.callTool({ name, arguments: args });

try {
  await client.connect(transport);
  assert.match(client.getInstructions(), /Never delegate visual design/);
  assert.match(client.getInstructions(), /image generation/);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["ask_codely", "cancel_job", "check_job", "recover_job", "wait_job"]);

  for (const type of ["visual_design", "image_generation"]) {
    let rejected = false;
    try {
      const r = await call("ask_codely", { cwd: project, task_type: type, task: "test" });
      rejected = !!r.isError;
    } catch { rejected = true; }
    assert.equal(rejected, true, `${type} must be rejected`);
  }

  const missingPath = await call("ask_codely", { cwd: "relative", task_type: "analysis", task: "test" });
  assert.equal(missingPath.isError, true);

  const sentinel = join(project, "not-created.txt");
  const question = `Technical inspection: $(literal) & echo NOT_EXECUTED > "${sentinel}"`;
  const read = await call("ask_codely", { cwd: project, task_type: "analysis", task: question, background: false });
  assert.equal(read.isError, undefined, text(read));
  assert.match(text(read), /"mode":"ask"/);
  assert.match(text(read), /"hasPunctuation":true/);
  assert.match(text(read), /session: fake-session-123/);
  assert.equal(existsSync(sentinel), false, "task text must not be interpreted as shell code");

  const resumed = await call("ask_codely", { cwd: project, task_type: "implementation", task: "bounded code task",
    session_id: "exact-session-456", background: false });
  assert.equal(resumed.isError, undefined, text(resumed));
  assert.match(text(resumed), /"mode":"auto_edit"/);
  assert.match(text(resumed), /session: exact-session-456/);

  const started = await call("ask_codely", { cwd: project, task_type: "analysis", task: "TEST_SLOW" });
  const id = text(started).match(/job "([^"]+)"/)?.[1];
  assert.ok(id, text(started));
  await new Promise((resolve) => setTimeout(resolve, 300));
  const progress = await call("check_job", { job_id: id });
  assert.match(text(progress), /still running/);
  assert.match(text(progress), /fake-session-123/);
  assert.match(text(progress), /Tool started: read_file/);
  const collision = await call("ask_codely", { cwd: project, task_type: "implementation", task: "another" });
  assert.equal(collision.isError, true, "one live job per project");
  const independent = await call("ask_codely", { cwd: another, task_type: "analysis", task: "another project", background: false });
  assert.equal(independent.isError, undefined, text(independent));

  const cancel = await call("cancel_job", { job_id: id });
  assert.match(text(cancel), /Cancellation requested/);
  const stopped = await call("wait_job", { job_id: id });
  assert.match(text(stopped), /cancelled/);

  const timeoutStart = await call("ask_codely", { cwd: project, task_type: "analysis", task: "TEST_SLOW" });
  const timeoutId = text(timeoutStart).match(/job "([^"]+)"/)?.[1];
  assert.ok(timeoutId);
  let timeout;
  for (let i = 0; i < 4; i++) {
    timeout = await call("wait_job", { job_id: timeoutId });
    if (timeout.isError) break;
  }
  assert.equal(timeout.isError, true);
  assert.match(text(timeout), /timed out/);

  const large = await call("ask_codely", { cwd: project, task_type: "analysis", task: "TEST_LARGE", background: false });
  assert.equal(large.isError, true, text(large));
  assert.equal(large.structuredContent.status, "incomplete");
  assert.match(text(large), /XXXX/);
  assert.match(text(large), /output truncated/);

  const missingResult = await call("ask_codely", { cwd: project, task_type: "analysis", task: "TEST_NO_RESULT", background: false });
  assert.equal(missingResult.isError, true);
  assert.match(text(missingResult), /result missing/);

  const budget = await call("ask_codely", { cwd: project, task_type: "analysis", task: "TEST_BUDGET_ERROR", background: false });
  assert.equal(budget.isError, true);
  assert.match(text(budget), /402 Budget has been exceeded/);
  assert.match(text(budget), /session: fake-session-123/);

  const immediateStart = await call("ask_codely", { cwd: project, task_type: "analysis", task: "TEST_SLOW" });
  const immediateId = text(immediateStart).match(/job "([^"]+)"/)?.[1];
  assert.ok(immediateId);
  await call("cancel_job", { job_id: immediateId });
  const immediateStop = await call("wait_job", { job_id: immediateId });
  assert.match(text(immediateStop), /cancelled/);
  assert.ok((await client.listTools()).tools.length, "bridge survives immediate cancellation");

  console.log("PASS: tools, forbidden categories, paths, native argv, modes, resume, progress, exclusion, cancellation, timeout, output cap, missing result and 402 propagation");
} finally {
  await client.close();
}
