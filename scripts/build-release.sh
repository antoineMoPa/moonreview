#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PACKAGE_VERSION="$(awk -F '"' '$1 == "version = " { print $2; exit }' Cargo.toml)"
TAG="v$PACKAGE_VERSION"
TARGET_TRIPLE="aarch64-apple-darwin"
ASSET_BASENAME="moonreview-${TARGET_TRIPLE}"
OUTPUT_DIR="$ROOT_DIR/target/release-artifacts/$TAG"
STAGE_DIR="$OUTPUT_DIR/stage"
ARCHIVE_PATH="$OUTPUT_DIR/${ASSET_BASENAME}.tar.gz"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"

mkdir -p "$STAGE_DIR"

echo "Building moonreview $TAG for $TARGET_TRIPLE..."
cargo build --release --locked

cp "$ROOT_DIR/target/release/moonreview" "$STAGE_DIR/moonreview"
chmod 0755 "$STAGE_DIR/moonreview"

tar -C "$STAGE_DIR" -czf "$ARCHIVE_PATH" moonreview
(
    cd "$OUTPUT_DIR"
    shasum -a 256 "$(basename "$ARCHIVE_PATH")" >"$(basename "$CHECKSUM_PATH")"
)

cat <<EOF
Created release artifacts:
  $ARCHIVE_PATH
  $CHECKSUM_PATH

Next step:
  scripts/upload-release.sh
EOF
