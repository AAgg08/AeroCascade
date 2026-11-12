"""
Unit and integration tests for AeroCascade Enterprise Security & RBAC:
- Administrator, Analyst, Reviewer, and Approver roles
- Server-side authorization enforcement on simulate, import, review, approve, export
- Rejection of forbidden role actions with 403 Forbidden
- Enterprise profile enforcement: authentication required (401), source viewer disabled (403)
"""

import hashlib
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
from fastapi.testclient import TestClient

from backend import main
from backend.main import app
from backend.repository import TopologyRepository
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


    def test_enterprise_named_accounts_and_run_approval(self):
        admin_key, analyst_key, approver_key = ("a" * 64, "b" * 64, "c" * 64)
        with TemporaryDirectory() as directory:
            accounts_file = Path(directory) / "accounts.json"
            accounts_file.write_text(json.dumps([
                {
                    "username": username,
                    "role": role.value,
                    "credential_digest": hashlib.sha256(key.encode("ascii")).hexdigest(),
                }
                for username, role, key in (
                    ("test-admin", Role.ADMINISTRATOR, admin_key),
                    ("test-analyst", Role.ANALYST, analyst_key),
                    ("test-approver", Role.APPROVER, approver_key),
                )
            ]), encoding="utf-8")
            db_path = str(Path(directory) / "enterprise.db")
            with (
                patch.dict(os.environ, {"ENTERPRISE_MODE": "true", "AEROCASCADE_ACCOUNTS_FILE": str(accounts_file)}),
                patch.object(main, "repo", TopologyRepository(db_path)),
                TestClient(app) as client,
            ):
                for endpoint in ("/api/topologies", "/api/runs", "/api/auth/session"):
                    response = client.get(endpoint, headers={"X-AeroCascade-Role": Role.ADMINISTRATOR.value})
                    self.assertEqual(response.status_code, 401)
                    self.assertTrue(response.headers["WWW-Authenticate"].startswith("Basic"))
                analyst = ("test-analyst", analyst_key)
                approver = ("test-approver", approver_key)
                self.assertEqual(client.get("/api/auth/session", auth=analyst).json()["role"], "analyst")

                topology_id = "rtc-optical-asmgcs-spoof"
                request = canonical_to_simulation_request(make_test_canonical(), {"input_revision": 20})
                simulation = request.model_dump(mode="json")
                missing_version = {**simulation, "topology_version": None}
                self.assertEqual(client.post("/api/simulate", json=missing_version, auth=analyst).status_code, 422)
                missing_version = {**simulation, "topology_version": 999}
                self.assertEqual(client.post("/api/simulate", json=missing_version, auth=analyst).status_code, 404)
                response = client.post("/api/simulate", json=simulation, auth=analyst)
                self.assertEqual(response.status_code, 200, response.text)
                run_id = response.json()["run_id"]
                payload = {
                    "topology_id": topology_id,
                    "topology_version": 1,
                    "run_id": run_id,
                    "signoff_notes": "Reviewed in a synthetic exercise.",
                    "approver_name": "Ignored caller-supplied name",
                }
                self.assertEqual(client.post("/api/dossier/approve", json=payload, auth=analyst).status_code, 403)
                wrong_version = {**payload, "topology_version": 2}
                self.assertEqual(client.post("/api/dossier/approve", json=wrong_version, auth=approver).status_code, 409)
                approved = client.post("/api/dossier/approve", json=payload, auth=approver)
                self.assertEqual(approved.status_code, 200, approved.text)
                approval = approved.json()["approval"]
                self.assertEqual(approval["approver"], "test-approver")
                self.assertEqual(TopologyRepository(db_path).get_run_approval(run_id), approval)
                self.assertEqual(client.post("/api/dossier/approve", json=payload, auth=approver).status_code, 409)

                params = {"topology_id": topology_id, "run_id": run_id}
                exported = client.get("/api/export/dossier", params=params, auth=analyst)
                self.assertEqual(exported.status_code, 200, exported.text)
                evidence = exported.json()
                self.assertEqual(evidence["run"]["run_id"], run_id)
                self.assertEqual(evidence["run_sha256"], approval["run_sha256"])
                self.assertEqual(evidence["approval"], approval)

                with main.repo._get_connection() as conn:
                    conn.execute("UPDATE simulation_runs SET result = '{}' WHERE run_id = ?", (run_id,))
                self.assertEqual(client.get("/api/export/dossier", params=params, auth=analyst).status_code, 409)

    def test_dev_mode_session_and_run_approval_lifecycle(self):
        with TemporaryDirectory() as directory:
            db_path = str(Path(directory) / "dev.db")
            with (
                patch.dict(os.environ, {"ENTERPRISE_MODE": ""}),
                patch.object(main, "repo", TopologyRepository(db_path)),
                TestClient(app) as client,
            ):
                # 1. Session endpoint defaults to analyst in dev
                session_res = client.get("/api/auth/session")
                self.assertEqual(session_res.status_code, 200)
                self.assertEqual(session_res.json()["role"], "analyst")
                self.assertFalse(session_res.json()["enterprise"])

                # Session endpoint respects X-AeroCascade-Role in dev
                approver_session = client.get("/api/auth/session", headers={"X-AeroCascade-Role": "approver"})
                self.assertEqual(approver_session.json()["role"], "approver")

                # 2. Simulate run
                sim_req = canonical_to_simulation_request(make_test_canonical(), {"topology_version": 1})
                sim_res = client.post("/api/simulate", json=sim_req.model_dump(mode="json"))
                self.assertEqual(sim_res.status_code, 200)
                run_id = sim_res.json()["run_id"]

                # 3. Get run includes run_sha256 and approval: None
                run_res = client.get(f"/api/runs/{run_id}")
                self.assertEqual(run_res.status_code, 200)
                run_data = run_res.json()
                self.assertIsNotNone(run_data["run_sha256"])
                self.assertIsNone(run_data["approval"])

                # 4. Analyst role denied approval
                approval_payload = {
                    "topology_id": "rtc-optical-asmgcs-spoof",
                    "topology_version": 1,
                    "run_id": run_id,
                    "signoff_notes": "Synthetic audit approval note.",
                    "approver_name": "Dr. Quality Approver",
                }
                denied_res = client.post(
                    "/api/dossier/approve",
                    json=approval_payload,
                    headers={"X-AeroCascade-Role": "analyst"},
                )
                self.assertEqual(denied_res.status_code, 403)

                # 5. Approver role successfully approves
                approved_res = client.post(
                    "/api/dossier/approve",
                    json=approval_payload,
                    headers={"X-AeroCascade-Role": "approver"},
                )
                self.assertEqual(approved_res.status_code, 200)
                self.assertIsNotNone(approved_res.json().get("approval"))

                # 6. Re-approval is rejected with 409
                dup_res = client.post(
                    "/api/dossier/approve",
                    json=approval_payload,
                    headers={"X-AeroCascade-Role": "approver"},
                )
                self.assertEqual(dup_res.status_code, 409)

                # 7. Get run now returns the stored approval
                run_after_res = client.get(f"/api/runs/{run_id}")
                self.assertIsNotNone(run_after_res.json()["approval"])
                self.assertEqual(run_after_res.json()["approval"]["signoff_notes"], "Synthetic audit approval note.")

                # 8. Export dossier includes run evidence and approval
                export_res = client.get(
                    f"/api/export/dossier?topology_id=rtc-optical-asmgcs-spoof&topology_version=1&run_id={run_id}",
                    headers={"X-AeroCascade-Role": "analyst"},
                )
                self.assertEqual(export_res.status_code, 200)
                export_data = export_res.json()
                self.assertEqual(export_data["export_status"], "success")
                self.assertEqual(export_data["run"]["run_id"], run_id)
                self.assertIsNotNone(export_data["approval"])
                self.assertEqual(export_data["approval"]["approval_type"], "exercise")


    def test_reused_database_approval_provenance_separation(self):
        """
        Regression Test: A reused database containing pre-migration legacy or unauthenticated exercise approvals
        must NEVER present them as enterprise approvals, and must NOT block an authenticated enterprise sign-off.
        """
        admin_key, analyst_key, approver_key = ("1" * 64, "2" * 64, "3" * 64)
        with TemporaryDirectory() as directory:
            accounts_file = Path(directory) / "enterprise_accounts.json"
            accounts_file.write_text(json.dumps([
                {
                    "username": username,
                    "role": role.value,
                    "credential_digest": hashlib.sha256(key.encode("ascii")).hexdigest(),
                }
                for username, role, key in (
                    ("enterprise-admin", Role.ADMINISTRATOR, admin_key),
                    ("enterprise-analyst", Role.ANALYST, analyst_key),
                    ("enterprise-approver", Role.APPROVER, approver_key),
                )
            ]), encoding="utf-8")

            db_path = str(Path(directory) / "reused_enterprise.db")
            initial_repo = TopologyRepository(db_path)
            topology_id = "rtc-optical-asmgcs-spoof"

            # 1. Simulate a run in development
            sim_req = canonical_to_simulation_request(make_test_canonical(), {"topology_version": 1})
            from backend.simpy_engine import run_cascade_simulation
            sim_result = run_cascade_simulation(sim_req)
            run_rec = initial_repo.record_run(topology_id, 1, sim_req, sim_result)
            run_id = run_rec["run_id"]

            # 2. Insert a pre-existing exercise approval and legacy approval into the reused database
            with initial_repo._get_connection() as conn:
                conn.execute(
                    """
                    INSERT INTO dossier_approvals (
                        run_id, approval_type, approver, approver_role, signoff_notes,
                        run_sha256, topology_id, topology_version, authenticated_account
                    )
                    VALUES (?, 'legacy', 'Legacy Unproven Signoff', 'approver', 'Pre-migration sign-off',
                            'legacy_hash_123', ?, 1, NULL);
                    """,
                    (run_id, topology_id),
                )

            # 3. Open this reused database under ENTERPRISE_MODE
            with (
                patch.dict(os.environ, {"ENTERPRISE_MODE": "true", "AEROCASCADE_ACCOUNTS_FILE": str(accounts_file)}),
                patch.object(main, "repo", TopologyRepository(db_path)),
                TestClient(app) as client,
            ):
                analyst = ("enterprise-analyst", analyst_key)
                approver = ("enterprise-approver", approver_key)

                # Check A: Run status lookup in enterprise mode does NOT return legacy as enterprise approval
                run_res = client.get(f"/api/runs/{run_id}", auth=analyst)
                self.assertEqual(run_res.status_code, 200)
                run_data = run_res.json()
                self.assertIsNone(run_data["approval"], "Legacy approval must not appear as enterprise approval")
                self.assertEqual(run_data["approval_status"], "legacy_approved")
                self.assertIn("legacy", run_data["all_approvals"])
                self.assertNotIn("signoff_notes", run_data["all_approvals"]["legacy"], "Enterprise responses must not return notes from legacy sign-off")

                # Check B: Export dossier in enterprise mode does NOT present legacy approval
                export_res = client.get(
                    f"/api/export/dossier?topology_id={topology_id}&topology_version=1&run_id={run_id}",
                    auth=analyst,
                )
                self.assertEqual(export_res.status_code, 200)
                export_data = export_res.json()
                self.assertIsNone(export_data["approval"], "Legacy approval must not be exported as enterprise approval")

                # Check C: Legacy approval does NOT block authenticated enterprise approver
                enterprise_payload = {
                    "topology_id": topology_id,
                    "topology_version": 1,
                    "run_id": run_id,
                    "signoff_notes": "Official Enterprise Sign-off with authenticated provenance.",
                    "approver_name": "Ignored Spoofed Name",
                }
                approve_res = client.post("/api/dossier/approve", json=enterprise_payload, auth=approver)
                self.assertEqual(approve_res.status_code, 200, approve_res.text)
                new_approval = approve_res.json()["approval"]
                self.assertEqual(new_approval["approval_type"], "enterprise")
                self.assertEqual(new_approval["approver"], "enterprise-approver")
                self.assertEqual(new_approval["authenticated_account"], "enterprise-approver")
                self.assertEqual(new_approval["signoff_notes"], "Official Enterprise Sign-off with authenticated provenance.")

                # Check D: Re-lookup now returns the authenticated enterprise approval
                run_after = client.get(f"/api/runs/{run_id}", auth=analyst).json()
                self.assertIsNotNone(run_after["approval"])
                self.assertEqual(run_after["approval"]["approval_type"], "enterprise")
                self.assertEqual(run_after["approval"]["approver"], "enterprise-approver")
                self.assertEqual(run_after["approval_status"], "enterprise_approved")

                # Check E: Export now contains verified enterprise approval
                export_after = client.get(
                    f"/api/export/dossier?topology_id={topology_id}&topology_version=1&run_id={run_id}",
                    auth=analyst,
                ).json()
                self.assertEqual(export_after["export_status"], "success")
                self.assertIsNotNone(export_after["approval"])
                self.assertEqual(export_after["approval"]["approval_type"], "enterprise")
                self.assertEqual(export_after["approval"]["authenticated_account"], "enterprise-approver")
                self.assertEqual(export_after["run_sha256"], new_approval["run_sha256"])

    def test_development_mode_never_exposes_authenticated_account_or_notes_of_enterprise_approval(self):
        """Development responses must never expose the authenticated account or notes from an enterprise approval."""
        with TemporaryDirectory() as directory:
            db_path = str(Path(directory) / "mixed_approvals.db")
            repo = TopologyRepository(db_path)
            topology_id = "rtc-optical-asmgcs-spoof"

            sim_req = canonical_to_simulation_request(make_test_canonical(), {"topology_version": 1})
            from backend.simpy_engine import run_cascade_simulation
            sim_result = run_cascade_simulation(sim_req)
            run_rec = repo.record_run(topology_id, 1, sim_req, sim_result)
            run_id = run_rec["run_id"]
            run_full = repo.get_run(run_id)
            run_digest = main.dossier_run_hash(run_full)

            # Record an authenticated enterprise approval
            repo.approve_run(
                run_id=run_id,
                approver="alice-lead-auditor",
                approver_role="approver",
                notes="Confidential enterprise regulatory sign-off notes.",
                run_sha256=run_digest,
                approval_type="enterprise",
                topology_id=topology_id,
                topology_version=1,
                authenticated_account="alice-lead-auditor@enterprise.internal",
            )

            # Run in development mode
            with (
                patch.dict(os.environ, {"ENTERPRISE_MODE": "false"}),
                patch.object(main, "repo", repo),
                TestClient(app) as client,
            ):
                # 1. Lookup run in dev mode
                run_res = client.get(f"/api/runs/{run_id}")
                self.assertEqual(run_res.status_code, 200)
                run_data = run_res.json()

                # Authoritative approval in dev mode must NOT be enterprise
                self.assertIsNone(run_data["approval"], "Dev mode must not return enterprise approval as authoritative")

                # The UI summary indicator for enterprise must NOT contain account or notes
                self.assertIn("enterprise", run_data["all_approvals"])
                ent_summary = run_data["all_approvals"]["enterprise"]
                self.assertTrue(ent_summary.get("exists"))
                self.assertNotIn("authenticated_account", ent_summary, "Dev mode must never expose authenticated account")
                self.assertNotIn("signoff_notes", ent_summary, "Dev mode must never expose enterprise signoff notes")

                # 2. Export dossier in dev mode
                export_res = client.get(f"/api/export/dossier?topology_id={topology_id}&topology_version=1&run_id={run_id}")
                self.assertEqual(export_res.status_code, 200)
                export_data = export_res.json()
                self.assertIsNone(export_data["approval"], "Dev mode export must not include enterprise approval")

    def test_digest_check_enforced_in_run_status_and_export(self):
        """Authoritative approval must match run digest in both run status and evidence export."""
        admin_key = "1" * 64
        approver_key = "2" * 64
        with TemporaryDirectory() as directory:
            accounts_file = Path(directory) / "accounts.json"
            accounts_file.write_text(json.dumps([
                {
                    "username": "admin-1",
                    "role": "administrator",
                    "credential_digest": hashlib.sha256(admin_key.encode("ascii")).hexdigest(),
                },
                {
                    "username": "approver-1",
                    "role": "approver",
                    "credential_digest": hashlib.sha256(approver_key.encode("ascii")).hexdigest(),
                }
            ]), encoding="utf-8")

            db_path = str(Path(directory) / "tamper_test.db")
            repo = TopologyRepository(db_path)
            topology_id = "rtc-optical-asmgcs-spoof"

            sim_req = canonical_to_simulation_request(make_test_canonical(), {"topology_version": 1})
            from backend.simpy_engine import run_cascade_simulation
            sim_result = run_cascade_simulation(sim_req)
            run_rec = repo.record_run(topology_id, 1, sim_req, sim_result)
            run_id = run_rec["run_id"]
            run_full = repo.get_run(run_id)
            run_digest = main.dossier_run_hash(run_full)

            # Record enterprise approval with valid digest
            repo.approve_run(
                run_id=run_id,
                approver="approver-1",
                approver_role="approver",
                notes="Approved run before tampering",
                run_sha256=run_digest,
                approval_type="enterprise",
                topology_id=topology_id,
                topology_version=1,
                authenticated_account="approver-1",
            )

            # Now tamper with run result in SQLite
            with repo._get_connection() as conn:
                tampered_result = json.loads(run_full["result"]) if isinstance(run_full["result"], str) else run_full["result"].copy()
                tampered_result["model_version"] = "TAMPERED_MODEL_2.0"
                conn.execute(
                    "UPDATE simulation_runs SET result = ? WHERE run_id = ?;",
                    (json.dumps(tampered_result), run_id),
                )
                conn.commit()

            with (
                patch.dict(os.environ, {"ENTERPRISE_MODE": "true", "AEROCASCADE_ACCOUNTS_FILE": str(accounts_file)}),
                patch.object(main, "repo", repo),
                TestClient(app) as client,
            ):
                auth = ("approver-1", approver_key)

                # Run lookup: digest mismatch invalidates authoritative approval
                status_res = client.get(f"/api/runs/{run_id}", auth=auth)
                self.assertEqual(status_res.status_code, 200)
                status_data = status_res.json()
                self.assertIsNone(status_data["approval"], "Tampered run must not show authoritative approval")
                self.assertEqual(status_data["approval_status"], "digest_mismatch")

                # Export dossier: raises 409 Conflict
                export_res = client.get(
                    f"/api/export/dossier?topology_id={topology_id}&topology_version=1&run_id={run_id}",
                    auth=auth,
                )
                self.assertEqual(export_res.status_code, 409)
                self.assertIn("Run integrity check failed", export_res.json()["detail"])


    def test_enterprise_gateway_cannot_use_development_backend(self):
        with patch.dict(os.environ, {"ENTERPRISE_MODE": "false"}):
            response = self.client.get("/api/topologies", headers={"X-AeroCascade-Deployment": "enterprise"})
            self.assertEqual(response.status_code, 503)
            self.assertEqual(self.client.get("/api/topologies").status_code, 200)

    def test_enterprise_startup_requires_accounts(self):
        with (
            patch.dict(os.environ, {"ENTERPRISE_MODE": "true", "AEROCASCADE_ACCOUNTS_FILE": ""}),
            self.assertRaisesRegex(RuntimeError, "Set AEROCASCADE_ACCOUNTS_FILE"),
            TestClient(app),
        ):
            pass


if __name__ == "__main__":
    unittest.main()
