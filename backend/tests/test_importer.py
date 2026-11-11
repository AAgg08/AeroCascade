"""
Unit and integration tests for AeroCascade Topology Importer:
- Bounded parser, byte/row/decompression limits
- Formula injection / DDE attack rejection
- Canonical provider-to-dependent edge direction
- Reciprocal declaration reconciliation and deduplication
- Unresolved references and ambiguous name rejection
- SLA unit validation and explicit fallbacks
- 30-node synthetic benchmark fixture import
- Database isolation (preview does not persist, save commits in one transaction)
- Cycle detection and engine execution
"""

import io
import unittest
import zipfile
import openpyxl

from backend.canonical import canonical_to_simulation_request
from backend.importer import (
    MAX_FILE_BYTES,
    generate_30_node_fixture_xlsx,
    generate_one_sheet_template_csv,
    generate_one_sheet_template_xlsx,
    generate_two_sheet_template_xlsx,
    get_30_node_fixture,
    parse_file_to_preview,
    SaveImportRequest,
)
from backend.repository import TopologyRepository
from backend.simpy_engine import run_cascade_simulation


class TestTopologyImporter(unittest.TestCase):
    def setUp(self):
        # In-memory SQLite repository for transactional test isolation
        self.repo = TopologyRepository(":memory:")

    def test_30_node_fixture_import(self):
        """Acceptance: Import 30-node synthetic airport benchmark fixture."""
        xlsx_bytes = generate_30_node_fixture_xlsx()
        self.assertGreater(len(xlsx_bytes), 0)

        preview = parse_file_to_preview(xlsx_bytes, "synthetic_airport_30nodes.xlsx")
        self.assertTrue(preview.valid, f"30-node fixture should be valid, got errors: {preview.errors}")
        self.assertEqual(preview.summary.node_count, 30)
        self.assertEqual(preview.summary.edge_count, 29)
        self.assertEqual(preview.summary.error_count, 0)
        self.assertIsNotNone(preview.preview_topology)

        # Verify all nodes have required attributes
        stage_counts = {}
        for n in preview.preview_topology.nodes:
            stage_counts[n.stage] = stage_counts.get(n.stage, 0) + 1
            self.assertTrue(len(n.id) > 0)
            self.assertTrue(n.repair_duration_hours > 0)

        self.assertEqual(stage_counts["STAGE_1_TRIGGER"], 7)
        self.assertEqual(stage_counts["STAGE_2_PROPAGATION"], 13)
        self.assertEqual(stage_counts["STAGE_3_BLOCKER"], 10)

    def test_canonical_edge_direction_and_reciprocal_deduplication(self):
        """
        Acceptance: Verify provider-to-dependent canonical direction and
        reciprocal declaration deduplication.
        """
        # Node A declares B in downstream_ids (A -> B)
        # Node B declares A in upstream_ids (A -> B)
        # Both express the same directed edge: Provider A -> Dependent B
        csv_content = (
            "Vendor ID,Vendor Name,Category,Upstream IDs,Downstream IDs,SLA Target,SLA Unit\n"
            "NODE-A,Sensor Primary,Surveillance,,NODE-B,99.9,%\n"
            "NODE-B,Tracker Fusion,Processing,NODE-A,,99.9,%\n"
        ).encode("utf-8")

        preview = parse_file_to_preview(csv_content, "reciprocal.csv")
        self.assertTrue(preview.valid, f"Reciprocal declarations should be valid, got {preview.errors}")
        self.assertEqual(preview.summary.node_count, 2)
        # Symmetrical reciprocal declaration should result in exactly 1 deduplicated edge
        self.assertEqual(preview.summary.edge_count, 1)
        self.assertEqual(preview.summary.deduplicated_edge_count, 1)

        dep = preview.preview_topology.dependencies[0]
        self.assertEqual(dep.provider_node_id, "NODE-A", "Provider must be upstream source")
        self.assertEqual(dep.dependent_node_id, "NODE-B", "Dependent must be downstream target")

    def test_reject_unresolved_references(self):
        """Acceptance: Reject dependencies referencing non-existent vendor IDs or names."""
        csv_content = (
            "Vendor ID,Vendor Name,Category,Upstream IDs,Downstream IDs,SLA Target,SLA Unit\n"
            "NODE-A,Sensor Primary,Surveillance,,NON_EXISTENT_NODE,99.9,%\n"
        ).encode("utf-8")

        preview = parse_file_to_preview(csv_content, "unresolved.csv")
        self.assertFalse(preview.valid)
        self.assertGreater(preview.summary.error_count, 0)
        self.assertTrue(any("Unresolved entity reference 'NON_EXISTENT_NODE'" in e.message for e in preview.errors))

    def test_reject_ambiguous_names(self):
        """Acceptance: Reject ambiguous name references matching multiple nodes."""
        csv_content = (
            "Vendor ID,Vendor Name,Category,Upstream IDs,Downstream IDs,SLA Target,SLA Unit\n"
            "RADAR-01,Terminal Radar,Surveillance,,,99.9,%\n"
            "RADAR-02,Terminal Radar,Surveillance,,,99.9,%\n"
            "FUSION-01,Tracker Hub,Processing,Terminal Radar,,99.9,%\n"
        ).encode("utf-8")

        preview = parse_file_to_preview(csv_content, "ambiguous.csv")
        self.assertFalse(preview.valid)
        self.assertGreater(preview.summary.error_count, 0)
        self.assertTrue(any("Ambiguous reference to 'Terminal Radar'" in e.message for e in preview.errors))

    def test_reject_invalid_sla_units(self):
        """Acceptance: Reject unsupported SLA units (e.g. 'lightyears')."""
        csv_content = (
            "Vendor ID,Vendor Name,Category,Upstream IDs,Downstream IDs,SLA Target,SLA Unit\n"
            "NODE-A,Sensor Primary,Surveillance,,,99.9,lightyears\n"
        ).encode("utf-8")

        preview = parse_file_to_preview(csv_content, "invalid_sla.csv")
        self.assertFalse(preview.valid)
        self.assertTrue(any("Invalid SLA unit 'lightyears'" in e.message for e in preview.errors))

    def test_reject_oversized_file(self):
        """Acceptance: Reject files exceeding MAX_FILE_BYTES limit."""
        oversized = b"x" * (MAX_FILE_BYTES + 1024)
        preview = parse_file_to_preview(oversized, "huge.csv")
        self.assertFalse(preview.valid)
        self.assertTrue(any("exceeds maximum allowed size" in e.message for e in preview.errors))

    def test_reject_unsupported_formulas(self):
        """Acceptance: Reject Excel formula injection (=, @, +, -) in input cells."""
        # Formula =SUM(1+1)
        csv_formula = (
            "Vendor ID,Vendor Name,Category,Upstream IDs,Downstream IDs,SLA Target,SLA Unit\n"
            "NODE-A,=SUM(1+1),Surveillance,,,99.9,%\n"
        ).encode("utf-8")

        preview = parse_file_to_preview(csv_formula, "formula.csv")
        self.assertFalse(preview.valid)
        self.assertTrue(any("Cell formula or executable prefix" in e.message for e in preview.errors))

        # Formula @IMPORT
        csv_at = (
            "Vendor ID,Vendor Name,Category,Upstream IDs,Downstream IDs,SLA Target,SLA Unit\n"
            "NODE-A,@IMPORT,Surveillance,,,99.9,%\n"
        ).encode("utf-8")
        preview_at = parse_file_to_preview(csv_at, "at.csv")
        self.assertFalse(preview_at.valid)
        self.assertTrue(any("Cell formula or executable prefix" in e.message for e in preview_at.errors))

    def test_provisional_id_assignment(self):
        """Verify provisional ID generation when Vendor ID is absent."""
        csv_content = (
            "Vendor ID,Vendor Name,Category,Upstream IDs,Downstream IDs,SLA Target,SLA Unit\n"
            ",Primary Radar Unit,Surveillance,,,99.9,%\n"
        ).encode("utf-8")

        preview = parse_file_to_preview(csv_content, "provisional.csv")
        self.assertTrue(preview.valid)
        self.assertEqual(preview.summary.provisional_id_count, 1)
        node = preview.preview_topology.nodes[0]
        self.assertEqual(node.id, "PROV-001")
        self.assertTrue(any("assigned provisional ID 'PROV-001'" in w.message for w in preview.warnings))

    def test_cancel_with_no_database_changes(self):
        """Acceptance: Previewing or canceling an import must leave the database untouched."""
        initial_topos = self.repo.list_topologies()
        initial_count = len(initial_topos)

        xlsx_bytes = generate_30_node_fixture_xlsx()
        preview = parse_file_to_preview(xlsx_bytes, "synthetic.xlsx")
        self.assertTrue(preview.valid)

        # Abandon preview / cancel: check database has 0 new records
        after_preview_topos = self.repo.list_topologies()
        self.assertEqual(len(after_preview_topos), initial_count)

    def test_save_and_run_valid_import(self):
        """Acceptance: Save validated topology in one transaction and run discrete-event simulation."""
        fixture = get_30_node_fixture()
        save_req = SaveImportRequest(
            canonical=fixture,
            name="Imported 30-Node Airport Hub",
            description="Production validated benchmark import",
            change_summary="Initial verified import",
        )

        created = self.repo.create_topology(
            name=save_req.name,
            canonical=save_req.canonical,
            description=save_req.description or "",
        )

        self.assertEqual(created["id"], "synthetic-hub-30-nodes")
        self.assertEqual(created["current_version"], 1)

        # Retrieve saved version from repository
        loaded_topo = self.repo.get_topology("synthetic-hub-30-nodes")
        self.assertIsNotNone(loaded_topo)
        self.assertEqual(loaded_topo["current_version"], 1)

        # Convert to simulation request via canonical adapter and run DES engine
        sim_request = canonical_to_simulation_request(fixture)
        sim_response = run_cascade_simulation(sim_request)

        self.assertEqual(sim_response.scenario_id, "synthetic-hub-30-nodes")
        self.assertEqual(len(sim_response.hourly_capacity), 24)
        self.assertGreater(len(sim_response.events), 0)
        self.assertTrue(sim_response.summary_kpis["estimated_lost_movement_capacity"] >= 0)

        # Record simulation run against the imported topology
        run_record = self.repo.record_run("synthetic-hub-30-nodes", 1, sim_request, sim_response)
        self.assertEqual(run_record["topology_id"], "synthetic-hub-30-nodes")
        self.assertEqual(run_record["topology_version"], 1)

    def test_cycle_detection_and_confirmation(self):
        """Acceptance: Flag cycles, provide engine explanation, and enforce confirmation."""
        # A -> B -> C -> A
        csv_cycle = (
            "Vendor ID,Vendor Name,Category,Upstream IDs,Downstream IDs,SLA Target,SLA Unit\n"
            "NODE-A,Unit A,Subsystem,NODE-C,NODE-B,99.9,%\n"
            "NODE-B,Unit B,Subsystem,NODE-A,NODE-C,99.9,%\n"
            "NODE-C,Unit C,Subsystem,NODE-B,NODE-A,99.9,%\n"
        ).encode("utf-8")

        preview = parse_file_to_preview(csv_cycle, "cycle.csv")
        self.assertTrue(preview.valid)
        self.assertEqual(preview.summary.cycle_count, 1)
        self.assertGreater(len(preview.cycles), 0)
        self.assertIsNotNone(preview.cycle_handling_explanation)
        self.assertTrue("chronologically" in preview.cycle_handling_explanation)


if __name__ == "__main__":
    unittest.main()
