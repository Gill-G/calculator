#!/usr/bin/env bash
# Runs both halves of the app: the Python server (app + arithmetic) on 8000
# and the Node facts service on 3001. Ctrl+C stops both.
set -e
cd "$(dirname "$0")"

export PATH="$HOME/.local/node/bin:$PATH"

if [ ! -d node_modules ]; then
  echo "Installing Node dependencies…"
  npm install
fi

node facts-server.js &
NODE_PID=$!
trap 'kill $NODE_PID 2>/dev/null' EXIT INT TERM

python3 server.py
