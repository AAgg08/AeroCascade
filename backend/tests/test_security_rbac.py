"""
Unit and integration tests for AeroCascade Enterprise Security & RBAC:
- Administrator, Analyst, Reviewer, and Approver roles
- Server-side authorization enforcement on simulate, import, review, approve, export
- Rejection of forbidden role actions with 403 Forbidden
- Enterprise profile enforcement: authentication required (401), source viewer disabled (403)
"""

import json
import os
import unittest
from fastapi.testclient import TestClient

from backend.main import app
from backend.security import Role
from backend.canonical import (
    CanonicalNode,
    CanonicalDependency,
    CanonicalTopology,
    CanonicalSourceProvenance,
    canonical_to_simulation_request,
)
from backend.models import (
    CascadeStage,
    ControlCategory,
    ER040Severity,
    FMEAMetrics,
    PSOELevel,
    TripartiteControls,
)


def make_test_canonical() -> CanonicalTopology:
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
    ]
    deps = [
        CanonicalDependency(
            id="dep-01-02",
            provider_node_id="node-sensor-01",
            dependent_node_id="node-fusion-02",
            weight=0.85,
        )
    ]
    return CanonicalTopology(
        topology_id="rtc-optical-asmgcs-spoof",
        name="Test Topology",
        version=1,
        nodes=nodes,
        dependencies=deps,
        provenance=CanonicalSourceProvenance(
            source_type="synthetic_test",
            source_reference="AeroCascade RBAC Test Suite",
        ),
    )


class TestSecurityRBAC(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(app)

    def test_simulate_role_permissions(self):
        """Simulation execution is restricted to Analysts and Administrators."""
        sim_req = canonical_to_simulation_request(make_test_canonical())
        payload = json.loads(sim_req.model_dump_json())

        # 1. Analyst: ALLOWED
        res_analyst = self.client.post(
            "/api/simulate",
            json=payload,
            headers={"X-AeroCascade-Role": Role.ANALYST.value},
        )
        self.assertEqual(res_analyst.status_code, 200, f"Analyst should be permitted to simulate, got {res_analyst.text}")

        # 2. Administrator: ALLOWED
        res_admin = self.client.post(
            "/api/simulate",
            json=payload,
            headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value},
        )
        self.assertEqual(res_admin.status_code, 200, f"Administrator should be permitted to simulate, got {res_admin.text}")

        # 3. Reviewer: FORBIDDEN (403)
        res_reviewer = self.client.post(
            "/api/simulate",
            json=payload,
            headers={"X-AeroCascade-Role": Role.REVIEWER.value},
        )
        self.assertEqual(res_reviewer.status_code, 403)
        self.assertIn("Forbidden", res_reviewer.json().get("detail", ""))

        # 4. Approver: FORBIDDEN (403)
        res_approver = self.client.post(
            "/api/simulate",
            json=payload,
            headers={"X-AeroCascade-Role": Role.APPROVER.value},
        )
        self.assertEqual(res_approver.status_code, 403)
        self.assertIn("Forbidden", res_approver.json().get("detail", ""))

    def test_import_role_permissions(self):
        """Importing topologies is restricted to Administrators."""
        import_payload = {
            "file_name": "test.csv",
            "content_text": "Vendor ID,Vendor Name\nN1,Test Node",
        }

        # 1. Administrator: ALLOWED
        res_admin = self.client.post(
            "/api/import/preview",
            json=import_payload,
            headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value},
        )
        self.assertEqual(res_admin.status_code, 200)

        # 2. Analyst: FORBIDDEN (403)
        res_analyst = self.client.post(
            "/api/import/preview",
            json=import_payload,
            headers={"X-AeroCascade-Role": Role.ANALYST.value},
        )
        self.assertEqual(res_analyst.status_code, 403)

        # 3. Reviewer: FORBIDDEN (403)
        res_reviewer = self.client.post(
            "/api/import/preview",
            json=import_payload,
            headers={"X-AeroCascade-Role": Role.REVIEWER.value},
        )
        self.assertEqual(res_reviewer.status_code, 403)

        # 4. Approver: FORBIDDEN (403)
        res_approver = self.client.post(
            "/api/import/preview",
            json=import_payload,
            headers={"X-AeroCascade-Role": Role.APPROVER.value},
        )
        self.assertEqual(res_approver.status_code, 403)

    def test_dossier_approval_role_permissions(self):
        """Dossier approval sign-off is restricted to Approvers and Administrators."""
        approval_payload = {
            "topology_id": "rtc-optical-asmgcs-spoof",
            "topology_version": 1,
            "signoff_notes": "Formally approved for EASA Part-IS compliance exercise.",
            "approver_name": "Chief Safety Officer",
        }

        # 1. Approver: ALLOWED
        res_approver = self.client.post(
            "/api/dossier/approve",
            json=approval_payload,
            headers={"X-AeroCascade-Role": Role.APPROVER.value},
        )
        self.assertEqual(res_approver.status_code, 200)
        self.assertEqual(res_approver.json().get("status"), "approved")

        # 2. Administrator: ALLOWED
        res_admin = self.client.post(
            "/api/dossier/approve",
            json=approval_payload,
            headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value},
        )
        self.assertEqual(res_admin.status_code, 200)

        # 3. Analyst: FORBIDDEN (403)
        res_analyst = self.client.post(
            "/api/dossier/approve",
            json=approval_payload,
            headers={"X-AeroCascade-Role": Role.ANALYST.value},
        )
        self.assertEqual(res_analyst.status_code, 403)

        # 4. Reviewer: FORBIDDEN (403)
        res_reviewer = self.client.post(
            "/api/dossier/approve",
            json=approval_payload,
            headers={"X-AeroCascade-Role": Role.REVIEWER.value},
        )
        self.assertEqual(res_reviewer.status_code, 403)

    def test_review_comments_role_permissions(self):
        """Review comments are allowed for Reviewers, Approvers, and Administrators."""
        comment_payload = {
            "topology_id": "rtc-optical-asmgcs-spoof",
            "comment": "Recommended formal control enhancement on Stage 3 fallback.",
            "reviewer_name": "Senior Auditor",
        }

        # Reviewer: ALLOWED
        res_reviewer = self.client.post(
            "/api/review/comments",
            json=comment_payload,
            headers={"X-AeroCascade-Role": Role.REVIEWER.value},
        )
        self.assertEqual(res_reviewer.status_code, 200)
        self.assertEqual(res_reviewer.json().get("status"), "recorded")

        # Approver: ALLOWED
        res_approver = self.client.post(
            "/api/review/comments",
            json=comment_payload,
            headers={"X-AeroCascade-Role": Role.APPROVER.value},
        )
        self.assertEqual(res_approver.status_code, 200)

    def test_export_dossier_role_permissions(self):
        """Exporting dossiers is permitted for all authenticated operational roles."""
        for r in [Role.ANALYST, Role.REVIEWER, Role.APPROVER, Role.ADMINISTRATOR]:
            res = self.client.get(
                "/api/export/dossier?topology_id=rtc-optical-asmgcs-spoof",
                headers={"X-AeroCascade-Role": r.value},
            )
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.json().get("export_status"), "success")

    def test_admin_backup_and_restore_role_permissions(self):
        """Backup and restore are restricted to Administrators only."""
        # 1. Non-admin roles are forbidden (403)
        for non_admin_role in [Role.ANALYST, Role.REVIEWER, Role.APPROVER]:
            res_deny = self.client.post(
                "/api/admin/backup",
                headers={"X-AeroCascade-Role": non_admin_role.value},
            )
            self.assertEqual(res_deny.status_code, 403)

        # 2. Administrator is allowed to create backup (200)
        res_backup = self.client.post(
            "/api/admin/backup",
            headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value},
        )
        self.assertEqual(res_backup.status_code, 200)
        backup_data = res_backup.json()
        self.assertEqual(backup_data.get("status"), "success")
        backup_file = backup_data.get("backup_file")
        self.assertTrue(backup_file)

        # 3. Administrator is allowed to restore from the backup (200)
        res_restore = self.client.post(
            "/api/admin/restore",
            json={"backup_path": backup_file},
            headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value},
        )
        self.assertEqual(res_restore.status_code, 200)
        self.assertEqual(res_restore.json().get("status"), "success")

    def test_enterprise_mode_and_source_viewer(self):
        """When ENTERPRISE_MODE=true, unauthenticated requests are 401 and source viewer is 403."""
        old_env = os.environ.get("ENTERPRISE_MODE")
        try:
            os.environ["ENTERPRISE_MODE"] = "true"

            # 1. Unauthenticated request in enterprise mode -> 401
            res_no_auth = self.client.get("/api/export/dossier?topology_id=rtc-optical-asmgcs-spoof")
            self.assertEqual(res_no_auth.status_code, 401)

            # 2. Source viewer disabled -> 403
            res_source = self.client.get(
                "/api/backend-source",
                headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value},
            )
            self.assertEqual(res_source.status_code, 403)
            self.assertIn("disabled", res_source.json().get("detail", ""))
        finally:
            if old_env is None:
                os.environ.pop("ENTERPRISE_MODE", None)
            else:
                os.environ["ENTERPRISE_MODE"] = old_env


if __name__ == "__main__":
    unittest.main()
