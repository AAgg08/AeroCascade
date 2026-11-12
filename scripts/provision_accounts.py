"""Create an AeroCascade enterprise accounts file and one-time login keys."""

import argparse
import hashlib
import json
import os
import re
import secrets
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("accounts", metavar="USERNAME:ROLE", nargs="+")
    args = parser.parse_args()

    accounts = {}
    credentials = {}
    for spec in args.accounts:
        username, _, role = spec.partition(":")
        if not re.fullmatch(r"[a-zA-Z0-9_.@-]{1,128}", username) or username in accounts:
            parser.error("Usernames must be unique and use letters, digits, or _.@-")
        if role not in {"administrator", "analyst", "reviewer", "approver"}:
            parser.error("Roles must be administrator, analyst, reviewer, or approver")

        credential = secrets.token_hex(32)
        credentials[username] = credential
        accounts[username] = {
            "username": username,
            "role": role,
            "credential_digest": hashlib.sha256(credential.encode("ascii")).hexdigest(),
        }

    if not any(account["role"] == "administrator" for account in accounts.values()):
        parser.error("At least one administrator is required")

    try:
        fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    except OSError as exc:
        parser.error(str(exc))
    with os.fdopen(fd, "w", encoding="utf-8") as output:
        json.dump(list(accounts.values()), output, indent=2)
        output.write("\n")

    print("Store and distribute these one-time login keys securely.")
    for username, credential in credentials.items():
        print(f"{username}  {credential}")


if __name__ == "__main__":
    main()
