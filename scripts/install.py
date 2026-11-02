"""Install skills and register the bridge without changing existing installations."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess


def install(args):
    root = Path(__file__).resolve().parents[1]
    codex_home = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex"))).expanduser().resolve()
    if not codex_home.is_dir():
        raise RuntimeError("Codex home does not exist; initialize Codex or create CODEX_HOME first")
    commands = {name: shutil.which(name) for name in ("node", "npm", "codex")}
    for name, command in commands.items():
        if not command:
            raise RuntimeError(f"Missing command on PATH: {name}")
    def run(name, *argv, **kwargs):
        return subprocess.run([commands[name], *argv], check=True, **kwargs)
    entry = args.codely_entry
    if not entry:
        npm_root = run("npm", "root", "-g", capture_output=True, text=True).stdout.strip()
        entry = Path(npm_root) / "@codely/cli/bundle/gemini.js"
    entry = Path(entry).expanduser().resolve()
    if not entry.is_file():
        raise RuntimeError("Install official Codely CLI or specify --codely-entry")
    sources = [root / "skills/cowork-collaboration"]
    if not args.skip_foundry:
        sources += sorted(p for p in (root / "plugins/agent-foundry/skills").iterdir() if p.is_dir())
    skill_root = codex_home / "skills"
    for source in sources:
        if (skill_root / source.name).exists():
            raise RuntimeError(f"Skill already exists: {source.name}; no overwrite performed")
    # A failed read must mean absent, rather than a broken CLI/configuration.
    result = run("codex", "mcp", "list", "--json", capture_output=True, text=True)
    import json
    servers = json.loads(result.stdout)
    if any(server.get("name") == "codely_bridge" for server in servers):
        raise RuntimeError("codely_bridge already registered; no overwrite performed")
    print(f"Skills: {len(sources)} -> {skill_root}")
    print(f"Codely entry: {entry}")
    if args.dry_run:
        print("Dry run: no build, copies or registration performed")
        return
    bridge = root / "bridge/codely"
    run("npm", "ci", "--ignore-scripts", "--no-audit", "--no-fund", cwd=bridge)
    run("npm", "run", "build", cwd=bridge)
    skill_root.mkdir(parents=True, exist_ok=True)
    for source in sources:
        shutil.copytree(source, skill_root / source.name, ignore=shutil.ignore_patterns("__pycache__", "*.pyc"))
    if not args.skip_foundry:
        notices = codex_home / "agent-workflow-notices/agent-foundry"
        notices.mkdir(parents=True, exist_ok=True)
        for name in ("LICENSE", "THIRD_PARTY_NOTICES.md", "UNITY_COMPANION_LICENSE.md"):
            shutil.copy2(root / "plugins/agent-foundry" / name, notices / name)
    run("codex", "mcp", "add", "codely_bridge", "--env", "BRIDGE_EXPOSE=codely", "--env",
        f"BRIDGE_CODELY_ENTRY={entry}", "--", commands["node"], str(bridge / "dist/server.js"))
    print("Installed. Keep this repository and Node at these paths; open a new Codex session.")
    print("Codely delegation still requires explicit user invocation for the current project/task.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--skip-foundry", action="store_true")
    parser.add_argument("--codely-entry")
    parser.add_argument("--dry-run", action="store_true")
    try:
        install(parser.parse_args())
    except (RuntimeError, OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Installation stopped: {error}. Inspect partial changes before retrying.\n")
