import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { mkdtempSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

// An explicit entry also supports nonstandard installations and version managers.
const npmRoot = process.env.BRIDGE_CODELY_ENTRY ? null :
  (process.platform === "win32"
    ? execFileSync("cmd.exe", ["/d", "/c", "npm root -g"], { encoding: "utf8" })
    : execFileSync("npm", ["root", "-g"], { encoding: "utf8" })).trim();
const entry = process.env.BRIDGE_CODELY_ENTRY || join(npmRoot, "@codely/cli/bundle/gemini.js");
assert.ok(existsSync(entry), "installed Codely CLI entry is missing");
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/server.js")],
  env: { ...process.env, BRIDGE_STATE_DIR: mkdtempSync(join(tmpdir(), "installed-bridge-test-")), BRIDGE_EXPOSE: "codely", BRIDGE_CODELY_ENTRY: entry }, stderr: "pipe" });
const client = new Client({ name: "installed-codely-bridge-test", version: "1.0.0" });
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(),
    ["ask_codely", "cancel_job", "check_job", "recover_job", "wait_job"]);
  console.log("PASS: installed Codely entry exists; MCP server starts and exposes five tools");
} finally {
  await client.close();
}
