# Codely bridge 0.3.0

Derived from Qantara commit `0e483108bfd5c436fb5ba8582906ba29c7d4027c` (MIT; retained in LICENSE). This fork exposes `ask_codely`, `check_job`, `wait_job`, `cancel_job`, and `recover_job`. Legacy provider source remains for provenance, but is not registered. The old `setup` command refuses configuration changes; use the repository installers. This package is private and is not an upstream Qantara release.

Codex owns task selection and independent acceptance. Codely receives only bounded technical work, never visual design/review or image generation/editing. The fixed prohibition is sent with every task, but is not a semantic security sandbox. Explicit user invocation remains required.

## Transport and output

The installed Node CLI entry is run natively with shell disabled; the complete policy and task are passed as the `-p` value. Stdin is closed. Real nightly.71 testing showed that the former placeholder-plus-stdin approach lost the brief. A task plus policy over 24000 UTF-8 bytes, NUL input, or an oversized escaped Windows command line is rejected without dispatch.

Known stream event shapes are validated. Malformed event payloads fail only that job; a missing terminal success or missing assistant response also fails. UTF-8 byte caps preserve code-point boundaries. The default text response cap is 1000000 bytes; structured metadata is separate. A single JSON event has its own 4000000-byte parsing limit. Bounded answer files (8000000 bytes by default) are stored outside the Unity project. An incomplete response is flagged as `incomplete`, `isError: true`; `result_path`, `response_truncated` and `artifact_truncated` explain preservation. CLI success is never independent acceptance.

## State and recovery

The shared state directory defaults to `${CODEX_HOME:-~/.codex}/codely-bridge`; set an absolute `BRIDGE_STATE_DIR` for a different location. All cooperating bridge processes must use the same directory for exclusion. Each execution has a UUID, an atomically replaced JSON snapshot, and an exclusive project lease. Snapshot replacement retries transient sharing violations with bounded delays and never deletes the old target first. State files and answers can contain task information; they are runtime data and are not packaged in this repository.

Snapshots remain queryable after restart. An unexpected bridge exit leaves the lease intact and the execution is reported as `interrupted`. Inspect its CLI PID, descendants, session and partial changes. Only after confirming no writers remain, call `recover_job` with `job_id`, `confirm_no_writers: true` and `evidence`. Recovery refuses a live owning bridge or recorded CLI PID, records failure and releases the matching lease; it never kills an arbitrary saved PID, replays work, or closes a formal task. PID reuse or an incomplete/corrupt record must be inspected conservatively.

Cancellation targets the direct CLI process; other writers, descendants, different state directories and other machines are outside the lease protocol. There is no unattended scheduler, automatic restart/resume, or automatic state retention cleanup. Formal task contracts remain with the original workflow.

## Verification

From this directory:

```text
npm ci --ignore-scripts
npm run build
npm test
node tests/installed-mcp.mjs
```

`npm test` is offline. `installed-mcp.mjs` only checks the CLI entry and MCP tool discovery. Only after explicit real-task authorization:

```text
node tests/live-e2e.mjs --allow-model-call
node tests/live-e2e.mjs --verify-existing /absolute/path/to/previous/evidence
```

The second command independently rechecks an existing completed session without another model call. The live test uses a separate temporary fixture, verifies actual received prompt/receipt, checks module behavior and preserved files, and reports CLI-owned `.codely-cli/auto-saves/` and `.codely-cli/UnityInsight/` separately. It does not run Unity. See ../../docs/VALIDATION.md for the recorded scope and limitations.

## Existing installation upgrade

Collect/stop active jobs first. Build this checkout, then inspect `codex mcp get codely_bridge`. If the registered server path already points to this checkout, open a new Codex session. Otherwise update only this registration using resolved absolute paths:

```text
codex mcp add codely_bridge --env BRIDGE_EXPOSE=codely --env BRIDGE_CODELY_ENTRY=/absolute/path/to/@codely/cli/bundle/gemini.js -- /absolute/path/to/node /absolute/path/to/Unity-Agent-Workflow/bridge/codely/dist/server.js
```

Quote paths containing spaces according to the shell. This does not change tool approval policy. Compare and update the installed `cowork-collaboration` skill as well; preserve personal edits and `allow_implicit_invocation: false`. The installers deliberately refuse existing destinations rather than overwrite them. Existing old processes do not gain the new protocol until restarted.
