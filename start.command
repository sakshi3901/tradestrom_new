#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
WEB_DIR="$ROOT_DIR/web"
API_DIR="$ROOT_DIR/api"

WEB_PORT="${WEB_PORT:-3000}"
API_PORT="${API_PORT:-8080}"

kill_port() {
  local port="$1"
  local pids

  pids="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"

  if [[ -z "$pids" ]]; then
    echo "[start] Port $port is already free"
    return
  fi

  echo "[start] Clearing port $port (PIDs: $pids)"

  kill $pids 2>/dev/null || true
  sleep 1

  local remaining
  remaining="$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "$remaining" ]]; then
    echo "[start] Force killing remaining on $port (PIDs: $remaining)"
    kill -9 $remaining 2>/dev/null || true
  fi
}

require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "[error] Missing required command: $cmd"
    exit 1
  fi
}

run_with_timeout() {
  local timeout_secs="$1"
  shift

  "$@" &
  local cmd_pid=$!

  (
    sleep "$timeout_secs"
    if kill -0 "$cmd_pid" 2>/dev/null; then
      echo "[warning] Command timed out after ${timeout_secs}s: $*"
      kill "$cmd_pid" 2>/dev/null || true
      sleep 1
      kill -9 "$cmd_pid" 2>/dev/null || true
    fi
  ) &
  local watchdog_pid=$!

  local status=0
  wait "$cmd_pid" || status=$?
  kill "$watchdog_pid" 2>/dev/null || true
  wait "$watchdog_pid" 2>/dev/null || true

  return "$status"
}

ensure_air() {
  if command -v air >/dev/null 2>&1; then
    return 0
  fi

  local auto_install
  auto_install="${AUTO_INSTALL_AIR:-0}"
  if [[ "$auto_install" != "1" ]]; then
    echo "[start] air not found; using go run . (set AUTO_INSTALL_AIR=1 to auto-install)"
    return 1
  fi

  local install_timeout
  install_timeout="${AIR_INSTALL_TIMEOUT_SECONDS:-25}"

  echo "[start] Installing Go hot-reload tool (air)"
  if ! run_with_timeout "$install_timeout" go install github.com/air-verse/air@latest; then
    echo "[warning] Failed to install air; falling back to go run ."
    return 1
  fi

  local gobin
  gobin="$(go env GOBIN 2>/dev/null || true)"
  local gopath
  gopath="$(go env GOPATH 2>/dev/null || true)"

  if [[ -n "$gobin" ]]; then
    export PATH="$gobin:$PATH"
  elif [[ -n "$gopath" ]]; then
    export PATH="$gopath/bin:$PATH"
  fi

  if command -v air >/dev/null 2>&1; then
    echo "[start] air is ready"
    return 0
  fi

  echo "[warning] air installed but not found in PATH; falling back to go run ."
  return 1
}

load_env_file() {
  local env_file="$1"

  if [[ -f "$env_file" ]]; then
    while IFS= read -r line || [[ -n "$line" ]]; do
      line="${line%$'\r'}"

      if [[ -z "$line" ]]; then
        continue
      fi

      if [[ "$line" =~ ^[[:space:]]*# ]]; then
        continue
      fi

      if [[ "$line" != *=* ]]; then
        continue
      fi

      local key="${line%%=*}"
      local value="${line#*=}"

      key="${key#"${key%%[![:space:]]*}"}"
      key="${key%"${key##*[![:space:]]}"}"
      value="${value#"${value%%[![:space:]]*}"}"
      value="${value%"${value##*[![:space:]]}"}"

      if [[ "$value" == \"*\" && "$value" == *\" ]]; then
        value="${value:1:${#value}-2}"
      fi
      if [[ "$value" == \'*\' && "$value" == *\' ]]; then
        value="${value:1:${#value}-2}"
      fi

      export "$key=$value"
    done < "$env_file"
  fi
}

clear_next_cache() {
  local next_dir="$WEB_DIR/.next"

  if [[ ! -d "$next_dir" ]]; then
    return
  fi

  echo "[start] Clearing stale Next.js build cache"
  find "$next_dir" -mindepth 1 -depth -delete 2>/dev/null || true
}

cleanup() {
  if [[ "${CLEANED_UP:-0}" -eq 1 ]]; then
    return
  fi
  CLEANED_UP=1

  local code=$?

  if [[ -n "${API_PID:-}" ]]; then
    kill "$API_PID" 2>/dev/null || true
  fi

  if [[ -n "${WEB_PID:-}" ]]; then
    kill "$WEB_PID" 2>/dev/null || true
  fi

  wait 2>/dev/null || true

  if [[ $code -ne 0 ]]; then
    echo "[start] Exiting with status $code"
  fi
}

trap cleanup EXIT INT TERM

require_cmd lsof
require_cmd npm
require_cmd node

if ! command -v go >/dev/null 2>&1; then
  echo "[error] Missing required command: go"
  echo "[hint] Install Go with: brew install go"
  echo "[hint] Then rerun: $ROOT_DIR/start.command"
  exit 1
fi

if [[ ! -d "$WEB_DIR" ]]; then
  echo "[error] Missing web directory: $WEB_DIR"
  exit 1
fi

if [[ ! -d "$API_DIR" ]]; then
  echo "[error] Missing api directory: $API_DIR"
  exit 1
fi

USE_AIR=0
if ensure_air; then
  USE_AIR=1
fi

kill_port "$WEB_PORT"
kill_port "$API_PORT"
clear_next_cache

if [[ ! -f "$WEB_DIR/.env" ]]; then
  echo "[warning] $WEB_DIR/.env is missing"
fi

if [[ ! -f "$API_DIR/.env" ]]; then
  echo "[warning] $API_DIR/.env is missing"
fi

echo "[start] Starting Go API on port $API_PORT"
(
  cd "$API_DIR"
  load_env_file "$API_DIR/.env"
  export PORT="$API_PORT"

  if [[ "$USE_AIR" -eq 1 ]]; then
    exec air -c .air.toml
  fi

  exec go run .
) &
API_PID=$!

sleep 1

echo "[start] Starting Next.js web on port $WEB_PORT"
(
  cd "$WEB_DIR"
  export PORT="$WEB_PORT"
  exec npm run dev -- --port "$WEB_PORT"
) &
WEB_PID=$!

echo "[start] Services started"
echo "[start] API: http://localhost:$API_PORT"
echo "[start] Web: http://localhost:$WEB_PORT"
echo "[start] Press Ctrl+C to stop both"

while true; do
  if ! kill -0 "$API_PID" 2>/dev/null; then
    wait "$API_PID" 2>/dev/null || true
    echo "[start] API process exited"
    exit 1
  fi

  if ! kill -0 "$WEB_PID" 2>/dev/null; then
    wait "$WEB_PID" 2>/dev/null || true
    echo "[start] Web process exited"
    exit 1
  fi

  sleep 1
done
