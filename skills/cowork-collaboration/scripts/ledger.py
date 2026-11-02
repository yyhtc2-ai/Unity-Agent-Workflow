#!/usr/bin/env python3
"""Record local Codex-to-Codely handoffs; this script does not run Codely."""

import argparse
import json
import os
import sqlite3
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


TRANSITIONS = {
    "prepared": {"sending", "cancelled"},
    "sending": {"sent", "delivery_unknown"},
    "delivery_unknown": {"prepared", "sent", "failed"},
    "sent": {"running", "waiting_user", "awaiting_verification", "failed"},
    "running": {"waiting_user", "awaiting_verification", "failed", "cancelled"},
    "waiting_user": {"running", "awaiting_verification", "failed", "cancelled"},
    "awaiting_verification": {"running", "waiting_user", "completed", "failed"},
    "completed": set(),
    "failed": set(),
    "cancelled": set(),
}


def now():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def default_db():
    codex_home = os.environ.get("CODEX_HOME")
    return (Path(codex_home) if codex_home else Path.home() / ".codex") / "cowork-collaboration" / "tasks.sqlite3"


def connect(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    db.executescript("""
        CREATE TABLE IF NOT EXISTS handoffs (
            id TEXT PRIMARY KEY,
            project TEXT NOT NULL,
            session TEXT NOT NULL,
            objective TEXT NOT NULL,
            scope TEXT NOT NULL,
            acceptance TEXT NOT NULL,
            baseline TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            handoff_id TEXT NOT NULL REFERENCES handoffs(id),
            at TEXT NOT NULL,
            kind TEXT NOT NULL,
            detail TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS one_live_handoff_per_session
        ON handoffs(project, session)
        WHERE status IN ('sending', 'delivery_unknown', 'sent', 'running', 'waiting_user', 'awaiting_verification');
    """)
    return db


def details(db, task_id):
    row = db.execute("SELECT * FROM handoffs WHERE id = ?", (task_id,)).fetchone()
    if row is None:
        raise ValueError(f"Unknown handoff: {task_id}")
    result = dict(row)
    result["events"] = [dict(event) for event in db.execute(
        "SELECT at, kind, detail FROM events WHERE handoff_id = ? ORDER BY id", (task_id,)
    )]
    return result


def nonempty(value):
    if not value.strip():
        raise argparse.ArgumentTypeError("must not be empty")
    return value.strip()


def project_path(value):
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise argparse.ArgumentTypeError("project path must be absolute")
    try:
        path = path.resolve(strict=True)
    except OSError as exc:
        raise argparse.ArgumentTypeError(f"project path does not exist: {exc}") from exc
    if not path.is_dir():
        raise argparse.ArgumentTypeError("project path must be a directory")
    return os.path.normcase(str(path))


def parser():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--db", type=Path, default=default_db(), help="ledger path (primarily for tests)")
    commands = p.add_subparsers(dest="command", required=True)
    create = commands.add_parser("create", help="prepare a new untracked handoff")
    create.add_argument("--project", type=project_path, required=True, help="absolute project or worktree directory")
    create.add_argument("--session", type=nonempty, required=True, help="stable execution lane or confirmed CLI session ID")
    create.add_argument("--objective", type=nonempty, required=True)
    create.add_argument("--scope", type=nonempty, required=True)
    create.add_argument("--acceptance", type=nonempty, required=True)
    create.add_argument("--baseline", type=nonempty, required=True)
    transition = commands.add_parser("transition", help="record an observed status transition")
    transition.add_argument("id")
    transition.add_argument("--from", dest="old", choices=TRANSITIONS, required=True)
    transition.add_argument("--to", dest="new", choices=TRANSITIONS, required=True)
    transition.add_argument("--note", type=nonempty, required=True)
    transition.add_argument("--evidence", type=nonempty, help="independent verification; required for completed")
    note = commands.add_parser("note", help="record a progress observation without changing status")
    note.add_argument("id")
    note.add_argument("--text", type=nonempty, required=True)
    show = commands.add_parser("show", help="show one handoff and its events")
    show.add_argument("id")
    listing = commands.add_parser("list", help="list handoffs")
    listing.add_argument("--all", action="store_true", help="include completed, failed and cancelled")
    listing.add_argument("--project", type=project_path, help="only handoffs for this project or worktree")
    return p


def main():
    args = parser().parse_args()
    try:
        with connect(args.db) as db:
            if args.command == "create":
                stamp = now()
                task_id = "CL-" + datetime.now(timezone.utc).strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:8]
                db.execute("INSERT INTO handoffs VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", (
                    task_id, args.project, args.session, args.objective, args.scope,
                    args.acceptance, args.baseline, "prepared", stamp, stamp,
                ))
                db.execute("INSERT INTO events(handoff_id, at, kind, detail) VALUES (?, ?, ?, ?)",
                           (task_id, stamp, "created", "Prepared; no CLI dispatch has been started."))
                result = details(db, task_id)
            elif args.command == "transition":
                if args.new not in TRANSITIONS[args.old]:
                    raise ValueError(f"Invalid transition: {args.old} -> {args.new}")
                if args.new == "completed" and not args.evidence:
                    raise ValueError("Independent verification evidence is required for completion")
                db.execute("BEGIN IMMEDIATE")
                stamp = now()
                changed = db.execute(
                    "UPDATE handoffs SET status = ?, updated_at = ? WHERE id = ? AND status = ?",
                    (args.new, stamp, args.id, args.old),
                ).rowcount
                if changed != 1:
                    raise ValueError("Handoff missing or status changed; inspect it before proceeding")
                detail = f"{args.old} -> {args.new}: {args.note}"
                if args.evidence:
                    detail += f"\nVerification: {args.evidence}"
                db.execute("INSERT INTO events(handoff_id, at, kind, detail) VALUES (?, ?, ?, ?)",
                           (args.id, stamp, "transition", detail))
                result = details(db, args.id)
            elif args.command == "note":
                db.execute("BEGIN IMMEDIATE")
                details(db, args.id)
                stamp = now()
                db.execute("INSERT INTO events(handoff_id, at, kind, detail) VALUES (?, ?, ?, ?)",
                           (args.id, stamp, "observation", args.text))
                db.execute("UPDATE handoffs SET updated_at = ? WHERE id = ?", (stamp, args.id))
                result = details(db, args.id)
            elif args.command == "show":
                result = details(db, args.id)
            else:
                where = "" if args.all else "WHERE status NOT IN ('completed', 'failed', 'cancelled')"
                result = [dict(row) for row in db.execute(
                    f"SELECT id, project, session, objective, status, updated_at FROM handoffs {where} ORDER BY updated_at DESC"
                )]
                if args.project:
                    result = [row for row in result if os.path.normcase(os.path.normpath(row["project"])) == args.project]
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, sqlite3.Error, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
