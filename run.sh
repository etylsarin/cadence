#!/bin/zsh
# Cadence — start dev or prod server
# Usage:
#   ./run.sh          → production (serves built dist/)
#   ./run.sh dev      → dev mode (Vite HMR on :5173 + FastAPI on :8765)
#   ./run.sh mock     → dev mode + offline mock Jira on :9876
#                       (point .env at JIRA_URL=http://localhost:9876)
#   ./run.sh build    → build frontend only

NODE_DIR="$HOME/node-v24.14.0-darwin-arm64"
if [ -v NVM_DIR ]; then
  if [ -s "$NVM_DIR/nvm.sh" ]; then
    source "$NVM_DIR/nvm.sh"
  fi
fi
if [ -n "$(command -v nvm)" ]; then
  nvm use current &>/dev/null || (nvm install 24.14.0 && nvm use 24.14.0)
  NODE_DIR=$(dirname $(dirname $(nvm which current)))
fi

NODE_BIN="${NODE_DIR}/bin"
NODE="$NODE_BIN/node"
NPM=($NODE "$NODE_DIR/lib/node_modules/npm/bin/npm-cli.js")
if [ ! -d "$PWD/frontend/node_modules/.bin" ]; then
  echo "Installing frontend dependencies…"
  (cd frontend && $NPM install)
fi
VITE=($NODE "$PWD/frontend/node_modules/.bin/vite")

# Add node to PATH for child processes
export PATH="$NODE_BIN:$PATH"

# Backend Python: prefer the project venv (created via `python3 -m venv .venv`
# + `.venv/bin/pip install -r backend/requirements.txt`) so uvicorn/fastapi
# resolve without the user having to activate it. Fall back to system python3.
PY="python3"
if [ -x "$PWD/.venv/bin/python" ]; then
  PY="$PWD/.venv/bin/python"
fi

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
    $PY -m uvicorn server:app --app-dir backend --port 8765 --reload &
    API_PID=$!
    trap "kill $API_PID 2>/dev/null" EXIT INT TERM
    cd frontend && $VITE dev
    ;;
  mock)
    # Free the mock-Jira port too (8765 already cleared above)
    lsof -ti:9876 | xargs kill 2>/dev/null || true
    echo "Starting dev mode with offline mock Jira…"
    echo "  Mock Jira → http://localhost:9876  (set .env JIRA_URL to this)"
    echo "  API       → http://localhost:8765"
    echo "  UI        → http://localhost:5173"
    $PY -m uvicorn tools.mock_jira:app --app-dir backend --port 9876 &
    MOCK_PID=$!
    $PY -m uvicorn server:app --app-dir backend --port 8765 --reload &
    API_PID=$!
    trap "kill $API_PID $MOCK_PID 2>/dev/null" EXIT INT TERM
    cd frontend && $VITE dev
    ;;
  prod|*)
    echo "Building frontend…"
    (cd frontend && $VITE build)
    echo "Starting server → http://localhost:8765"
    $PY -m uvicorn server:app --app-dir backend --port 8765
    ;;
esac
