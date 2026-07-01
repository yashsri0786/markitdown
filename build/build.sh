#!/bin/bash
# Build script for MarkItDown Desktop.
# Produces dist/MarkItDown/ folder + dist/MarkItDown-macOS.zip.
#
# Requirements (one-time, on YOUR build machine):
#   - macOS
#   - uv installed (https://docs.astral.sh/uv/)
#   - Python 3.11 or 3.12 available via uv
#
# Recipients of the zip need NOTHING installed.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "==> Cleaning previous build"
rm -rf "$ROOT/build/work" "$ROOT/dist"
mkdir -p "$ROOT/build/work" "$ROOT/dist"

echo "==> Installing dependencies (uv sync --extra build)"
uv sync --extra build

echo "==> Running PyInstaller"
uv run pyinstaller \
    --noconfirm \
    --clean \
    --onedir \
    --name server \
    --distpath "$ROOT/build/work/dist" \
    --workpath "$ROOT/build/work/build" \
    --specpath "$ROOT/build/work" \
    --collect-all markitdown \
    --hidden-import sse_starlette \
    --hidden-import uvicorn.logging \
    --hidden-import uvicorn.loops \
    --hidden-import uvicorn.loops.auto \
    --hidden-import uvicorn.protocols \
    --hidden-import uvicorn.protocols.http \
    --hidden-import uvicorn.protocols.http.auto \
    --hidden-import uvicorn.protocols.websockets \
    --hidden-import uvicorn.protocols.websockets.auto \
    --hidden-import uvicorn.lifespan \
    --hidden-import uvicorn.lifespan.on \
    "$ROOT/server/server.py"

echo "==> Assembling app folder"
APP_DIR="$ROOT/dist/MarkItDown"
mkdir -p "$APP_DIR"
cp -R "$ROOT/build/work/dist/server" "$APP_DIR/runtime"
cp -R "$ROOT/web" "$APP_DIR/web"
cp "$ROOT/MarkItDown.command" "$APP_DIR/"
cp "$ROOT/README.txt" "$APP_DIR/"
chmod +x "$APP_DIR/MarkItDown.command"
chmod +x "$APP_DIR/runtime/server"

echo "==> Zipping"
cd "$ROOT/dist"
zip -rq MarkItDown-macOS.zip MarkItDown
cd - >/dev/null

SIZE=$(du -sh "$ROOT/dist/MarkItDown-macOS.zip" | awk '{print $1}')
echo ""
echo "✅ Done."
echo "   Folder: $APP_DIR"
echo "   Zip:    $ROOT/dist/MarkItDown-macOS.zip ($SIZE)"
echo ""
echo "Recipient steps:"
echo "  1. Unzip"
echo "  2. Right-click MarkItDown.command → Open → Open (Gatekeeper, one time)"
echo "  3. Browser opens. Drag files. Done."
