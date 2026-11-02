# Qantara Codely adapter

This local adaptation is based on Qantara commit `0e483108bfd5c436fb5ba8582906ba29c7d4027c` (MIT license; see `LICENSE`). It registers only `ask_codely`, `check_job`, `wait_job`, and `cancel_job`. The other upstream runners remain in the source tree but are not exposed by this server.

Codex chooses the task, provides its project, authorized scope, and acceptance criteria, and independently verifies the result. `task_type` accepts only `implementation`, `analysis`, or `verification`. Visual design and image generation must not be delegated. The CLI also receives a fixed prohibition, but the host must classify task content correctly: a type enum and prompt do not provide semantic enforcement.

The adapter runs the installed Node entry directly, sends the brief on stdin, disables nested agents, uses the strict workspace path policy and selects ask/auto-edit mode by task type. Output is parsed from Codely `stream-json`. `done` means the CLI exited successfully with a successful result event; it is not independent acceptance. The bridge reports the session ID, process ID and latest observed event when available. Jobs are held in memory, the per-project guard is per bridge process, and cancellation targets only the direct child. Use the Codex collaboration skill and its existing handoff record for recovery.

Build and offline integration test from this directory:

```powershell
npm ci --ignore-scripts
npm run build
node tests/codely-mcp.mjs
node tests/installed-mcp.mjs
```

The integration test uses `tests/fake-codely.mjs`; the installation check only starts the server and lists tools. Neither makes model calls. The server needs `BRIDGE_CODELY_ENTRY` to point to the installed `@codely/cli/bundle/gemini.js`. After registering or changing the server, start a fresh Codex session to load it. Codely itself may write `.codely-cli/auto-saves/` under the project.
