// Offline stand-in for Codely's stream-json protocol. No files or network access.
let input = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) input += chunk;
const args = process.argv.slice(2);
const value = (key) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const policyOk = input.includes("Do not perform or review visual design") &&
  input.includes("generate or edit images") && input.includes("Do not delegate");
const safetyOk = args.includes("--agents=false") && value("--path-policy") === "strict" &&
  !args.includes("--yolo") && process.env.NO_BROWSER === "1";
const session = value("--resume-session") || "fake-session-123";
emit({ type: "init", session_id: session });
emit({ type: "tool_use", tool_name: "read_file" });
if (!policyOk || !safetyOk) {
  emit({ type: "result", status: "error", error: { message: "policy missing" } });
  process.exitCode = 2;
} else if (input.includes("TEST_SLOW")) {
  await new Promise((resolve) => setTimeout(resolve, 30_000));
} else if (input.includes("TEST_BUDGET_ERROR")) {
  emit({ type: "error", message: "402 Budget has been exceeded" });
  emit({ type: "result", status: "error", error: { message: "402 Budget has been exceeded" } });
  process.exitCode = 1;
} else if (input.includes("TEST_LARGE")) {
  emit({ type: "message", role: "assistant", content: "X".repeat(20_000) });
  emit({ type: "result", status: "success" });
} else if (input.includes("TEST_NO_RESULT")) {
  emit({ type: "message", role: "assistant", content: "unconfirmed" });
} else {
  const result = JSON.stringify({
    mode: value("--approval-mode") || value("--collaboration-mode"),
    session,
    hasPunctuation: input.includes("$(literal) & echo NOT_EXECUTED"),
    policyOk,
  });
  // Exercise incremental UTF-8/JSON parsing with deliberately split output chunks.
  const line = Buffer.from(JSON.stringify({ type: "message", role: "assistant", content: result }) + "\n");
  process.stdout.write(line.subarray(0, 7));
  process.stdout.write(line.subarray(7));
  emit({ type: "result", status: "success" });
}
