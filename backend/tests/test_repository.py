"""
AeroCascade — SQLite Topology Repository & Canonical Model Test Suite
Verifies:
- Versioned canonical topology model and single simulation input adapter
- Provider-to-dependent explicit edge directions and synthetic source provenance
- SQLite schema migrations
- Acceptance Criteria:
  1. Save and reopen after restart (persistent database reload)
  2. Edit without changing older version (immutable versions)
  3. Clone without changing original (new identity and origin lineage)
  4. Reject stale write (optimistic locking expected_version check)
  5. Restore database backup and verify run links
"""

import json
import os
import shutil
import sqlite3
import tempfile
import unittest

from backend.canonical import (
    CanonicalDependency,
    CanonicalNode,
    CanonicalSourceProvenance,
    CanonicalTopology,
    canonical_to_simulation_request,
    preset_dict_to_canonical_topology,
)
from backend.models import (
    CascadeStage,
    ControlCategory,
    ER040Severity,
    FMEAMetrics,
    PSOELevel,
    SimulationRequest,
    TripartiteControls,
)
from backend.repository import (
    StaleVersionConflictError,
    TopologyNotFoundError,
    TopologyRepository,
)
from backend.simpy_engine import run_cascade_simulation


class TestTopologyRepository(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.temp_dir, "test_aerocascade.db")
        self.repo = TopologyRepository(self.db_path)

    def tearDown(self):
        shutil.rmtree(self.temp_dir, ignore_errors=True)

    def _make_sample_canonical(self, topo_id="sample-rtc-twin", name="Sample RTC Twin") -> CanonicalTopology:
        nodes = [
            CanonicalNode(
                id="node-sensor-01",
                code="S1-OPT-01",
                label="360 Optical Mast",
                subsystem="Surveillance",
                stage=CascadeStage.STAGE_1_TRIGGER,
                dominant_control=ControlCategory.TECHNICAL,
                description="Optical cameras",
                failure_mode="Video freeze",
                tripartite=TripartiteControls(technical=60.0, formal=50.0, informal=40.0),
                fmea=FMEAMetrics(likelihood=4, impact=4, recovery_complexity=4, policy_investment=60),
                psoe_status=PSOELevel.OPERATIONAL,
                er040_severity=ER040Severity.HAZARDOUS_2,
            ),
            CanonicalNode(
                id="node-fusion-02",
                code="S2-FUS-02",
                label="Sensor Fusion Engine",
                subsystem="Core Processing",
                stage=CascadeStage.STAGE_2_PROPAGATION,
                dominant_control=ControlCategory.TECHNICAL,
                description="Radar and video fusion",
                failure_mode="Track drop",
                tripartite=TripartiteControls(technical=55.0, formal=50.0, informal=45.0),
                fmea=FMEAMetrics(likelihood=3, impact=4, recovery_complexity=4, policy_investment=50),
                psoe_status=PSOELevel.OPERATIONAL,
                er040_severity=ER040Severity.MAJOR_3,
            ),
            CanonicalNode(
                id="node-governance-03",
                code="S3-GOV-03",
                label="Contingency SOP Escalation",
                subsystem="Governance",
                stage=CascadeStage.STAGE_3_BLOCKER,
                dominant_control=ControlCategory.FORMAL,
                description="Supervisor procedural reversion",
                failure_mode="Delayed ground stop decision",
                tripartite=TripartiteControls(technical=40.0, formal=30.0, informal=35.0),
                fmea=FMEAMetrics(likelihood=5, impact=5, recovery_complexity=5, policy_investment=25),
                psoe_status=PSOELevel.PRESENT,
                er040_severity=ER040Severity.HAZARDOUS_2,
            ),
        ]
        deps = [
            CanonicalDependency(
                id="dep-sensor-to-fusion",
                provider_node_id="node-sensor-01",   # Provider
                dependent_node_id="node-fusion-02",  # Dependent
                coupling_weight=0.90,
                propagation_mechanism="Corrupted frame stream overflows fusion buffer",
                protocol_layer="RTP/UDP",
            ),
            CanonicalDependency(
                id="dep-fusion-to-gov",
                provider_node_id="node-fusion-02",       # Provider
                dependent_node_id="node-governance-03",  # Dependent
                coupling_weight=0.85,
                propagation_mechanism="Sensor track loss triggers supervisor manual audit",
                protocol_layer="Application/Voice",
            ),
        ]
        return CanonicalTopology(
            schema_version="1.0.0",
            topology_id=topo_id,
            name=name,
            description="Synthetic Remote Tower Centre benchmark model",
            version=1,
            aerodrome_profile="Regional Hub (48 mvmt/hr)",
            baseline_movements_per_hour=48.0,
            trigger_hour=4.0,
            horizon_hours=24.0,
            cost_per_delayed_movement=7500.0,
            source_provenance=CanonicalSourceProvenance(
                author="Aryan Aggarwal & Gurpreet Dhillon",
                synthetic_fixture=True,
                source_document="AIAA 2026 Synthetic Fixture",
            ),
            nodes=nodes,
            dependencies=deps,
        )

    def test_canonical_adapter_and_explicit_edge_direction(self):
        """Verifies canonical topology adapter maps provider -> source and dependent -> target."""
        canonical = self._make_sample_canonical()
        req = canonical_to_simulation_request(canonical)

        self.assertIsInstance(req, SimulationRequest)
        self.assertEqual(req.scenario_id, canonical.topology_id)
        self.assertEqual(len(req.nodes), 3)
        self.assertEqual(len(req.edges), 2)

        # Explicit provider-to-dependent direction check
        edge1 = req.edges[0]
        self.assertEqual(edge1.id, "dep-sensor-to-fusion")
        self.assertEqual(edge1.source, "node-sensor-01", "Provider must map to edge.source")
        self.assertEqual(edge1.target, "node-fusion-02", "Dependent must map to edge.target")

        # Initiating event check for Stage 1 trigger node
        self.assertEqual(len(req.initiating_events), 1)
        self.assertEqual(req.initiating_events[0].node_id, "node-sensor-01")
        self.assertEqual(req.initiating_events[0].event_time_hours, 4.0)

    def test_acceptance_1_save_and_reopen_after_restart(self):
        """Acceptance 1: Save named topology, re-initialize repository from disk, verify data integrity."""
        canonical = self._make_sample_canonical(topo_id="persistent-twin", name="Persistent Twin")
        created = self.repo.create_topology(
            name="Persistent Twin",
            canonical=canonical,
            description="Created for restart verification",
        )
        self.assertEqual(created["id"], "persistent-twin")
        self.assertEqual(created["current_version"], 1)

        # Simulate restart: open a completely new repository instance pointing to the same SQLite file
        restarted_repo = TopologyRepository(self.db_path)
        topos = restarted_repo.list_topologies()
        match = [t for t in topos if t["id"] == "persistent-twin"]
        self.assertEqual(len(match), 1, "Topology must persist across restart")

        ver1 = restarted_repo.get_version("persistent-twin", 1)
        self.assertEqual(ver1["version"], 1)
        self.assertEqual(ver1["canonical"]["name"], "Persistent Twin")
        self.assertEqual(len(ver1["canonical"]["nodes"]), 3)
        self.assertEqual(len(ver1["canonical"]["dependencies"]), 2)
        self.assertEqual(ver1["canonical"]["source_provenance"]["synthetic_fixture"], True)

    def test_acceptance_2_edit_without_changing_older_version(self):
        """Acceptance 2: Modify topology and save v2; older v1 must remain strictly immutable."""
        canonical_v1 = self._make_sample_canonical(topo_id="versioned-twin", name="Versioned Twin")
        self.repo.create_topology(name="Versioned Twin", canonical=canonical_v1)

        # Prepare v2 with modified controls and additional node
        ver1_data = self.repo.get_version("versioned-twin", 1)
        canonical_v2 = CanonicalTopology(**ver1_data["canonical"])
        # Edit node 0 technical control from 60 to 95
        canonical_v2.nodes[0].tripartite.technical = 95.0
        canonical_v2.baseline_movements_per_hour = 60.0

        v2_record = self.repo.save_new_version(
            topology_id="versioned-twin",
            canonical=canonical_v2,
            expected_version=1,
            change_summary="Upgraded optical sensor encryption and increased demand to 60",
        )
        self.assertEqual(v2_record["version"], 2)

        # Verify v1 remains unchanged
        v1_check = self.repo.get_version("versioned-twin", 1)
        self.assertEqual(
            v1_check["canonical"]["nodes"][0]["tripartite"]["technical"],
            60.0,
            "Older version v1 must not be modified when v2 is saved",
        )
        self.assertEqual(v1_check["canonical"]["baseline_movements_per_hour"], 48.0)

        # Verify v2 has the new values
        v2_check = self.repo.get_version("versioned-twin", 2)
        self.assertEqual(v2_check["canonical"]["nodes"][0]["tripartite"]["technical"], 95.0)
        self.assertEqual(v2_check["canonical"]["baseline_movements_per_hour"], 60.0)

    def test_acceptance_3_clone_without_changing_original(self):
        """Acceptance 3: Clone gets a new identity and records its origin; original is untouched."""
        canonical = self._make_sample_canonical(topo_id="orig-twin", name="Original Twin")
        self.repo.create_topology(name="Original Twin", canonical=canonical)

        # Clone from original
        cloned = self.repo.clone_topology(
            source_topology_id="orig-twin",
            new_name="Cloned Branch Twin",
            source_version=1,
            description="Branch twin for experimental stress testing",
        )

        self.assertNotEqual(cloned["id"], "orig-twin", "Clone must have a distinct new identity")
        self.assertEqual(cloned["name"], "Cloned Branch Twin")
        self.assertEqual(cloned["origin_topology_id"], "orig-twin")
        self.assertEqual(cloned["origin_version"], 1)
        self.assertEqual(cloned["current_version"], 1)

        # Check clone's source provenance
        clone_v1 = self.repo.get_version(cloned["id"], 1)
        prov = clone_v1["canonical"]["source_provenance"]
        self.assertEqual(prov["cloned_from_id"], "orig-twin")
        self.assertEqual(prov["cloned_from_version"], 1)

        # Verify original topology is unchanged
        orig = self.repo.get_topology("orig-twin")
        self.assertEqual(orig["current_version"], 1)
        self.assertEqual(orig["name"], "Original Twin")

    def test_acceptance_4_reject_stale_write(self):
        """Acceptance 4: Optimistic locking rejects conflicting saves using expected_version."""
        canonical = self._make_sample_canonical(topo_id="conflict-twin", name="Conflict Twin")
        self.repo.create_topology(name="Conflict Twin", canonical=canonical)

        # Client A and Client B both read version 1
        v1_for_a = self.repo.get_version("conflict-twin", 1)
        v1_for_b = self.repo.get_version("conflict-twin", 1)

        # Client A saves version 2 successfully with expected_version=1
        canonical_a = CanonicalTopology(**v1_for_a["canonical"])
        canonical_a.nodes[0].tripartite.technical = 80.0
        self.repo.save_new_version("conflict-twin", canonical_a, expected_version=1, change_summary="A's edit")

        # Client B attempts to save with stale expected_version=1
        canonical_b = CanonicalTopology(**v1_for_b["canonical"])
        canonical_b.nodes[0].tripartite.technical = 40.0

        with self.assertRaises(StaleVersionConflictError) as ctx:
            self.repo.save_new_version("conflict-twin", canonical_b, expected_version=1, change_summary="B's stale edit")

        self.assertIn("Conflict: expected version 1, but current version is 2", str(ctx.exception))

        # Current version remains 2, containing A's edit
        current = self.repo.get_version("conflict-twin", 2)
        self.assertEqual(current["canonical"]["nodes"][0]["tripartite"]["technical"], 80.0)

    def test_acceptance_5_restore_database_backup_and_verify_run_links(self):
        """Acceptance 5: Record completed runs, create backup, restore into another instance, verify run links."""
        canonical = self._make_sample_canonical(topo_id="run-twin", name="Run Twin")
        self.repo.create_topology(name="Run Twin", canonical=canonical)

        # Execute simulation for version 1
        req = canonical_to_simulation_request(canonical)
        sim_res = run_cascade_simulation(req)

        # Record run
        run_info = self.repo.record_run(
            topology_id="run-twin",
            topology_version=1,
            request=req,
            response=sim_res,
        )
        self.assertTrue(run_info["run_id"])

        # Create online backup
        backup_file = os.path.join(self.temp_dir, "aerocascade_backup.db")
        self.repo.backup_database(backup_file)
        self.assertTrue(os.path.exists(backup_file))

        # Restore into a fresh database location
        restored_db_path = os.path.join(self.temp_dir, "aerocascade_restored.db")
        restored_repo = TopologyRepository(restored_db_path)
        restored_repo.restore_database(backup_file)

        # Verify run links in restored database
        runs = restored_repo.list_runs(topology_id="run-twin", topology_version=1)
        self.assertEqual(len(runs), 1)
        self.assertEqual(runs[0]["run_id"], run_info["run_id"])
        self.assertEqual(runs[0]["engine_version"], "2.0.0-causal")

        # Full run retrieval
        full_run = restored_repo.get_run(run_info["run_id"])
        self.assertEqual(full_run["topology_id"], "run-twin")
        self.assertEqual(full_run["topology_version"], 1)
        self.assertIn("events", full_run["result"])

    def test_atomic_migration_interruption_and_rollback(self):
        """Verifies an interrupted migration rolls back cleanly and does not reclassify or lose approvals."""
        db_file = os.path.join(self.temp_dir, "interrupted_migration.db")
        # Build schema up to migration 2 manually
        conn = sqlite3.connect(db_file)
        from backend.repository import _migrate_001, _migrate_002
        _migrate_001(conn)
        _migrate_002(conn)
        conn.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT);")
        conn.execute("INSERT INTO schema_migrations VALUES (1, '001'), (2, '002');")
        conn.execute("INSERT INTO topologies VALUES ('topo-1', 'Topo 1', '', NULL, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);")
        conn.execute("INSERT INTO topology_versions VALUES ('topo-1:v1', 'topo-1', 1, '{}', '{}', '', CURRENT_TIMESTAMP);")
        conn.execute("INSERT INTO simulation_runs VALUES ('run-atomic-1', 'topo-1', 1, '2.0.0', 42, 1, '{\"topology_version\": 1}', '{}', CURRENT_TIMESTAMP);")
        conn.execute("INSERT INTO dossier_approvals VALUES ('run-atomic-1', 'Orig Approver', 'approver', 'Original notes', 'sha_atom_1', '2026-01-01T00:00:00Z');")
        conn.commit()
        conn.close()

        # Simulate an interrupted migration 3
        conn2 = sqlite3.connect(db_file)
        conn2.isolation_level = None
        conn2.execute("BEGIN IMMEDIATE;")
        try:
            conn2.execute("CREATE TABLE dossier_approvals_v3 (run_id TEXT, approval_type TEXT);")
            conn2.execute("INSERT INTO dossier_approvals_v3 VALUES ('run-atomic-1', 'legacy');")
            # Simulate crash / interruption
            raise RuntimeError("Simulated crash mid-migration 3")
            conn2.execute("INSERT INTO schema_migrations VALUES (3, '003');")
            conn2.execute("COMMIT;")
        except RuntimeError:
            conn2.execute("ROLLBACK;")
        conn2.close()

        # Verify rollback left v2 schema intact
        conn3 = sqlite3.connect(db_file)
        cols = [r[1] for r in conn3.execute("PRAGMA table_info(dossier_approvals);").fetchall()]
        self.assertNotIn("approval_type", cols, "Rollback must leave old table structure intact")
        old_row = conn3.execute("SELECT * FROM dossier_approvals WHERE run_id = 'run-atomic-1';").fetchone()
        self.assertIsNotNone(old_row)
        self.assertEqual(old_row[3], "Original notes")
        migs = [r[0] for r in conn3.execute("SELECT version FROM schema_migrations;").fetchall()]
        self.assertEqual(migs, [1, 2], "schema_migrations must remain at version 2")
        conn3.close()

        # Now open through TopologyRepository, allowing migration 3 to complete atomically
        repo = TopologyRepository(db_file)
        migrated_approval = repo.get_run_approval("run-atomic-1")
        self.assertIsNotNone(migrated_approval)
        self.assertEqual(migrated_approval["approval_type"], "legacy")
        self.assertEqual(migrated_approval["signoff_notes"], "Original notes")
        with repo._get_connection() as c:
            new_migs = [r["version"] for r in c.execute("SELECT version FROM schema_migrations;").fetchall()]
            self.assertEqual(new_migs, [1, 2, 3])

    def test_restore_pre_migration_backup_upgrades_copy_before_replacing_live(self):
        """Pre-migration SQLite backup is upgraded in a copy before atomically replacing the live database."""
        # 1. Create a pre-migration (schema v2) backup
        backup_file = os.path.join(self.temp_dir, "premigration_backup.db")
        conn = sqlite3.connect(backup_file)
        conn.execute("CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT);")
        conn.execute("INSERT INTO schema_migrations VALUES (1, '001_initial'), (2, '002_dossier_approvals');")
        conn.execute("CREATE TABLE topologies (id TEXT PRIMARY KEY, name TEXT, description TEXT, origin_topology_id TEXT, origin_version INTEGER, current_version INTEGER NOT NULL DEFAULT 1, created_at TIMESTAMP, updated_at TIMESTAMP);")
        conn.execute("CREATE TABLE topology_versions (id TEXT PRIMARY KEY, topology_id TEXT, version INTEGER, canonical_data TEXT, resolved_input TEXT, change_summary TEXT, created_at TIMESTAMP);")
        conn.execute("CREATE TABLE simulation_runs (run_id TEXT PRIMARY KEY, topology_id TEXT, topology_version INTEGER, engine_version TEXT, random_seed INTEGER, replicates INTEGER, resolved_input TEXT, result TEXT, executed_at TIMESTAMP);")
        conn.execute("CREATE TABLE dossier_approvals (run_id TEXT PRIMARY KEY, approver TEXT, approver_role TEXT, signoff_notes TEXT, run_sha256 TEXT, approved_at TEXT);")
        conn.execute("INSERT INTO topologies VALUES ('t-pre', 'Pre-Migration Topo', '', NULL, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);")
        conn.execute("INSERT INTO topology_versions VALUES ('t-pre:v1', 't-pre', 1, '{}', '{}', '', CURRENT_TIMESTAMP);")
        conn.execute("INSERT INTO simulation_runs VALUES ('run-pre-1', 't-pre', 1, '2.0.0', 42, 1, '{\"topology_version\": 1}', '{}', CURRENT_TIMESTAMP);")
        conn.execute("INSERT INTO dossier_approvals VALUES ('run-pre-1', 'Legacy User', 'approver', 'Pre-migration notes', 'sha_pre_1', '2026-01-01T00:00:00Z');")
        conn.commit()
        conn.close()

        # 2. Live database has current schema
        live_db_file = os.path.join(self.temp_dir, "live_db.db")
        live_repo = TopologyRepository(live_db_file)

        # 3. Restore pre-migration backup through the restore path
        live_repo.restore_database(backup_file)

        # 4. Verify live database now contains upgraded schema v3 and migrated legacy approval
        with live_repo._get_connection() as c:
            migs = [r["version"] for r in c.execute("SELECT version FROM schema_migrations;").fetchall()]
            self.assertEqual(migs, [1, 2, 3])
            cols = [r["name"] for r in c.execute("PRAGMA table_info(dossier_approvals);").fetchall()]
            self.assertIn("approval_type", cols)

        restored_approval = live_repo.get_run_approval("run-pre-1")
        self.assertIsNotNone(restored_approval)
        self.assertEqual(restored_approval["approval_type"], "legacy")
        self.assertEqual(restored_approval["approver"], "Legacy User")
        self.assertEqual(restored_approval["signoff_notes"], "Pre-migration notes")

        # 5. Live database can record an enterprise approval without collision
        ent_approval = live_repo.approve_run(
            run_id="run-pre-1",
            approver="authenticated-authority",
            approver_role="approver",
            notes="Enterprise sign-off after restore",
            run_sha256="sha_ent_1",
            approval_type="enterprise",
            topology_id="t-pre",
            topology_version=1,
            authenticated_account="authenticated-authority",
        )
        self.assertIsNotNone(ent_approval)
        self.assertEqual(ent_approval["approval_type"], "enterprise")

    def test_restore_corrupt_backup_rejected_and_preserves_live(self):
        """Restoring a corrupted backup raises an error and leaves the live database untouched."""
        live_db_file = os.path.join(self.temp_dir, "live_db_corrupt_test.db")
        live_repo = TopologyRepository(live_db_file)
        canonical = self._make_sample_canonical(topo_id="keep-me", name="Keep Me")
        live_repo.create_topology(name="Keep Me", canonical=canonical)

        corrupt_backup = os.path.join(self.temp_dir, "corrupt.db")
        with open(corrupt_backup, "wb") as f:
            f.write(b"NOT_A_VALID_SQLITE_DATABASE_HEADER_DATA_1234567890")

        with self.assertRaises(ValueError):
            live_repo.restore_database(corrupt_backup)

        # Live database is completely untouched
        self.assertIsNotNone(live_repo.get_topology("keep-me"))


if __name__ == "__main__":
    unittest.main()
