#!/usr/bin/env python
"""Generate Software Bill of Materials (SBOM) for Tawreed.

Usage:
    python scripts/generate_sbom.py [--format json|csv] [--output FILE]

Generates an SBOM in CycloneDX format listing all dependencies.
"""

import argparse
import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path


def _read_project_version() -> str:
    import tomllib

    pyproject_path = Path(__file__).parent.parent / "pyproject.toml"
    with open(pyproject_path, "rb") as f:
        return str(tomllib.load(f)["project"]["version"])


# Project metadata
PROJECT_NAME = "Tawreed"
PROJECT_VERSION = _read_project_version()
PROJECT_DESCRIPTION = "AI-driven BOQ work-package extraction for construction QSs."
PROJECT_LICENSE = "MIT"
PROJECT_URL = "https://github.com/sfkareem/tawreed"


def get_pip_dependencies():
    """Get list of installed dependencies from pip."""
    result = subprocess.run(
        [sys.executable, "-m", "pip", "list", "--format=json"],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"Warning: Could not get pip dependencies: {result.stderr}")
        return []

    try:
        packages = json.loads(result.stdout)
        return [
            {
                "name": pkg["name"],
                "version": pkg["version"],
            }
            for pkg in packages
        ]
    except json.JSONDecodeError:
        print("Warning: Could not parse pip list output")
        return []


def get_project_dependencies():
    """Get dependencies from pyproject.toml."""
    pyproject_path = Path(__file__).parent.parent / "pyproject.toml"

    try:
        import tomllib

        with open(pyproject_path, "rb") as f:
            data = tomllib.load(f)

        deps = []
        for dep in data.get("project", {}).get("dependencies", []):
            # Parse dependency string (e.g., "PySide6>=6.6,<7" -> name="PySide6", version=">=6.6,<7")
            if ">=" in dep:
                name, version = dep.split(">=", 1)
                version = ">=" + version.split(",")[0]
            elif "==" in dep:
                name, version = dep.split("==", 1)
            else:
                name = dep
                version = "*"
            deps.append({"name": name.strip(), "version": version.strip()})

        return deps
    except Exception as e:
        print(f"Warning: Could not parse pyproject.toml: {e}")
        return []


def generate_cyclonedx_sbom(dependencies, output_format="json"):
    """Generate SBOM in CycloneDX format."""
    sbom = {
        "bomFormat": "CycloneDX",
        "specVersion": "1.4",
        "serialNumber": f"urn:uuid:{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "version": 1,
        "metadata": {
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "tools": [{"name": "tawreed-sbom-generator", "version": "1.0"}],
            "component": {
                "type": "application",
                "bom-ref": f"pkg:pypi/{PROJECT_NAME}@{PROJECT_VERSION}",
                "name": PROJECT_NAME,
                "version": PROJECT_VERSION,
                "description": PROJECT_DESCRIPTION,
                "licenses": [{"license": {"id": PROJECT_LICENSE}}],
                "purl": f"pkg:pypi/{PROJECT_NAME}@{PROJECT_VERSION}",
                "externalReferences": [
                    {
                        "type": "website",
                        "url": PROJECT_URL,
                    },
                    {
                        "type": "vcs",
                        "url": f"{PROJECT_URL}.git",
                    },
                ],
            },
        },
        "components": [],
        "dependencies": [
            {
                "ref": f"pkg:pypi/{PROJECT_NAME}@{PROJECT_VERSION}",
                "dependsOn": [],
            }
        ],
    }

    # Add dependencies
    for _i, dep in enumerate(dependencies):
        component = {
            "type": "library",
            "bom-ref": f"pkg:pypi/{dep['name']}@{dep['version']}",
            "name": dep["name"],
            "version": dep["version"],
            "purl": f"pkg:pypi/{dep['name']}@{dep['version']}",
        }
        sbom["components"].append(component)
        sbom["dependencies"][0]["dependsOn"].append(component["bom-ref"])

    if output_format == "json":
        return json.dumps(sbom, indent=2)
    elif output_format == "csv":
        # Simple CSV format
        lines = ["Name,Version,Type,PURL"]
        lines.append(
            f"{PROJECT_NAME},{PROJECT_VERSION},application,pkg:pypi/{PROJECT_NAME}@{PROJECT_VERSION}"
        )
        for dep in dependencies:
            lines.append(
                f"{dep['name']},{dep['version']},library,pkg:pypi/{dep['name']}@{dep['version']}"
            )
        return "\n".join(lines)
    else:
        raise ValueError(f"Unsupported format: {output_format}")


def main():
    parser = argparse.ArgumentParser(description="Generate SBOM for Tawreed")
    parser.add_argument("--format", choices=["json", "csv"], default="json", help="Output format")
    parser.add_argument("--output", "-o", type=str, default="sbom.json", help="Output file")
    parser.add_argument(
        "--source",
        choices=["pip", "pyproject"],
        default="pyproject",
        help="Source of dependencies (pip for installed, pyproject for declared)",
    )
    args = parser.parse_args()

    # Get dependencies
    if args.source == "pip":
        dependencies = get_pip_dependencies()
    else:
        dependencies = get_project_dependencies()

    print(f"Found {len(dependencies)} dependencies")

    # Generate SBOM
    sbom_content = generate_cyclonedx_sbom(dependencies, args.format)

    # Write output
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(sbom_content)

    print(f"SBOM written to {args.output}")
    print(f"Format: {args.format}")
    print(f"Components: {len(dependencies)}")


if __name__ == "__main__":
    main()
