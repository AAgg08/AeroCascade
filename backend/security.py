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
import base64
import binascii
import enum
import hashlib
import hmac
import json
import logging
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional
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


@dataclass(frozen=True)
class Account:
    username: str
    role: Role
    credential_digest: str


def load_enterprise_accounts() -> dict[str, Account]:
    """Load named accounts with SHA-256 digests of randomly generated 256-bit keys."""
    filename = os.environ.get("AEROCASCADE_ACCOUNTS_FILE")
    if not filename:
        raise RuntimeError("Set AEROCASCADE_ACCOUNTS_FILE before starting enterprise mode.")
    try:
        entries = json.loads(Path(filename).read_text(encoding="utf-8"))
        accounts: dict[str, Account] = {}
        digests: set[str] = set()
        if not isinstance(entries, list):
            raise ValueError()
        for entry in entries:
            username = entry["username"]
            digest = entry["credential_digest"]
            if (
                not re.fullmatch(r"[a-zA-Z0-9_.@-]{1,128}", username)
                or not re.fullmatch(r"[0-9a-f]{64}", digest)
                or username in accounts
                or digest in digests
            ):
                raise ValueError()
            accounts[username] = Account(username, Role(entry["role"]), digest)
            digests.add(digest)
        if not any(account.role == Role.ADMINISTRATOR for account in accounts.values()):
            raise ValueError()
        return accounts
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise RuntimeError("Invalid enterprise accounts file. Configure unique accounts and at least one administrator.") from exc


def get_authenticated_account(request: Request) -> Account:
    header = request.headers.get("authorization", "")
    scheme, _, encoded = header.partition(" ")
    if scheme.lower() == "basic" and len(encoded) <= 512:
        try:
            decoded = base64.b64decode(encoded, validate=True).decode("ascii")
            username, separator, credential = decoded.partition(":")
            account = getattr(request.app.state, "enterprise_accounts", {}).get(username)
            if separator and account and re.fullmatch(r"[0-9a-f]{64}", credential):
                digest = hashlib.sha256(credential.encode("ascii")).hexdigest()
                if hmac.compare_digest(digest, account.credential_digest):
                    return account
        except (binascii.Error, UnicodeError):
            pass
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Valid enterprise account credentials are required.",
        headers={"WWW-Authenticate": 'Basic realm="AeroCascade", charset="UTF-8"'},
    )


def get_authenticated_role(
    request: Request,
    x_aerocascade_role: Optional[str] = Header(None, alias="X-AeroCascade-Role"),
    authorization: Optional[str] = Header(None),
    x_api_key: Optional[str] = Header(None, alias="X-API-Key"),
) -> Role:
    if is_enterprise_mode():
        return get_authenticated_account(request).role

    scheme, _, value = (authorization or "").partition(" ")
    token = value.strip() if scheme.lower() == "bearer" else (x_api_key or "").strip()
    if token:
        for role, variable in (
            (Role.ADMINISTRATOR, "AEROCASCADE_ADMIN_KEY"),
            (Role.ANALYST, "AEROCASCADE_ANALYST_KEY"),
            (Role.REVIEWER, "AEROCASCADE_REVIEWER_KEY"),
            (Role.APPROVER, "AEROCASCADE_APPROVER_KEY"),
        ):
            configured = os.environ.get(variable)
            if configured and hmac.compare_digest(token.encode(), configured.encode()):
                return role
        raise HTTPException(status_code=401, detail="Invalid API credentials.")

    if x_aerocascade_role:
        try:
            return Role(x_aerocascade_role.strip().lower())
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Unknown development role.") from exc

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
