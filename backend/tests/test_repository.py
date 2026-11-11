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


if __name__ == "__main__":
    unittest.main()
