#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if (($# > 0)); then
    echo "usage: scripts/bin-release.sh" >&2
    exit 1
fi

sh -n install.sh
bash -n scripts/build-release.sh
bash -n scripts/upload-release.sh

scripts/build-release.sh

scripts/upload-release.sh
