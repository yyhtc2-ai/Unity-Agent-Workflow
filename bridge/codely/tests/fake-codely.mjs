// Offline stand-in for Codely's stream-json protocol. No files or network access.
let stdin = "";
process.stdin.setEncoding("utf8");
for await (const chunk of process.stdin) stdin += chunk;
const args = process.argv.slice(2);
const value = (key) => { const i = args.indexOf(key); return i < 0 ? undefined : args[i + 1]; };
const input = value("-p") || "";
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\n");
const policyOk = stdin === "" && input.includes("Do not perform or review visual design") &&
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
} else if (input.includes("TEST_PROGRESS_BURST")) {
  for (let i = 0; i < 120; i++) emit({ type: "tool_use", tool_name: "read_file_" + i });
  emit({ type: "message", role: "assistant", content: "burst completed" });
  emit({ type: "result", status: "success" });
} else if (input.includes("TEST_NULL")) {
  process.stdout.write("null\n");
  emit({ type: "message", role: "assistant", content: "must fail shape validation" });
  emit({ type: "result", status: "success" });
} else if (input.includes("TEST_BAD_CONTENT")) {
  emit({ type: "message", role: "assistant", content: 123 });
  emit({ type: "result", status: "success" });
} else if (input.includes("TEST_OVERSIZE_EVENT")) {
  emit({ type: "message", role: "assistant", content: "X".repeat(200_000) });
  emit({ type: "result", status: "success" });
} else if (input.includes("TEST_UNICODE")) {
  emit({ type: "message", role: "assistant", content: "测".repeat(4000) });
  emit({ type: "result", status: "success" });
} else if (input.includes("TEST_UTF8_SPLIT")) {
  const bytes = Buffer.from(JSON.stringify({ type: "message", role: "assistant", content: "中文🙂" }) + "\n");
  const split = bytes.indexOf(Buffer.from("中文")) + 1;
  process.stdout.write(bytes.subarray(0, split));
  await new Promise(r => setTimeout(r, 15));
  process.stdout.write(bytes.subarray(split));
  emit({ type: "result", status: "success" });
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
    receipt: input.match(/RECEIPT_[A-Za-z0-9]+/)?.[0],
  });
  // Exercise incremental UTF-8/JSON parsing with deliberately split output chunks.
  const line = Buffer.from(JSON.stringify({ type: "message", role: "assistant", content: result }) + "\n");
  process.stdout.write(line.subarray(0, 7));
  process.stdout.write(line.subarray(7));
  emit({ type: "result", status: "success" });
}
