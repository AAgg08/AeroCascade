#!/usr/bin/env python3
"""
AeroCascade Docker Image Archive Generator
Creates standard OCI/Docker image tar archives (compatible with `docker load`)
without requiring a live Docker daemon on the build host.
"""

import hashlib
import json
import os
import tarfile
import tempfile
import time
from pathlib import Path


def compute_sha256(filepath: str) -> str:
    h = hashlib.sha256()
    with open(filepath, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def build_gateway_archive(repo_root: Path, output_tar: Path) -> None:
    print(f"Building Docker image archive for aerocascade-gateway:2.0.0 -> {output_tar}...")
    output_tar.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        layer_root = tmp_path / "rootfs"
        layer_root.mkdir(parents=True, exist_ok=True)

        app_dir = layer_root / "app"
        app_dir.mkdir(parents=True, exist_ok=True)

        # Copy dist
        dist_src = repo_root / "dist"
        if dist_src.exists():
            os.system(f"cp -r {dist_src} {app_dir}/dist")

        # Copy dist-server
        dist_srv = repo_root / "dist-server"
        if dist_srv.exists():
            os.system(f"cp -r {dist_srv} {app_dir}/dist-server")

        # Copy package.json
        os.system(f"cp {repo_root}/package.json {app_dir}/package.json")

        # Create layer.tar
        layer_tar_path = tmp_path / "layer.tar"
        with tarfile.open(layer_tar_path, "w") as tar:
            tar.add(layer_root, arcname="")

        layer_sha = compute_sha256(str(layer_tar_path))
        diff_id = f"sha256:{layer_sha}"

        # Config JSON
        config_obj = {
            "architecture": "amd64",
            "os": "linux",
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "config": {
                "User": "10001:10001",
                "ExposedPorts": {"3000/tcp": {}},
                "Env": [
                    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                    "NODE_ENV=production",
                    "ENTERPRISE_MODE=true",
                    "PORT=3000",
                    "PYTHON_BACKEND_URL=http://backend:8000",
                ],
                "Cmd": ["node", "dist-server/server.mjs"],
                "WorkingDir": "/app",
            },
            "rootfs": {
                "type": "layers",
                "diff_ids": [diff_id],
            },
        }

        config_str = json.dumps(config_obj, indent=2)
        config_hash = hashlib.sha256(config_str.encode("utf-8")).hexdigest()
        config_filename = f"{config_hash}.json"

        with open(tmp_path / config_filename, "w", encoding="utf-8") as f:
            f.write(config_str)

        # Manifest JSON
        manifest_obj = [
            {
                "Config": config_filename,
                "RepoTags": ["aerocascade-gateway:2.0.0"],
                "Layers": ["layer.tar"],
            }
        ]
        with open(tmp_path / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(manifest_obj, f, indent=2)

        # Repositories JSON
        repos_obj = {
            "aerocascade-gateway": {
                "2.0.0": config_hash
            }
        }
        with open(tmp_path / "repositories", "w", encoding="utf-8") as f:
            json.dump(repos_obj, f, indent=2)

        # Assemble final archive
        with tarfile.open(output_tar, "w:gz") as final_tar:
            final_tar.add(tmp_path / "manifest.json", arcname="manifest.json")
            final_tar.add(tmp_path / "repositories", arcname="repositories")
            final_tar.add(tmp_path / config_filename, arcname=config_filename)
            final_tar.add(layer_tar_path, arcname="layer.tar")

    print(f"Gateway archive generated: {output_tar.stat().st_size} bytes")


def build_backend_archive(repo_root: Path, output_tar: Path) -> None:
    print(f"Building Docker image archive for aerocascade-backend:2.0.0 -> {output_tar}...")
    output_tar.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_path = Path(tmpdir)
        layer_root = tmp_path / "rootfs"
        layer_root.mkdir(parents=True, exist_ok=True)

        app_dir = layer_root / "app"
        app_dir.mkdir(parents=True, exist_ok=True)

        # Copy backend directory and requirements
        os.system(f"cp -r {repo_root}/backend {app_dir}/backend")
        os.system(f"cp {repo_root}/backend/requirements.txt {app_dir}/requirements.txt")

        # Create var/lib directories
        var_dir = layer_root / "var" / "lib" / "aerocascade"
        (var_dir / "data").mkdir(parents=True, exist_ok=True)
        (var_dir / "backups").mkdir(parents=True, exist_ok=True)
        (layer_root / "tmp").mkdir(parents=True, exist_ok=True)

        # Create layer.tar
        layer_tar_path = tmp_path / "layer.tar"
        with tarfile.open(layer_tar_path, "w") as tar:
            tar.add(layer_root, arcname="")

        layer_sha = compute_sha256(str(layer_tar_path))
        diff_id = f"sha256:{layer_sha}"

        # Config JSON
        config_obj = {
            "architecture": "amd64",
            "os": "linux",
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "config": {
                "User": "10001:10001",
                "ExposedPorts": {"8000/tcp": {}},
                "Env": [
                    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
                    "PYTHONUNBUFFERED=1",
                    "PYTHONDONTWRITEBYTECODE=1",
                    "ENTERPRISE_MODE=true",
                    "AEROCASCADE_DB_PATH=/var/lib/aerocascade/data/aerocascade.db",
                    "AEROCASCADE_BACKUP_DIR=/var/lib/aerocascade/backups",
                ],
                "Cmd": ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"],
                "WorkingDir": "/app",
            },
            "rootfs": {
                "type": "layers",
                "diff_ids": [diff_id],
            },
        }

        config_str = json.dumps(config_obj, indent=2)
        config_hash = hashlib.sha256(config_str.encode("utf-8")).hexdigest()
        config_filename = f"{config_hash}.json"

        with open(tmp_path / config_filename, "w", encoding="utf-8") as f:
            f.write(config_str)

        manifest_obj = [
            {
                "Config": config_filename,
                "RepoTags": ["aerocascade-backend:2.0.0"],
                "Layers": ["layer.tar"],
            }
        ]
        with open(tmp_path / "manifest.json", "w", encoding="utf-8") as f:
            json.dump(manifest_obj, f, indent=2)

        repos_obj = {
            "aerocascade-backend": {
                "2.0.0": config_hash
            }
        }
        with open(tmp_path / "repositories", "w", encoding="utf-8") as f:
            json.dump(repos_obj, f, indent=2)

        with tarfile.open(output_tar, "w:gz") as final_tar:
            final_tar.add(tmp_path / "manifest.json", arcname="manifest.json")
            final_tar.add(tmp_path / "repositories", arcname="repositories")
            final_tar.add(tmp_path / config_filename, arcname=config_filename)
            final_tar.add(layer_tar_path, arcname="layer.tar")

    print(f"Backend archive generated: {output_tar.stat().st_size} bytes")


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parent.parent
    rel_dir = repo_root / "release"
    build_gateway_archive(repo_root, rel_dir / "aerocascade-gateway-2.0.0.tar.gz")
    build_backend_archive(repo_root, rel_dir / "aerocascade-backend-2.0.0.tar.gz")
