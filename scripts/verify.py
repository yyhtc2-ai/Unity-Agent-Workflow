"""Run offline verification on Windows, macOS or Linux."""
from pathlib import Path
import shutil
import subprocess
import sys

root = Path(__file__).resolve().parents[1]
bridge = root / "bridge/codely"
for name, args, cwd in [
    ("npm", ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], bridge),
    ("npm", ["run", "build"], bridge),
    ("node", ["tests/codely-mcp.mjs"], bridge),
    ("node", ["--test", "tests/regressions.test.mjs"], bridge),
]:
    command = shutil.which(name)
    if not command:
        raise SystemExit(f"Missing command: {name}")
    subprocess.run([command, *args], cwd=cwd, check=True)
subprocess.run([sys.executable, "-X", "utf8", "-m", "unittest", "test_ledger"],
               cwd=root / "skills/cowork-collaboration/scripts", check=True)
print("Offline verification passed. No model calls were made.")
