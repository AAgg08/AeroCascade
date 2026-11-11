#!/usr/bin/env bash
set -euo pipefail

# AeroCascade Air-Gapped Release Packaging Script
# Prepares offline release bundle: pinned container images, SBOM, and signed SHA256 checksums.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
RELEASE_DIR="${REPO_ROOT}/release"

echo "=== AeroCascade Air-Gapped Release Packager ==="
echo "Repository Root: ${REPO_ROOT}"
echo "Release Directory: ${RELEASE_DIR}"
mkdir -p "${RELEASE_DIR}"

# Step 1: Clean build of production frontend and gateway bundle
echo "--> Building production frontend (Vite) and gateway bundle (esbuild)..."
cd "${REPO_ROOT}"
npm run build
npx esbuild server.ts --bundle --platform=node --format=esm --outfile=dist-server/server.mjs --external:vite

# Step 2: Build / Package Container Image Archives
echo "--> Packaging pinned container images (gateway:2.0.0, backend:2.0.0)..."
if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
  echo "Using host Docker daemon to build and export images..."
  docker build -t aerocascade-gateway:2.0.0 -f Dockerfile.gateway .
  docker build -t aerocascade-backend:2.0.0 -f Dockerfile.backend .
  docker save aerocascade-gateway:2.0.0 | gzip > "${RELEASE_DIR}/aerocascade-gateway-2.0.0.tar.gz"
  docker save aerocascade-backend:2.0.0 | gzip > "${RELEASE_DIR}/aerocascade-backend-2.0.0.tar.gz"
else
  echo "Docker daemon not running locally. Using internal OCI archive generator..."
  "${REPO_ROOT}/backend/.venv/bin/python" "${REPO_ROOT}/scripts/create_docker_archive.py"
fi

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
