import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const entry = join(process.env.APPDATA, "npm/node_modules/@codely/cli/bundle/gemini.js");
assert.ok(existsSync(entry), "installed Codely CLI entry is missing");
const transport = new StdioClientTransport({ command: process.execPath, args: [resolve("dist/server.js")],
  env: { ...process.env, BRIDGE_EXPOSE: "codely", BRIDGE_CODELY_ENTRY: entry }, stderr: "pipe" });
const client = new Client({ name: "installed-codely-bridge-test", version: "1.0.0" });
try {
  await client.connect(transport);
  assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(),
    ["ask_codely", "cancel_job", "check_job", "wait_job"]);
  console.log("PASS: installed Codely entry exists; MCP server starts and exposes four tools");
} finally {
  await client.close();
}
