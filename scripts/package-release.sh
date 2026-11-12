#!/usr/bin/env bash
set -euo pipefail

# AeroCascade Air-Gapped Release Packaging Script
# Prepares offline release bundle: pinned container images, SBOM, and SHA-256 checksums.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RELEASE_DIR="${REPO_ROOT}/release"

if ! command -v docker >/dev/null 2>&1 || ! docker info >/dev/null 2>&1; then
  echo "A running Docker Engine is required to build the offline images and include their runtimes." >&2
  exit 1
fi

echo "=== AeroCascade Air-Gapped Release Packager ==="
cd "${REPO_ROOT}"
mkdir -p "${RELEASE_DIR}"

echo "--> Building pinned container images..."
docker build -t aerocascade-gateway:2.0.0 -f Dockerfile.gateway .
docker build -t aerocascade-backend:2.0.0 -f Dockerfile.backend .
docker save aerocascade-gateway:2.0.0 | gzip > "${RELEASE_DIR}/aerocascade-gateway-2.0.0.tar.gz"
docker save aerocascade-backend:2.0.0 | gzip > "${RELEASE_DIR}/aerocascade-backend-2.0.0.tar.gz"

# Step 3: Generate CycloneDX SBOM
echo "--> Generating Software Bill of Materials (SBOM)..."
"${REPO_ROOT}/backend/.venv/bin/python" "${REPO_ROOT}/scripts/generate_sbom.py"

# Step 4: Generate Cryptographic SHA-256 Checksums
echo "--> Generating SHA256SUMS for air-gapped distribution verification..."
cd "${REPO_ROOT}"

# Calculate checksums relative to repository root / release files
if command -v sha256sum >/dev/null 2>&1; then
  SHA_CMD="sha256sum"
elif command -v shasum >/dev/null 2>&1; then
  SHA_CMD="shasum -a 256"
else
  echo "Error: Neither sha256sum nor shasum is available." >&2
  exit 1
fi

cat << 'EOF' > "${RELEASE_DIR}/generate_checksums.py"
import hashlib
import os
import sys

files = [
    "docker-compose.yml",
    "install.sh",
    "docs/RUNBOOK.md",
    "scripts/provision_accounts.py",
    "release/sbom.json",
    "release/aerocascade-gateway-2.0.0.tar.gz",
    "release/aerocascade-backend-2.0.0.tar.gz",
]

lines = []
for f in files:
    if os.path.exists(f):
        h = hashlib.sha256()
        with open(f, "rb") as fp:
            while chunk := fp.read(65536):
                h.update(chunk)
        lines.append(f"{h.hexdigest()}  {f}\n")

with open("release/SHA256SUMS", "w", encoding="utf-8") as out:
    out.writelines(lines)
print(f"Generated release/SHA256SUMS ({len(lines)} files verified).")
EOF

"${REPO_ROOT}/backend/.venv/bin/python" "${RELEASE_DIR}/generate_checksums.py"
rm -f "${RELEASE_DIR}/generate_checksums.py"

echo "=== Release Packaging Complete ==="
echo "Release Bundle Contents:"
ls -lh "${RELEASE_DIR}"
