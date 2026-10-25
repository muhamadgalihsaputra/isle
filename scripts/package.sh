#!/usr/bin/env bash
# Packs a release with the programs ready-built, so installing needs no Rust:
#   dist/isle-<version>-<arch>-linux.tar.gz and its .sha256
# Usage: scripts/package.sh [version]   (default: the version in Cargo.toml)
# Building isle-shelf needs the GTK 4 development files (libgtk-4-dev), and isle-whisper cmake, a C++
# compiler, libclang, the Vulkan headers and glslc (cmake g++ libclang-dev libvulkan-dev glslc).
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION="${1:-$(sed -n 's/^version = "\(.*\)"/\1/p' Cargo.toml | head -n1)}"
NAME="isle-$VERSION-$(uname -m)-linux"
OUT="dist/$NAME"

cargo build --release --locked -p isle-daemon -p isle-shelf -p isle-whisper

rm -rf "$OUT" "dist/$NAME.tar.gz" "dist/$NAME.tar.gz.sha256"
mkdir -p "$OUT/bin"
install -m755 target/release/isled target/release/isle-shelf target/release/isle-whisper "$OUT/bin/"
strip "$OUT/bin/isled" "$OUT/bin/isle-shelf" "$OUT/bin/isle-whisper"
cp -r gnome-extension data mcp install.sh uninstall.sh README.md LICENSE CHANGELOG.md "$OUT/"
mkdir -p "$OUT/docs"
install -m644 docs/mcp.md "$OUT/docs/mcp.md"
# What install.sh installs as commands: the voice set-up and the battery charge limit.
mkdir -p "$OUT/scripts"
install -m755 scripts/setup-voice.sh scripts/setup-mcp.sh scripts/isle-mcp scripts/isle-charge-limit "$OUT/scripts/"
# Compiled on install, for the GLib there.
rm -f "$OUT/gnome-extension/schemas/gschemas.compiled"

tar -C dist -czf "dist/$NAME.tar.gz" "$NAME"
(cd dist && sha256sum "$NAME.tar.gz" > "$NAME.tar.gz.sha256")
rm -rf "$OUT"
echo "dist/$NAME.tar.gz"
