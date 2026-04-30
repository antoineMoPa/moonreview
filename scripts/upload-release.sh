#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PACKAGE_VERSION="$(awk -F '"' '$1 == "version = " { print $2; exit }' Cargo.toml)"
TAG="v$PACKAGE_VERSION"
TARGET_TRIPLE="aarch64-apple-darwin"
ASSET_BASENAME="moonreview-${TARGET_TRIPLE}"
OUTPUT_DIR="$ROOT_DIR/target/release-artifacts/$TAG"
ARCHIVE_PATH="$OUTPUT_DIR/${ASSET_BASENAME}.tar.gz"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"

if ! command -v gh >/dev/null 2>&1; then
    echo "GitHub CLI (gh) is required to upload release assets." >&2
    exit 1
fi

if [ ! -f "$ARCHIVE_PATH" ] || [ ! -f "$CHECKSUM_PATH" ]; then
    echo "missing release assets for $TAG; run scripts/build-release.sh first" >&2
    exit 1
fi

if gh release view "$TAG" >/dev/null 2>&1; then
    echo "release $TAG already exists; run 'npm version minor' before uploading release assets" >&2
    exit 1
else
    echo "Creating release $TAG and uploading assets..."
    gh release create "$TAG" "$ARCHIVE_PATH" "$CHECKSUM_PATH" \
        --title "$TAG" \
        --notes "moonreview ${TAG#v}"
fi

echo "Release ready: $TAG"
