#!/usr/bin/env node
const cmd = process.argv[2];
if (cmd === "--version" || cmd === "-v" || cmd === "version") {
  process.stdout.write("codely-bridge 0.3.0 (Qantara-derived)\n");
} else if (cmd === "setup") {
  process.stderr.write("Legacy qantara setup is disabled in this Codely-only fork. Use python3 scripts/install.py (or scripts/install.ps1 on Windows) from the repository root. No host configuration was changed.\n");
  process.exitCode = 1;
} else if (["--help", "-h", "help"].includes(cmd ?? "")) {
  process.stdout.write("Codely MCP bridge. Run without arguments for stdio. Install with the repository scripts/install.py.\n");
} else if (cmd) {
  process.stderr.write(`Unknown command: ${cmd}\n`); process.exitCode = 1;
} else {
  await import("./server.js");
}
