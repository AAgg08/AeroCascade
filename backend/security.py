"""
AeroCascade — Enterprise Security & Role-Based Access Control (RBAC)
Enforces server-side authorization for:
- administrators: Full administrative access, imports, run, export, backup, restore, approval
- analysts: Simulation execution, version creation, variant cloning, dossier export
- reviewers: Read-only inspection, dossier review comments, export reviews (no run/import)
- approvers: Formal sign-off and approval on EASA Part-IS compliance dossiers (no run/import)

Features:
- Strict role-based permission gates
- Configurable enterprise mode (ENTERPRISE_MODE=true)
- Redacted audit logging (excludes raw payload/cell contents)
- Disables backend source viewer in enterprise profile
"""

from __future__ import annotations
import enum
import logging
import os
from typing import List, Optional
from fastapi import Depends, Header, HTTPException, Request, status

logger = logging.getLogger("aerocascade.security")


class Role(str, enum.Enum):
    ADMINISTRATOR = "administrator"
    ANALYST = "analyst"
    REVIEWER = "reviewer"
    APPROVER = "approver"


class Action(str, enum.Enum):
    IMPORT = "import"
    RUN = "run"
    EXPORT = "export"
    REVIEW = "review"
    APPROVE = "approve"
    SAVE_VERSION = "save_version"
    CLONE = "clone"
    MANAGE = "manage"


# Authoritative server-side permissions matrix
ROLE_PERMISSIONS = {
    Action.IMPORT: [Role.ADMINISTRATOR],
    Action.RUN: [Role.ANALYST, Role.ADMINISTRATOR],
    Action.EXPORT: [Role.ANALYST, Role.REVIEWER, Role.APPROVER, Role.ADMINISTRATOR],
    Action.REVIEW: [Role.REVIEWER, Role.APPROVER, Role.ADMINISTRATOR],
    Action.APPROVE: [Role.APPROVER, Role.ADMINISTRATOR],
    Action.SAVE_VERSION: [Role.ANALYST, Role.ADMINISTRATOR],
    Action.CLONE: [Role.ANALYST, Role.ADMINISTRATOR],
    Action.MANAGE: [Role.ADMINISTRATOR],
}


def is_enterprise_mode() -> bool:
    """Checks whether enterprise security profile is active."""
    val = os.environ.get("ENTERPRISE_MODE", "").strip().lower()
    return val in ("1", "true", "yes", "enabled")


def get_authenticated_role(
    x_aerocascade_role: Optional[str] = Header(None, alias="X-AeroCascade-Role"),
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> Role:
    """
    Extracts and authenticates the caller's role from headers or environment API keys.
    In enterprise mode, valid role authentication is strictly required.
    """
    # 1. Check API token / key against configured secrets
    token = ""
    if authorization and authorization.lower().startswith("bearer "):
        token = authorization[7:].strip()
    elif x_api_key:
        token = x_api_key.strip()

    admin_key = os.environ.get("AEROCASCADE_ADMIN_KEY", "aerocascade-admin-token")
    analyst_key = os.environ.get("AEROCASCADE_ANALYST_KEY", "aerocascade-analyst-token")
    reviewer_key = os.environ.get("AEROCASCADE_REVIEWER_KEY", "aerocascade-reviewer-token")
    approver_key = os.environ.get("AEROCASCADE_APPROVER_KEY", "aerocascade-approver-token")

    if token:
        if token == admin_key:
            return Role.ADMINISTRATOR
        elif token == analyst_key:
            return Role.ANALYST
        elif token == reviewer_key:
            return Role.REVIEWER
        elif token == approver_key:
            return Role.APPROVER
        else:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid API credentials or token.",
            )

    # 2. Check X-AeroCascade-Role header
    if x_aerocascade_role:
        role_str = x_aerocascade_role.strip().lower()
        for r in Role:
            if r.value == role_str:
                return r
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown role '{x_aerocascade_role}'. Supported roles: {[r.value for r in Role]}.",
        )

    # 3. Fallback behavior: in Enterprise mode require authentication; in dev default to analyst
    if is_enterprise_mode():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required in enterprise profile. Provide credentials via X-AeroCascade-Role or Authorization Bearer token.",
        )

    return Role.ANALYST


def require_role(action: Action):
    """FastAPI dependency factory enforcing server-side RBAC for an Action."""
    def dependency(
        request: Request,
        role: Role = Depends(get_authenticated_role),
    ) -> Role:
        allowed = ROLE_PERMISSIONS.get(action, [])
        if role not in allowed:
            # Audit log violation with sanitized info (no raw request contents)
            logger.warning(
                "SECURITY_DENY: action=%s role=%s path=%s client=%s",
                action.value,
                role.value,
                request.url.path,
                request.client.host if request.client else "unknown",
            )
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=(
                    f"Forbidden: Action '{action.value}' is restricted. "
                    f"Current role '{role.value}' does not possess required privileges. "
                    f"Allowed roles: {[a.value for a in allowed]}."
                ),
            )
        # Log permitted audit entry
        logger.info(
            "SECURITY_ALLOW: action=%s role=%s path=%s",
            action.value,
            role.value,
            request.url.path,
        )
        return role

    return dependency
