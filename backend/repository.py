"""
AeroCascade — SQLite Topology Repository and Migration Engine

Provides persistent storage for:
- Named topologies
- Immutable topology versions with optimistic locking (expected_version check)
- Completed runs linked to specific immutable topology versions
- Origin tracking for cloned topologies
- Database backup and restore capabilities
"""

from __future__ import annotations
import json
import os
from pathlib import Path
import sqlite3
from typing import Any, Dict, List, Optional
from uuid import uuid4

from .canonical import (
    CanonicalTopology,
    canonical_to_simulation_request,
    preset_dict_to_canonical_topology,
)
from .models import SimulationRequest, SimulationResponse


class StaleVersionConflictError(Exception):
    """Raised when an update is attempted with an out-of-date expected_version."""
    pass


class TopologyNotFoundError(Exception):
    """Raised when a requested topology or version does not exist."""
    pass


MIGRATIONS = [
    (
        1,
        "001_initial_topology_and_runs_schema",
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            name TEXT NOT NULL,
            applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS topologies (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            origin_topology_id TEXT,
            origin_version INTEGER,
            current_version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS topology_versions (
            id TEXT PRIMARY KEY,
            topology_id TEXT NOT NULL REFERENCES topologies(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            canonical_data TEXT NOT NULL,
            resolved_input TEXT NOT NULL,
            change_summary TEXT NOT NULL DEFAULT '',
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(topology_id, version)
        );

        CREATE TABLE IF NOT EXISTS simulation_runs (
            run_id TEXT PRIMARY KEY,
            topology_id TEXT NOT NULL REFERENCES topologies(id) ON DELETE CASCADE,
            topology_version INTEGER NOT NULL,
            engine_version TEXT NOT NULL,
            random_seed INTEGER NOT NULL,
            replicates INTEGER NOT NULL,
            resolved_input TEXT NOT NULL,
            result TEXT NOT NULL,
            executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (topology_id, topology_version) REFERENCES topology_versions(topology_id, version)
        );

        CREATE INDEX IF NOT EXISTS idx_versions_topology ON topology_versions(topology_id);
        CREATE INDEX IF NOT EXISTS idx_runs_topology_version ON simulation_runs(topology_id, topology_version);
        """
    ),
    (
        2,
        "002_dossier_approvals",
        """
        CREATE TABLE IF NOT EXISTS dossier_approvals (
            run_id TEXT PRIMARY KEY REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
            approver TEXT NOT NULL,
            approver_role TEXT NOT NULL,
            signoff_notes TEXT NOT NULL,
            run_sha256 TEXT NOT NULL,
            approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
        );
        """
    ),
    (
        3,
        "003_approval_provenance_separation",
        """
        CREATE TABLE IF NOT EXISTS dossier_approvals_v3 (
            run_id TEXT NOT NULL REFERENCES simulation_runs(run_id) ON DELETE CASCADE,
            approval_type TEXT NOT NULL CHECK(approval_type IN ('enterprise', 'exercise', 'legacy')),
            approver TEXT NOT NULL,
            approver_role TEXT NOT NULL,
            signoff_notes TEXT NOT NULL,
            run_sha256 TEXT NOT NULL,
            topology_id TEXT,
            topology_version INTEGER,
            authenticated_account TEXT,
            approved_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
            PRIMARY KEY (run_id, approval_type)
        );

        INSERT OR IGNORE INTO dossier_approvals_v3 (
            run_id, approval_type, approver, approver_role, signoff_notes, run_sha256, topology_id, topology_version, approved_at
        )
        SELECT 
            da.run_id,
            'legacy',
            da.approver,
            da.approver_role,
            da.signoff_notes,
            da.run_sha256,
            sr.topology_id,
            sr.topology_version,
            da.approved_at
        FROM dossier_approvals da
        LEFT JOIN simulation_runs sr ON da.run_id = sr.run_id;

        DROP TABLE IF EXISTS dossier_approvals;
        ALTER TABLE dossier_approvals_v3 RENAME TO dossier_approvals;

        CREATE INDEX IF NOT EXISTS idx_dossier_approvals_run ON dossier_approvals(run_id);
        CREATE INDEX IF NOT EXISTS idx_dossier_approvals_type ON dossier_approvals(approval_type);
        """
    ),
]


class TopologyRepository:
    def __init__(self, db_path: Optional[str] = None):
        if db_path is None:
            db_path = os.environ.get("AEROCASCADE_DB_PATH", "data/aerocascade.db")
        self.db_path = db_path
        self._memory_conn: Optional[sqlite3.Connection] = None
        if self.db_path == ":memory:":
            self._memory_conn = sqlite3.connect(":memory:")
            self._memory_conn.row_factory = sqlite3.Row
            self._memory_conn.execute("PRAGMA foreign_keys = ON;")
        else:
            parent = Path(self.db_path).resolve().parent
            parent.mkdir(parents=True, exist_ok=True)
        self.init_db()

    def _get_connection(self) -> sqlite3.Connection:
        if self._memory_conn is not None:
            return self._memory_conn
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON;")
        conn.execute("PRAGMA journal_mode = WAL;")
        return conn

    def init_db(self) -> None:
        """Applies pending database migrations and seeds initial standard presets if empty."""
        with self._get_connection() as conn:
            # Check existing migrations table
            cur = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations';"
            )
            has_migrations_table = cur.fetchone() is not None
            applied_versions = set()
            if has_migrations_table:
                applied_rows = conn.execute("SELECT version FROM schema_migrations;").fetchall()
                applied_versions = {row["version"] for row in applied_rows}

            for version, name, sql in MIGRATIONS:
                if version not in applied_versions:
                    conn.executescript(sql)
                    conn.execute(
                        "INSERT INTO schema_migrations (version, name) VALUES (?, ?);",
                        (version, name),
                    )

            # Auto-seed standard presets if topologies table is empty
            count = conn.execute("SELECT COUNT(*) AS cnt FROM topologies;").fetchone()["cnt"]
            if count == 0:
                self._seed_presets(conn)

    def _seed_presets(self, conn: sqlite3.Connection) -> None:
        """Seeds initial synthetic benchmark presets into the database."""
        seed_path = Path(__file__).resolve().parent / "scenarios_seed.json"
        if not seed_path.exists():
            return
        try:
            with open(seed_path, "r", encoding="utf-8") as f:
                presets = json.load(f)
            for p in presets:
                canonical = preset_dict_to_canonical_topology(p)
                resolved_req = canonical_to_simulation_request(canonical)

                conn.execute(
                    """
                    INSERT INTO topologies (id, name, description, current_version)
                    VALUES (?, ?, ?, 1);
                    """,
                    (canonical.topology_id, canonical.name, canonical.description),
                )
                conn.execute(
                    """
                    INSERT INTO topology_versions (id, topology_id, version, canonical_data, resolved_input, change_summary)
                    VALUES (?, ?, 1, ?, ?, ?);
                    """,
                    (
                        f"{canonical.topology_id}:v1",
                        canonical.topology_id,
                        canonical.model_dump_json(),
                        resolved_req.model_dump_json(),
                        "Initial standard benchmark preset",
                    ),
                )
        except Exception as e:
            # Seed error should not crash initialization
            print(f"Warning: Failed to seed default presets: {e}")

    def list_topologies(self) -> List[Dict[str, Any]]:
        """Returns all named topologies with summary metadata and version count."""
        with self._get_connection() as conn:
            rows = conn.execute(
                """
                SELECT 
                    t.id,
                    t.name,
                    t.description,
                    t.origin_topology_id,
                    t.origin_version,
                    t.current_version,
                    t.created_at,
                    t.updated_at,
                    COUNT(v.version) AS version_count,
                    COUNT(r.run_id) AS total_runs_count
                FROM topologies t
                LEFT JOIN topology_versions v ON t.id = v.topology_id
                LEFT JOIN simulation_runs r ON t.id = r.topology_id
                GROUP BY t.id
                ORDER BY t.updated_at DESC;
                """
            ).fetchall()
            return [dict(r) for r in rows]

    def get_topology(self, topology_id: str) -> Dict[str, Any]:
        """Gets topology details including all immutable versions and execution runs count."""
        with self._get_connection() as conn:
            topo = conn.execute(
                "SELECT * FROM topologies WHERE id = ?;", (topology_id,)
            ).fetchone()
            if not topo:
                raise TopologyNotFoundError(f"Topology '{topology_id}' not found.")

            versions = conn.execute(
                """
                SELECT 
                    v.version,
                    v.change_summary,
                    v.created_at,
                    COUNT(r.run_id) AS runs_count
                FROM topology_versions v
                LEFT JOIN simulation_runs r 
                    ON v.topology_id = r.topology_id AND v.version = r.topology_version
                WHERE v.topology_id = ?
                GROUP BY v.version
                ORDER BY v.version DESC;
                """,
                (topology_id,),
            ).fetchall()

            res = dict(topo)
            res["versions"] = [dict(v) for v in versions]
            return res

    def get_version(self, topology_id: str, version: int) -> Dict[str, Any]:
        """Gets a specific immutable version of a topology."""
        with self._get_connection() as conn:
            row = conn.execute(
                """
                SELECT * FROM topology_versions 
                WHERE topology_id = ? AND version = ?;
                """,
                (topology_id, version),
            ).fetchone()
            if not row:
                raise TopologyNotFoundError(f"Version {version} of topology '{topology_id}' not found.")

            return {
                "id": row["id"],
                "topology_id": row["topology_id"],
                "version": row["version"],
                "change_summary": row["change_summary"],
                "created_at": row["created_at"],
                "canonical": json.loads(row["canonical_data"]),
                "resolved_input": json.loads(row["resolved_input"]),
            }

    def create_topology(
        self,
        name: str,
        canonical: CanonicalTopology,
        description: str = "",
    ) -> Dict[str, Any]:
        """Creates a new named topology and stores its immutable version 1."""
        topology_id = canonical.topology_id or f"topo-{uuid4().hex[:12]}"
        canonical.topology_id = topology_id
        canonical.name = name
        canonical.description = description or canonical.description
        canonical.version = 1

        resolved_req = canonical_to_simulation_request(canonical)

        with self._get_connection() as conn:
            # Check duplicate ID
            existing = conn.execute(
                "SELECT id FROM topologies WHERE id = ?;", (topology_id,)
            ).fetchone()
            if existing:
                topology_id = f"topo-{uuid4().hex[:12]}"
                canonical.topology_id = topology_id
                resolved_req.scenario_id = topology_id

            conn.execute(
                """
                INSERT INTO topologies (id, name, description, current_version)
                VALUES (?, ?, ?, 1);
                """,
                (topology_id, name, canonical.description),
            )
            version_id = f"{topology_id}:v1"
            conn.execute(
                """
                INSERT INTO topology_versions (id, topology_id, version, canonical_data, resolved_input, change_summary)
                VALUES (?, ?, 1, ?, ?, ?);
                """,
                (
                    version_id,
                    topology_id,
                    canonical.model_dump_json(),
                    resolved_req.model_dump_json(),
                    "Initial version",
                ),
            )
            conn.commit()

        return self.get_topology(topology_id)

    def save_new_version(
        self,
        topology_id: str,
        canonical: CanonicalTopology,
        expected_version: int,
        change_summary: str = "",
    ) -> Dict[str, Any]:
        """
        Saves a new immutable version of an existing topology.
        Enforces optimistic locking: rejects with StaleVersionConflictError if expected_version != current_version.
        """
        with self._get_connection() as conn:
            topo = conn.execute(
                "SELECT current_version FROM topologies WHERE id = ?;", (topology_id,)
            ).fetchone()
            if not topo:
                raise TopologyNotFoundError(f"Topology '{topology_id}' not found.")

            current_version = topo["current_version"]
            if current_version != expected_version:
                raise StaleVersionConflictError(
                    f"Conflict: expected version {expected_version}, but current version is {current_version}. "
                    "The topology was modified by another operation. Please reopen or reload before saving."
                )

            next_version = current_version + 1
            canonical.topology_id = topology_id
            canonical.version = next_version

            resolved_req = canonical_to_simulation_request(canonical)

            version_id = f"{topology_id}:v{next_version}"
            conn.execute(
                """
                INSERT INTO topology_versions (id, topology_id, version, canonical_data, resolved_input, change_summary)
                VALUES (?, ?, ?, ?, ?, ?);
                """,
                (
                    version_id,
                    topology_id,
                    next_version,
                    canonical.model_dump_json(),
                    resolved_req.model_dump_json(),
                    change_summary or f"Version {next_version} update",
                ),
            )
            conn.execute(
                """
                UPDATE topologies 
                SET current_version = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?;
                """,
                (next_version, topology_id),
            )
            conn.commit()

        return self.get_version(topology_id, next_version)

    def clone_topology(
        self,
        source_topology_id: str,
        new_name: str,
        source_version: Optional[int] = None,
        description: str = "",
    ) -> Dict[str, Any]:
        """
        Clones a topology into a new named entity with a fresh ID.
        Records origin lineage (cloned_from_id and cloned_from_version).
        Leaves the original topology unchanged.
        """
        with self._get_connection() as conn:
            topo = conn.execute(
                "SELECT * FROM topologies WHERE id = ?;", (source_topology_id,)
            ).fetchone()
            if not topo:
                raise TopologyNotFoundError(f"Source topology '{source_topology_id}' not found.")

            ver_to_clone = source_version or topo["current_version"]
            ver_row = conn.execute(
                """
                SELECT canonical_data FROM topology_versions 
                WHERE topology_id = ? AND version = ?;
                """,
                (source_topology_id, ver_to_clone),
            ).fetchone()
            if not ver_row:
                raise TopologyNotFoundError(
                    f"Source version {ver_to_clone} not found for topology '{source_topology_id}'."
                )

            source_canonical_dict = json.loads(ver_row["canonical_data"])
            new_id = f"clone-{uuid4().hex[:10]}"

            # Update canonical data for new identity
            source_canonical_dict["topology_id"] = new_id
            source_canonical_dict["name"] = new_name
            source_canonical_dict["description"] = description or f"Clone of {topo['name']} (v{ver_to_clone})"
            source_canonical_dict["version"] = 1
            if "source_provenance" not in source_canonical_dict:
                source_canonical_dict["source_provenance"] = {}
            source_canonical_dict["source_provenance"]["cloned_from_id"] = source_topology_id
            source_canonical_dict["source_provenance"]["cloned_from_version"] = ver_to_clone

            cloned_canonical = CanonicalTopology(**source_canonical_dict)
            resolved_req = canonical_to_simulation_request(cloned_canonical)

            conn.execute(
                """
                INSERT INTO topologies (id, name, description, origin_topology_id, origin_version, current_version)
                VALUES (?, ?, ?, ?, ?, 1);
                """,
                (
                    new_id,
                    new_name,
                    cloned_canonical.description,
                    source_topology_id,
                    ver_to_clone,
                ),
            )
            conn.execute(
                """
                INSERT INTO topology_versions (id, topology_id, version, canonical_data, resolved_input, change_summary)
                VALUES (?, ?, 1, ?, ?, ?);
                """,
                (
                    f"{new_id}:v1",
                    new_id,
                    cloned_canonical.model_dump_json(),
                    resolved_req.model_dump_json(),
                    f"Cloned from {source_topology_id} version {ver_to_clone}",
                ),
            )
            conn.commit()

        return self.get_topology(new_id)

    def record_run(
        self,
        topology_id: str,
        topology_version: int,
        request: SimulationRequest,
        response: SimulationResponse,
    ) -> Dict[str, Any]:
        """Records a completed simulation run linked to an immutable topology version."""
        with self._get_connection() as conn:
            # Verify version existence
            ver = conn.execute(
                "SELECT id FROM topology_versions WHERE topology_id = ? AND version = ?;",
                (topology_id, topology_version),
            ).fetchone()
            if not ver:
                raise TopologyNotFoundError(
                    f"Cannot link run: topology '{topology_id}' version {topology_version} does not exist."
                )

            run_id = response.run_id or f"run-{uuid4().hex[:12]}"
            conn.execute(
                """
                INSERT INTO simulation_runs (
                    run_id, topology_id, topology_version, engine_version, random_seed, replicates, resolved_input, result
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
                """,
                (
                    run_id,
                    topology_id,
                    topology_version,
                    response.model_version,
                    response.random_seed,
                    response.replicates,
                    request.model_dump_json(),
                    response.model_dump_json(),
                ),
            )
            conn.commit()

        return {
            "run_id": run_id,
            "topology_id": topology_id,
            "topology_version": topology_version,
            "engine_version": response.model_version,
            "replicates": response.replicates,
        }

    def list_runs(
        self,
        topology_id: Optional[str] = None,
        topology_version: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """Lists simulation runs, optionally filtered by topology and version."""
        with self._get_connection() as conn:
            query = """
                SELECT 
                    run_id,
                    topology_id,
                    topology_version,
                    engine_version,
                    random_seed,
                    replicates,
                    executed_at
                FROM simulation_runs
            """
            params: List[Any] = []
            clauses: List[str] = []
            if topology_id:
                clauses.append("topology_id = ?")
                params.append(topology_id)
            if topology_version is not None:
                clauses.append("topology_version = ?")
                params.append(topology_version)

            if clauses:
                query += " WHERE " + " AND ".join(clauses)
            query += " ORDER BY executed_at DESC;"

            rows = conn.execute(query, params).fetchall()
            return [dict(r) for r in rows]

    def get_run(self, run_id: str) -> Dict[str, Any]:
        """Gets full run details including inputs and simulation results."""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM simulation_runs WHERE run_id = ?;", (run_id,)
            ).fetchone()
            if not row:
                raise TopologyNotFoundError(f"Simulation run '{run_id}' not found.")

            return {
                "run_id": row["run_id"],
                "topology_id": row["topology_id"],
                "topology_version": row["topology_version"],
                "engine_version": row["engine_version"],
                "random_seed": row["random_seed"],
                "replicates": row["replicates"],
                "executed_at": row["executed_at"],
                "resolved_input": json.loads(row["resolved_input"]),
                "result": json.loads(row["result"]),
            }

    def approve_run(
        self,
        run_id: str,
        approver: str,
        approver_role: str,
        notes: str,
        run_sha256: str,
        approval_type: str = "exercise",
        topology_id: Optional[str] = None,
        topology_version: Optional[int] = None,
        authenticated_account: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Store one immutable approval per (run_id, approval_type). Return None if it was already approved."""
        with self._get_connection() as conn:
            row = conn.execute(
                """
                INSERT INTO dossier_approvals (
                    run_id, approval_type, approver, approver_role, signoff_notes,
                    run_sha256, topology_id, topology_version, authenticated_account
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (run_id, approval_type) DO NOTHING
                RETURNING *;
                """,
                (
                    run_id,
                    approval_type,
                    approver,
                    approver_role,
                    notes,
                    run_sha256,
                    topology_id,
                    topology_version,
                    authenticated_account,
                ),
            ).fetchone()
        return dict(row) if row else None

    def get_run_approval(
        self, run_id: str, approval_type: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Fetch the approval for a run. If approval_type is provided, fetch specifically for that type.
        If None, return the most authoritative approval ('enterprise' > 'exercise' > 'legacy').
        """
        with self._get_connection() as conn:
            if approval_type is not None:
                row = conn.execute(
                    "SELECT * FROM dossier_approvals WHERE run_id = ? AND approval_type = ?;",
                    (run_id, approval_type),
                ).fetchone()
            else:
                row = conn.execute(
                    """
                    SELECT * FROM dossier_approvals
                    WHERE run_id = ?
                    ORDER BY CASE approval_type
                        WHEN 'enterprise' THEN 1
                        WHEN 'exercise' THEN 2
                        WHEN 'legacy' THEN 3
                        ELSE 4
                    END ASC
                    LIMIT 1;
                    """,
                    (run_id,),
                ).fetchone()
            return dict(row) if row else None

    def get_all_run_approvals(self, run_id: str) -> Dict[str, Dict[str, Any]]:
        """Return all recorded approvals for a run keyed by approval_type."""
        with self._get_connection() as conn:
            rows = conn.execute(
                "SELECT * FROM dossier_approvals WHERE run_id = ? ORDER BY approved_at ASC;",
                (run_id,),
            ).fetchall()
            return {row["approval_type"]: dict(row) for row in rows}

    def backup_database(self, backup_path: str) -> None:
        """Creates a consistent online SQLite backup at backup_path."""
        backup_file = Path(backup_path).resolve()
        backup_file.parent.mkdir(parents=True, exist_ok=True)
        with self._get_connection() as src_conn:
            dest_conn = sqlite3.connect(str(backup_file))
            try:
                src_conn.backup(dest_conn)
            finally:
                dest_conn.close()

    def restore_database(self, backup_path: str) -> None:
        """Restores database from an external backup file and validates integrity."""
        backup_file = Path(backup_path).resolve()
        if not backup_file.exists():
            raise FileNotFoundError(f"Backup file '{backup_path}' does not exist.")

        with sqlite3.connect(str(backup_file)) as src_conn:
            dest_conn = self._get_connection()
            try:
                src_conn.backup(dest_conn)
            finally:
                dest_conn.close()
