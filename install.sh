#!/usr/bin/env bash
set -euo pipefail

# AeroCascade Air-Gapped Target Host Installer
# Requirements:
# - Target host with Docker Engine 24+ and Docker Compose v2+ installed
# - Customer-managed encrypted storage partition mounted for persistent data/backups

echo "============================================================"
echo " AeroCascade Enterprise Air-Gapped Installer (v2.0.0)"
echo "============================================================"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "${SCRIPT_DIR}"

# Step 1: Pre-flight Verification
echo "[1/5] Verifying local Docker runtime..."
if ! command -v docker >/dev/null 2>&1; then
  echo "Error: 'docker' CLI not found. Please install Docker Engine prior to running installer." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "Error: 'docker compose' plugin not found. Please install Docker Compose v2+." >&2
  exit 1
fi

if [[ "${AEROCASCADE_ACCOUNTS_FILE:-}" != /* ]] || [ ! -f "$AEROCASCADE_ACCOUNTS_FILE" ]; then
  echo "Set AEROCASCADE_ACCOUNTS_FILE to the absolute path of the provisioned accounts file. See docs/RUNBOOK.md." >&2
  exit 1
fi

# Step 2: Cryptographic Checksum Verification
echo "[2/5] Verifying integrity with release/SHA256SUMS..."
if [ ! -f "release/SHA256SUMS" ]; then
  echo "Error: release/SHA256SUMS not found." >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256sum -c release/SHA256SUMS
elif command -v shasum >/dev/null 2>&1; then
  shasum -a 256 -c release/SHA256SUMS
else
  echo "Error: install requires sha256sum or shasum to verify the bundle." >&2
  exit 1
fi

# Step 3: Load Pinned Container Images into Local Docker Daemon
echo "[3/5] Loading offline container image archives into Docker..."
if [ -f "release/aerocascade-gateway-2.0.0.tar.gz" ]; then
  docker load -i release/aerocascade-gateway-2.0.0.tar.gz
elif [ -f "release/aerocascade-gateway-2.0.0.tar" ]; then
  docker load -i release/aerocascade-gateway-2.0.0.tar
else
  echo "Error: Gateway image archive not found in release/." >&2
  exit 1
fi

if [ -f "release/aerocascade-backend-2.0.0.tar.gz" ]; then
  docker load -i release/aerocascade-backend-2.0.0.tar.gz
elif [ -f "release/aerocascade-backend-2.0.0.tar" ]; then
  docker load -i release/aerocascade-backend-2.0.0.tar
else
  echo "Error: Backend image archive not found in release/." >&2
  exit 1
fi

echo "Checking loaded image runtimes without network access..."
if ! docker run --rm --network none --pull never --entrypoint node aerocascade-gateway:2.0.0 --version \
  || ! docker run --rm --network none --pull never --entrypoint python aerocascade-backend:2.0.0 --version; then
  echo "Error: Loaded images cannot run on this Docker host. Rebuild the release for the target architecture." >&2
  exit 1
fi

# Step 4: Provision Customer-Approved Encrypted Storage Mounts
echo "[4/5] Preparing persistent data and backup volumes..."
DATA_DIR="${ENCRYPTED_DATA_PATH:-./data}"
BACKUP_DIR="${ENCRYPTED_BACKUP_PATH:-./backups}"

mkdir -p "${DATA_DIR}" "${BACKUP_DIR}"

# Ensure unprivileged non-root container user (UID 10001) has write access
if [ "$(id -u)" -eq 0 ]; then
  chown 10001:10001 "${DATA_DIR}" "${BACKUP_DIR}"
fi
chmod 770 "${DATA_DIR}" "${BACKUP_DIR}"

# Step 5: Start Services via Docker Compose (Strict Offline Mode)
echo "[5/5] Launching AeroCascade containers..."
docker compose up -d --no-build --pull never

echo "Waiting for services to become healthy..."
MAX_RETRIES=15
COUNTER=0
HEALTHY=0

while [ $COUNTER -lt $MAX_RETRIES ]; do
  if curl -sf http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
    HEALTHY=1
    break
  fi
  sleep 2
  COUNTER=$((COUNTER + 1))
done

if [ $HEALTHY -eq 1 ]; then
  echo "============================================================"
  echo " AeroCascade successfully installed and running!"
  echo " Ingress Endpoint: http://127.0.0.1:3000"
  echo " FastAPI Status:   Private (internal bridge network only)"
  echo " Documentation:    docs/RUNBOOK.md"
  echo "============================================================"
else
  echo "Error: Healthcheck timed out. Check container logs with 'docker compose logs'." >&2
  exit 1
fi
