# AeroCascade Enterprise Deployment & Operations Runbook

**Document Version:** 2.0.0-Enterprise  
**Classification:** Customer-Managed Air-Gapped Deployment  
**Standard Compliance:** EASA Part-IS ((EU) 2022/1645 & (EU) 2023/203), EUROCAE ER-040, Dhillon & Moores (2001) Tripartite Controls

---

## 1. System Architecture

AeroCascade is packaged for standalone, air-gapped on-premise operation within customer-managed infrastructure. The system contains no external telemetry, remote CDN assets, Google Fonts, or runtime dependency fetching.

```
       [Customer TLS Reverse Proxy / Firewall (Nginx / Caddy)]
                               |
                               | (HTTP over 127.0.0.1:3000)
                               v
+-----------------------------------------------------------------+
| Docker Host (Host Loopback Interface Only)                      |
|                                                                 |
|   +---------------------------------------------------------+   |
|   | Container: aerocascade-gateway (Port 3000)              |   |
|   | - Non-root user (UID 10001:10001)                       |   |
|   | - Read-only root filesystem, dropped capabilities (ALL) |   |
|   | - Serves static production UI from local disk           |   |
|   | - Proxies /api/* to internal backend                    |   |
|   +---------------------------------------------------------+   |
|                                |                                |
|        (Isolated Bridge Network: aerocascade-internal)         |
|                                |                                |
|   +---------------------------------------------------------+   |
|   | Container: aerocascade-backend (Port 8000 private)      |   |
|   | - Non-root user (UID 10001:10001)                       |   |
|   | - Read-only root filesystem, dropped capabilities (ALL) |   |
|   | - Authoritative SimPy discrete-event simulation engine  |   |
|   | - NetworkX topology analyzer & EASA Part-IS generator   |   |
|   | - SQLite versioned repository                           |   |
|   +---------------------------------------------------------+   |
|                                |                                |
|      (Customer Encrypted Volume Mount: dm-crypt / LUKS)         |
|                                v                                |
|   +---------------------------------------------------------+   |
|   | /var/lib/aerocascade/data/aerocascade.db (RW, persistent)|  |
|   | /var/lib/aerocascade/backups/            (RW, point-in- |  |
|   |                                           time backups) |  |
|   +---------------------------------------------------------+   |
+-----------------------------------------------------------------+
```

---

## 2. Air-Gapped Release Bundle & Checksum Verification

The release bundle is delivered as a self-contained offline directory with SHA-256 checksums and an SBOM.

### 2.1 Bundle Contents
- `docker-compose.yml`: Hardened service definition with `pull_policy: never`.
- `install.sh`: Automated offline installer.
- `release/aerocascade-gateway-2.0.0.tar.gz`: Pinned gateway container archive.
- `release/aerocascade-backend-2.0.0.tar.gz`: Pinned backend container archive.
- `release/sbom.json`: CycloneDX 1.5 Software Bill of Materials.
- `release/SHA256SUMS`: Cryptographic SHA-256 verification manifest.
- `docs/RUNBOOK.md`: Operational and maintenance runbook.

### 2.2 Verifying Bundle Integrity
Before installation, verify the integrity of all artifacts against `release/SHA256SUMS`:

```bash
# On Linux
sha256sum -c release/SHA256SUMS

# On macOS
shasum -a 256 -c release/SHA256SUMS
```

All files must return `OK`.

Build the release on a Docker host that matches the target architecture. The release packager checks that both images can start their runtimes without network access before saving them. The installer checks the loaded runtimes again on the target before starting the services.

---

## 3. Installation & Startup

### 3.1 Target Prerequisites
- Linux OS (RHEL 9, Rocky Linux 9, Ubuntu 22.04/24.04 LTS, or Debian 12)
- Docker Engine 24.0+ and Docker Compose v2+ installed
- Customer-managed encrypted storage partition (see Section 4)

### 3.2 Automated Installation
Run the installer script:
```bash
./install.sh
```

The script executes the verified installation sequence:
1. Validates checksums in `release/SHA256SUMS`.
2. Loads pinned image archives into the local Docker daemon:
   ```bash
   docker load -i release/aerocascade-gateway-2.0.0.tar.gz
   docker load -i release/aerocascade-backend-2.0.0.tar.gz
   ```
3. Creates persistent data and backup directories with non-root ownership (UID `10001:10001`).
4. Starts services using the exact required offline command:
   ```bash
   docker compose up -d --no-build --pull never
   ```
5. Verifies service health on loopback: `http://127.0.0.1:3000/api/health`.

---

## 4. Customer-Managed Encrypted Storage Setup

AeroCascade stores its SQLite database and point-in-time backups on customer-approved encrypted storage.

### 4.1 Linux LUKS Volume Provisioning (dm-crypt)
To provision an encrypted partition on the host:

```bash
# 1. Create encrypted LUKS container on dedicated disk or partition
cryptsetup luksFormat /dev/sdb1

# 2. Open encrypted partition
cryptsetup open /dev/sdb1 aerocascade_storage

# 3. Format with ext4
mkfs.ext4 /dev/mapper/aerocascade_storage

# 4. Mount partition
mkdir -p /opt/aerocascade-encrypted
mount /dev/mapper/aerocascade_storage /opt/aerocascade-encrypted

# 5. Create data and backup directories and assign UID 10001
mkdir -p /opt/aerocascade-encrypted/data /opt/aerocascade-encrypted/backups
chown -R 10001:10001 /opt/aerocascade-encrypted
chmod -R 770 /opt/aerocascade-encrypted
```

### 4.2 Configuring Docker Compose Storage Mounts
Export the mounted directories in your environment or `.env` file before running `docker compose`:

```bash
export ENCRYPTED_DATA_PATH=/opt/aerocascade-encrypted/data
export ENCRYPTED_BACKUP_PATH=/opt/aerocascade-encrypted/backups
```

---

## 5. Host Firewall & Outbound Deny Rules

AeroCascade is designed to operate with **zero outbound internet access**. Customer security teams must enforce outbound deny rules on the host and container subnet.

### 5.1 Docker Internal Network Isolation
In `docker-compose.yml`, the network is configured with:
```yaml
networks:
  aerocascade-internal:
    driver: bridge
    internal: true
```
This tells Docker to omit the default NAT outbound gateway rule, preventing containers from initiating outbound TCP/UDP sessions.

### 5.2 Linux Host Firewall Enforcement (UFW / iptables)
To enforce strict outbound deny at the host firewall level:

```bash
# Block all forwarded container traffic to external interfaces
iptables -I DOCKER-USER -i br-+ ! -o lo -j DROP
iptables -I DOCKER-USER -m state --state ESTABLISHED,RELATED -j ACCEPT

# Restrict host egress to authorized local network management subnets only
ufw default deny outgoing
ufw allow out to 192.168.1.0/24 port 22 proto tcp
ufw allow in on lo
```

---

## 6. Reverse Proxy & Customer TLS Configuration

The gateway listens exclusively on `127.0.0.1:3000`. To provide LAN access to operational staff, terminate TLS on the host using your enterprise reverse proxy (Nginx or Caddy) with your organization's internal PKI certificates.

### 6.1 Nginx Hardened Configuration Template
Place in `/etc/nginx/conf.d/aerocascade.conf`:

```nginx
server {
    listen 443 ssl http2;
    server_name aerocascade.air-traffic.local;

    ssl_certificate /etc/ssl/certs/aerocascade.crt;
    ssl_certificate_key /etc/ssl/private/aerocascade.key;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5:!RC4;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 1d;

    # Enterprise Security Headers
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains" always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self';" always;

    client_max_body_size 10M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Forward RBAC headers
        proxy_pass_request_headers on;

        proxy_connect_timeout 60s;
        proxy_read_timeout 120s;
        proxy_send_timeout 60s;
    }
}
```

---

## 7. Role-Based Access Control (RBAC) & Enterprise Security

The Express gateway prompts for credentials. FastAPI authenticates named accounts and enforces the role permissions.

### 7.1 Role Permissions Matrix

| Action | API Route | Administrator | Analyst | Reviewer | Approver |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **Simulate Cascade** | `POST /api/simulate` | Allowed | Allowed | Denied (403) | Denied (403) |
| **Import Topology** | `POST /api/import/*`, `POST /api/topologies` | Allowed | Denied (403) | Denied (403) | Denied (403) |
| **Save New Version** | `POST /api/topologies/:id/versions` | Allowed | Allowed | Denied (403) | Denied (403) |
| **Clone Topology** | `POST /api/topologies/:id/clone` | Allowed | Allowed | Denied (403) | Denied (403) |
| **Add Review Comments** | `POST /api/review/comments` | Allowed | Denied (403) | Allowed | Allowed |
| **Approve Dossier** | `POST /api/dossier/approve` | Allowed | Denied (403) | Denied (403) | Allowed |
| **Export Dossier** | `GET /api/export/dossier` | Allowed | Allowed | Allowed | Allowed |
| **Manage & Backups** | `POST /api/admin/*` | Allowed | Denied (403) | Denied (403) | Denied (403) |
| **Source Viewer** | `GET /api/backend-source` | Disabled (403)| Disabled (403)| Disabled (403)| Disabled (403)|

### 7.2 Provisioning enterprise accounts

On the target host, generate a named account and login key for each operator. Run the command in a private terminal because it displays the keys once. Store the accounts file outside the release bundle and distribute each key through the organization's approved credential channel.

```bash
python3 scripts/provision_accounts.py /secure/aerocascade-accounts.json \
  operations-admin:administrator duty-analyst:analyst safety-approver:approver
sudo chgrp 10001 /secure/aerocascade-accounts.json
chmod 0640 /secure/aerocascade-accounts.json
export AEROCASCADE_ACCOUNTS_FILE=/secure/aerocascade-accounts.json
./install.sh
```

FastAPI validates the accounts file at startup. The container mounts it read-only and needs group read access for GID 10001. Open the loopback URL and enter the named account and its key in the browser's sign-in prompt. The browser retains HTTP Basic credentials during its session. Use a private browser window on shared consoles and close it when finished. Any off-host access requires an organization-managed TLS reverse proxy. A missing or invalid account receives HTTP 401. An authenticated account without the required role receives HTTP 403.

To revoke a user, remove the entry from the file and recreate the backend service to load the updated mount. Keep at least one administrator. For rotation, provision a new file, transfer the new keys securely, and recreate the backend service. The development role header is available only outside enterprise mode.

### 7.3 Run evidence

Enterprise dossier approval requires the persisted run ID and matching topology version. FastAPI records the account name, role, UTC approval time, notes, and SHA-256 digest of the stored run. The dossier export API returns the run evidence and its approval, if recorded. The digest detects a mismatch against the stored approval. It does not provide a digital signature or an external trusted timestamp.

### 7.4 Redacted Audit Logging
Audit logs record all authorized (`SECURITY_ALLOW`) and forbidden (`SECURITY_DENY`) actions. To comply with confidential infrastructure protection, logs **never** output raw topology data, cell values, or sensitive airport dossiers:
```
SECURITY_ALLOW: action=run role=analyst path=/api/simulate client=127.0.0.1
SECURITY_DENY:  action=approve role=analyst path=/api/dossier/approve client=127.0.0.1
```

---

## 8. Backup & Restore Procedures

Online backups use SQLite's native point-in-time backup API. Backups can be triggered while the application is actively serving requests without table locking or downtime.

### 8.1 Automated Point-in-Time Backup
Execute the CLI utility or API:
```bash
# Via CLI:
./scripts/backup_restore.py backup --db ./data/aerocascade.db --out ./backups/aerocascade_backup_$(date +%Y%m%d_%H%M%S).db

# Via API (curl prompts for the named administrator's login key):
curl --user operations-admin -X POST http://127.0.0.1:3000/api/admin/backup
```

### 8.2 Restoring from Backup
```bash
# 1. Verify backup file integrity
./scripts/backup_restore.py verify --db ./backups/aerocascade_backup_20261111_120000.db

# 2. Restore database
./scripts/backup_restore.py restore ./backups/aerocascade_backup_20261111_120000.db --db ./data/aerocascade.db
```

The database integrity check confirms 0 corruption errors and reports row counts across `topologies`, `topology_versions`, and `simulation_runs`.

---

## 9. Upgrade & Rollback Procedures

### 9.1 Zero-Downtime Upgrade Sequence
1. Place the new offline release bundle in `/opt/aerocascade-upgrade`.
2. Verify checksums: `sha256sum -c release/SHA256SUMS`.
3. Load new image versions:
   ```bash
   docker load -i release/aerocascade-gateway-2.1.0.tar.gz
   docker load -i release/aerocascade-backend-2.1.0.tar.gz
   ```
4. Perform pre-upgrade database backup:
   ```bash
   ./scripts/backup_restore.py backup --db ./data/aerocascade.db --out ./backups/pre_upgrade_backup.db
   ```
5. Update `image:` tags in `docker-compose.yml`.
6. Apply new containers:
   ```bash
   docker compose up -d --no-build --pull never
   ```
7. Verify health: `curl -f http://127.0.0.1:3000/api/health`.

### 9.2 Rollback Sequence
If an upgrade must be reverted:
1. Revert `docker-compose.yml` to the previous image tags (`2.0.0`).
2. Restore the pre-upgrade database backup:
   ```bash
   ./scripts/backup_restore.py restore ./backups/pre_upgrade_backup.db --db ./data/aerocascade.db
   ```
3. Restart previous container generation:
   ```bash
   docker compose up -d --no-build --pull never
   ```
4. Confirm health check responds with HTTP 200.
