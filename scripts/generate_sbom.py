#!/usr/bin/env python3
"""
AeroCascade SBOM Generator
Produces a CycloneDX 1.5 JSON Software Bill of Materials (SBOM) for the air-gapped release.
"""

import json
import time
import uuid
from pathlib import Path


def generate_sbom(repo_root: Path, output_file: Path) -> None:
    output_file.parent.mkdir(parents=True, exist_ok=True)

    # Core Python dependencies from requirements.txt
    python_deps = [
        {"name": "fastapi", "version": "0.115.0", "license": "MIT", "summary": "FastAPI framework"},
        {"name": "uvicorn", "version": "0.32.0", "license": "BSD-3-Clause", "summary": "ASGI server"},
        {"name": "pydantic", "version": "2.14.1", "license": "MIT", "summary": "Data validation using Python type hints"},
        {"name": "networkx", "version": "3.4.2", "license": "BSD-3-Clause", "summary": "Network analysis in Python"},
        {"name": "simpy", "version": "4.1.2", "license": "MIT", "summary": "Discrete event simulation framework"},
        {"name": "numpy", "version": "2.1.2", "license": "BSD-3-Clause", "summary": "Fundamental package for scientific computing"},
        {"name": "openpyxl", "version": "3.1.5", "license": "MIT", "summary": "Excel 2010 xlsx/xlsm reader/writer"},
        {"name": "python-multipart", "version": "0.0.33", "license": "Apache-2.0", "summary": "Streaming multipart parser for Python"},
        {"name": "httpx", "version": "0.28.1", "license": "BSD-3-Clause", "summary": "Next-generation HTTP client for Python"},
    ]

    # Core npm dependencies from package.json
    npm_deps = [
        {"name": "react", "version": "19.0.1", "license": "MIT", "summary": "React library for UI"},
        {"name": "react-dom", "version": "19.0.1", "license": "MIT", "summary": "React package for working with the DOM"},
        {"name": "zustand", "version": "5.0.15", "license": "MIT", "summary": "Bear necessities state management in React"},
        {"name": "express", "version": "4.21.2", "license": "MIT", "summary": "Fast, unopinionated, minimalist web framework"},
        {"name": "@dagrejs/dagre", "version": "3.1.1", "license": "MIT", "summary": "Directed graph layout library"},
        {"name": "@xyflow/react", "version": "12.12.0", "license": "MIT", "summary": "Node-based UIs and workflow editors"},
        {"name": "lucide-react", "version": "0.546.0", "license": "ISC", "summary": "Lucide icon set for React"},
        {"name": "motion", "version": "12.23.24", "license": "MIT", "summary": "Animation library for React"},
        {"name": "recharts", "version": "3.10.1", "license": "MIT", "summary": "Redefined chart library built with React and D3"},
        {"name": "react-to-print", "version": "3.3.0", "license": "MIT", "summary": "Print React components in browser"},
        {"name": "vite", "version": "8.3.5", "license": "MIT", "summary": "Next Generation Frontend Tooling"},
        {"name": "tailwindcss", "version": "4.3.3", "license": "MIT", "summary": "A utility-first CSS framework"},
        {"name": "typescript", "version": "7.0.2", "license": "Apache-2.0", "summary": "TypeScript language support"},
        {"name": "dotenv", "version": "17.2.3", "license": "BSD-2-Clause", "summary": "Loads environment variables from .env"},
    ]

    # Base OS Container images
    base_images = [
        {
            "name": "node-alpine",
            "version": "22-alpine",
            "purl": "pkg:docker/library/node@22-alpine",
            "license": "MIT",
            "description": "Hardened unprivileged Alpine Linux Node runtime container base",
        },
        {
            "name": "python-slim",
            "version": "3.12-slim",
            "purl": "pkg:docker/library/python@3.12-slim",
            "license": "PSF-2.0",
            "description": "Hardened unprivileged Debian Bookworm Python runtime container base",
        },
    ]

    components = []

    # Add OS bases
    for base in base_images:
        components.append({
            "type": "container",
            "name": base["name"],
            "version": base["version"],
            "purl": base["purl"],
            "description": base["description"],
            "licenses": [{"license": {"id": base["license"]}}],
        })

    # Add Python dependencies
    for p in python_deps:
        components.append({
            "type": "library",
            "name": p["name"],
            "version": p["version"],
            "purl": f"pkg:pypi/{p['name']}@{p['version']}",
            "description": p["summary"],
            "licenses": [{"license": {"id": p["license"]}}],
        })

    # Add npm dependencies
    for n in npm_deps:
        components.append({
            "type": "library",
            "name": n["name"],
            "version": n["version"],
            "purl": f"pkg:npm/{n['name']}@{n['version']}",
            "description": n["summary"],
            "licenses": [{"license": {"id": n["license"]}}],
        })

    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.5",
        "serialNumber": f"urn:uuid:{uuid.uuid4()}",
        "version": 1,
        "metadata": {
            "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "tools": [
                {
                    "vendor": "AeroCascade Security Engineering",
                    "name": "AeroCascade SBOM Generator",
                    "version": "2.0.0",
                }
            ],
            "component": {
                "type": "application",
                "name": "AeroCascade",
                "version": "2.0.0",
                "description": "Enterprise Air-Gapped Remote Tower Cascading Failure Simulation & EASA Part-IS Risk Platform",
                "licenses": [{"license": {"id": "Proprietary"}}],
            },
        },
        "components": components,
    }

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(sbom, f, indent=2)

    print(f"CycloneDX SBOM generated: {output_file} ({len(components)} components)")


if __name__ == "__main__":
    repo_root = Path(__file__).resolve().parent.parent
    generate_sbom(repo_root, repo_root / "release" / "sbom.json")
