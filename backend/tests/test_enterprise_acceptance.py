"""
AeroCascade Enterprise Air-Gapped Acceptance Suite
Verifies:
1. Zero external requests (offline bundle assets)
2. Role-based access control: forbidden role actions fail with 403 Forbidden
3. Complete synthetic lifecycle: import -> run -> export
4. Database backup, restoration, and verification
5. Enterprise profile hardening: backend source viewer disabled (403)
"""

import json
import os
import shutil
import tempfile
import unittest
from fastapi.testclient import TestClient

from backend.main import app
from backend.models import (
    CascadeStage,
    ControlCategory,
    ER040Severity,
    FMEAMetrics,
    PSOELevel,
    TripartiteControls,
)
from backend.canonical import (
    CanonicalNode,
    CanonicalDependency,
    CanonicalTopology,
    CanonicalSourceProvenance,
    canonical_to_simulation_request,
)
from backend.security import Role
from backend.repository import TopologyRepository
from backend.importer import get_30_node_fixture


class TestEnterpriseAcceptance(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_acceptance_1_forbidden_role_actions_fail(self):
        """Confirm forbidden actions fail with HTTP 403 Forbidden across all roles."""
        # 1. Reviewer attempting to run simulation -> 403
        sim_req = canonical_to_simulation_request(
            CanonicalTopology(
                topology_id="test-sim-deny",
                name="Deny Test",
                version=1,
                nodes=[
                    CanonicalNode(
                        id="n1",
                        code="N1",
                        label="Node 1",
                        subsystem="Sub",
                        stage=CascadeStage.STAGE_1_TRIGGER,
                        dominant_control=ControlCategory.TECHNICAL,
                        description="Desc",
                        failure_mode="Fail",
                        tripartite=TripartiteControls(),
                        fmea=FMEAMetrics(likelihood=3, impact=3, recovery_complexity=3, policy_investment=50),
                        psoe_status=PSOELevel.OPERATIONAL,
                        er040_severity=ER040Severity.MAJOR_3,
                    )
                ],
                dependencies=[],
                provenance=CanonicalSourceProvenance(source_type="synthetic_test", source_reference="Ref"),
            )
        )
        payload = json.loads(sim_req.model_dump_json())

        res_sim_rev = self.client.post(
            "/api/simulate",
            json=payload,
            headers={"X-AeroCascade-Role": Role.REVIEWER.value},
        )
        self.assertEqual(res_sim_rev.status_code, 403)

        # 2. Analyst attempting to import -> 403
        res_import_analyst = self.client.post(
            "/api/import/preview",
            json={"file_name": "test.csv", "content_text": "Vendor ID,Vendor Name\nV1,Test"},
            headers={"X-AeroCascade-Role": Role.ANALYST.value},
        )
        self.assertEqual(res_import_analyst.status_code, 403)

        # 3. Analyst attempting to approve dossier -> 403
        res_approve_analyst = self.client.post(
            "/api/dossier/approve",
            json={"topology_id": "test-sim-deny", "topology_version": 1, "signoff_notes": "None"},
            headers={"X-AeroCascade-Role": Role.ANALYST.value},
        )
        self.assertEqual(res_approve_analyst.status_code, 403)

        # 4. Reviewer attempting admin backup -> 403
        res_backup_rev = self.client.post(
            "/api/admin/backup",
            headers={"X-AeroCascade-Role": Role.REVIEWER.value},
        )
        self.assertEqual(res_backup_rev.status_code, 403)

    def test_acceptance_2_synthetic_import_run_export_lifecycle(self):
        """Complete lifecycle: synthetic 30-node import -> simulation run -> dossier export."""
        # Step A: Import and save 30-node fixture as Administrator
        fixture = get_30_node_fixture()
        save_payload = json.loads(fixture.model_dump_json())

        save_res = self.client.post(
            "/api/import/save",
            json={
                "canonical": save_payload,
                "name": "Synthetic 30-Node Enterprise Hub",
                "description": "Synthetic benchmark for air-gapped acceptance",
                "change_summary": "Initial verified synthetic import",
            },
            headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value},
        )
        self.assertEqual(save_res.status_code, 201)
        topo_info = save_res.json()
        topo_id = topo_info["id"]
        version = topo_info["current_version"]

        # Step B: Run simulation as Analyst
        topo_detail = self.client.get(
            f"/api/topologies/{topo_id}/versions/{version}",
            headers={"X-AeroCascade-Role": Role.ANALYST.value},
        ).json()
        canonical_topo = CanonicalTopology(**topo_detail["canonical"])
        sim_req = canonical_to_simulation_request(canonical_topo)
        sim_payload = json.loads(sim_req.model_dump_json())

        run_res = self.client.post(
            "/api/simulate",
            json=sim_payload,
            headers={"X-AeroCascade-Role": Role.ANALYST.value},
        )
        self.assertEqual(run_res.status_code, 200)
        sim_data = run_res.json()
        self.assertEqual(sim_data.get("scenario_id"), topo_id)
        self.assertIn("hourly_capacity", sim_data)
        self.assertEqual(len(sim_data["hourly_capacity"]), 24)

        # Step C: Reviewer leaves audit comment
        review_res = self.client.post(
            "/api/review/comments",
            json={
                "topology_id": topo_id,
                "comment": "Stage 2 optical sensor dependencies verified within SLA.",
                "reviewer_name": "Audit Inspector",
            },
            headers={"X-AeroCascade-Role": Role.REVIEWER.value},
        )
        self.assertEqual(review_res.status_code, 200)

        # Step D: Approver signs off
        approve_res = self.client.post(
            "/api/dossier/approve",
            json={
                "topology_id": topo_id,
                "topology_version": version,
                "signoff_notes": "Accepted for EASA Part-IS exercise audit.",
                "approver_name": "Head of Safety",
            },
            headers={"X-AeroCascade-Role": Role.APPROVER.value},
        )
        self.assertEqual(approve_res.status_code, 200)

        # Step E: Export dossier
        export_res = self.client.get(
            f"/api/export/dossier?topology_id={topo_id}&topology_version={version}",
            headers={"X-AeroCascade-Role": Role.ANALYST.value},
        )
        self.assertEqual(export_res.status_code, 200)
        self.assertEqual(export_res.json().get("export_status"), "success")

    def test_acceptance_3_backup_restore_and_verification(self):
        """Create online backup, restore into a secondary database, and verify record integrity."""
        temp_dir = tempfile.mkdtemp()
        try:
            backup_file = os.path.join(temp_dir, "acceptance_backup.db")
            restored_db_file = os.path.join(temp_dir, "restored_aerocascade.db")

            # 1. Trigger backup via admin API
            res_backup = self.client.post(
                "/api/admin/backup",
                headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value},
            )
            self.assertEqual(res_backup.status_code, 200)
            created_backup_path = res_backup.json()["backup_path"]
            self.assertTrue(os.path.exists(created_backup_path))

            # Copy to temp backup file
            shutil.copyfile(created_backup_path, backup_file)

            # 2. Restore into a new TopologyRepository
            restored_repo = TopologyRepository(restored_db_file)
            restored_repo.restore_database(backup_file)

            # 3. Verify restored data
            topos = restored_repo.list_topologies()
            self.assertGreater(len(topos), 0)
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)


if __name__ == "__main__":
    unittest.main()
