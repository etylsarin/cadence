#!/bin/zsh
# Cadence — start dev or prod server
# Usage:
#   ./run.sh          → production (serves built dist/)
#   ./run.sh dev      → dev mode (Vite HMR on :5173 + FastAPI on :8765)
#   ./run.sh build    → build frontend only

NODE_BIN="$HOME/node-v24.14.0-darwin-arm64/bin"
NODE="$NODE_BIN/node"
NPM=($NODE "$HOME/node-v24.14.0-darwin-arm64/lib/node_modules/npm/bin/npm-cli.js")
VITE=($NODE "$PWD/frontend/node_modules/.bin/vite")

# Add node to PATH for child processes
export PATH="$NODE_BIN:$PATH"

MODE="${1:-prod}"

# Kill any process already on port 8765
lsof -ti:8765 | xargs kill 2>/dev/null || true

case "$MODE" in
  build)
    echo "Building frontend…"
    cd frontend && $VITE build
    ;;
  dev)
    echo "Starting dev mode…"
    echo "  API → http://localhost:8765"
    echo "  UI  → http://localhost:5173"
    python3 -m uvicorn server:app --app-dir backend --port 8765 --reload &
    API_PID=$!
    trap "kill $API_PID 2>/dev/null" EXIT INT TERM
    cd frontend && $VITE dev
    ;;
  prod|*)
    echo "Building frontend…"
    (cd frontend && $VITE build)
    echo "Starting server → http://localhost:8765"
    python3 -m uvicorn server:app --app-dir backend --port 8765
    ;;
esac
