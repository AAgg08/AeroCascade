#!/usr/bin/env python3
"""
AeroCascade Enterprise Database Backup & Restore Utility
Performs online, point-in-time SQLite backups and verified restores without service downtime.
"""

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path


def backup_database(src_db: str, dest_backup: str) -> None:
    src_path = Path(src_db).resolve()
    dest_path = Path(dest_backup).resolve()

    if not src_path.exists():
        print(f"Error: Source database '{src_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    dest_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Creating point-in-time backup from {src_path} -> {dest_path}...")

    start = time.perf_counter()
    with sqlite3.connect(str(src_path)) as src_conn:
        with sqlite3.connect(str(dest_path)) as dest_conn:
            src_conn.backup(dest_conn)
    elapsed = time.perf_counter() - start

    size_bytes = dest_path.stat().st_size
    print(f"Backup completed successfully in {elapsed:.3f}s. Size: {size_bytes} bytes.")


def restore_database(backup_file: str, target_db: str) -> None:
    backup_path = Path(backup_file).resolve()
    target_path = Path(target_db).resolve()

    if not backup_path.exists():
        print(f"Error: Backup file '{backup_path}' does not exist.", file=sys.stderr)
        sys.exit(1)

    target_path.parent.mkdir(parents=True, exist_ok=True)
    print(f"Restoring database from {backup_path} -> {target_path}...")

    start = time.perf_counter()
    with sqlite3.connect(str(backup_path)) as src_conn:
        # Integrity check on source backup before restoring
        cursor = src_conn.cursor()
        cursor.execute("PRAGMA integrity_check;")
        res = cursor.fetchone()
        if not res or res[0] != "ok":
            print(f"Error: Backup integrity check failed: {res}", file=sys.stderr)
            sys.exit(1)

        with sqlite3.connect(str(target_path)) as dest_conn:
            src_conn.backup(dest_conn)

    elapsed = time.perf_counter() - start
    print(f"Restore completed successfully in {elapsed:.3f}s.")
    verify_database(str(target_path))


def verify_database(db_path: str) -> None:
    p = Path(db_path).resolve()
    if not p.exists():
        print(f"Error: Database '{p}' does not exist.", file=sys.stderr)
        sys.exit(1)

    with sqlite3.connect(str(p)) as conn:
        cursor = conn.cursor()
        cursor.execute("PRAGMA integrity_check;")
        res = cursor.fetchone()
        if not res or res[0] != "ok":
            print(f"Integrity check failed: {res}", file=sys.stderr)
            sys.exit(1)

        # Print statistics
        cursor.execute("SELECT count(*) FROM sqlite_master WHERE type='table';")
        num_tables = cursor.fetchone()[0]

        counts = {}
        for table in ["topologies", "topology_versions", "simulation_runs"]:
            try:
                cursor.execute(f"SELECT count(*) FROM {table};")
                counts[table] = cursor.fetchone()[0]
            except Exception:
                counts[table] = 0

    print(f"Database integrity verified: OK ({num_tables} tables).")
    for tbl, cnt in counts.items():
        print(f"  - {tbl}: {cnt} records")


def main():
    parser = argparse.ArgumentParser(description="AeroCascade SQLite Backup & Restore CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # Backup subcommand
    p_backup = subparsers.add_parser("backup", help="Create online SQLite backup")
    p_backup.add_argument(
        "--db",
        default=os.environ.get("AEROCASCADE_DB_PATH", "data/aerocascade.db"),
        help="Path to source SQLite database",
    )
    p_backup.add_argument(
        "--out",
        help="Destination path for backup file (defaults to backups/aerocascade_backup_<timestamp>.db)",
    )

    # Restore subcommand
    p_restore = subparsers.add_parser("restore", help="Restore database from backup")
    p_restore.add_argument("backup_file", help="Path to backup file")
    p_restore.add_argument(
        "--db",
        default=os.environ.get("AEROCASCADE_DB_PATH", "data/aerocascade.db"),
        help="Target SQLite database destination",
    )

    # Verify subcommand
    p_verify = subparsers.add_parser("verify", help="Check database integrity")
    p_verify.add_argument(
        "--db",
        default=os.environ.get("AEROCASCADE_DB_PATH", "data/aerocascade.db"),
        help="Target SQLite database path",
    )

    args = parser.parse_args()

    if args.command == "backup":
        out_path = args.out
        if not out_path:
            backup_dir = os.environ.get("AEROCASCADE_BACKUP_DIR", "backups")
            out_path = os.path.join(backup_dir, f"aerocascade_backup_{int(time.time())}.db")
        backup_database(args.db, out_path)
    elif args.command == "restore":
        restore_database(args.backup_file, args.db)
    elif args.command == "verify":
        verify_database(args.db)


if __name__ == "__main__":
    main()
