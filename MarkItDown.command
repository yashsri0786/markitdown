#!/bin/bash
# MarkItDown Desktop launcher (macOS).
# Double-click in Finder. Opens a Terminal window with this script running.
# Starts the local server, opens the browser, shuts down when the window closes.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Path search: Finder doesn't inherit your shell PATH. Add common locations.
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

# Choose how to launch the server, in priority order.
SERVER_BIN="$SCRIPT_DIR/runtime/server"        # packaged (PyInstaller --onedir)
VENV_PY="$SCRIPT_DIR/.venv/bin/python"          # dev w/ uv sync already done
DEV_ENTRY="$SCRIPT_DIR/server/server.py"

if [[ -x "$SERVER_BIN" ]]; then
    LAUNCH=("$SERVER_BIN")
elif [[ -x "$VENV_PY" ]]; then
    LAUNCH=("$VENV_PY" "$DEV_ENTRY")
elif command -v uv >/dev/null 2>&1; then
    # Auto-sync deps on first run, then use the venv python.
    echo "First run: installing dependencies via uv (one-time)…"
    (cd "$SCRIPT_DIR" && uv sync) || {
        echo "uv sync failed. See messages above."
        echo "Press any key to close..."; read -n 1; exit 1
    }
    LAUNCH=("$VENV_PY" "$DEV_ENTRY")
else
    cat <<EOF
Cannot find a way to run MarkItDown.

Need ONE of:
  - The packaged binary at: $SERVER_BIN
  - A populated venv at:    $VENV_PY
  - 'uv' installed:         https://docs.astral.sh/uv/

If this is the packaged zip, the runtime/ folder is missing or
corrupt — try unzipping again.
EOF
    echo ""
    echo "Press any key to close..."
    read -n 1
    exit 1
fi

# Pick free port. The server's --print-port path imports nothing heavy.
PORT=$("${LAUNCH[@]}" --print-port 2>/dev/null || true)
if [[ -z "$PORT" ]]; then
    echo "Could not pick a free port."
    echo "Launch command was: ${LAUNCH[@]} --print-port"
    echo "Try running it manually to see the error."
    echo "Press any key to close..."
    read -n 1
    exit 1
fi

echo "==============================================="
echo " 🪄 Birbal's MarkItDown Desktop"
echo "-----------------------------------------------"
echo " URL: http://127.0.0.1:$PORT"
echo " Close this Terminal window to quit."
echo "==============================================="
echo ""

"${LAUNCH[@]}" --port "$PORT" &
SERVER_PID=$!

trap 'echo ""; echo "Shutting down…"; kill $SERVER_PID 2>/dev/null; wait $SERVER_PID 2>/dev/null; exit 0' EXIT INT TERM

# Wait for server to be reachable, then open browser.
for _ in $(seq 1 50); do
    if curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; then
        break
    fi
    sleep 0.2
done

open "http://127.0.0.1:$PORT"
wait $SERVER_PID
