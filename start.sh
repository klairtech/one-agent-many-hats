#!/usr/bin/env bash
#
# start.sh — the only command you need.
#
#   ./start.sh              install if needed, build if needed, open the control panel
#   ./start.sh --cli        the terminal session instead of the browser
#   ./start.sh run "..."    one shot in the terminal
#   ./start.sh --reset      throw away the build and start clean
#
# Everything else — connecting a model, picking a model, pricing, memory, skills,
# proposals — happens in the UI. Nothing is installed globally, no sudo, and nothing is
# written outside this directory and $HATS_HOME (default ~/.hats).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; OFF=$'\033[0m'
if [ ! -t 1 ] || [ -n "${NO_COLOR:-}" ]; then BOLD=""; DIM=""; GREEN=""; YELLOW=""; RED=""; OFF=""; fi
step() { printf '%s→%s %s\n' "$DIM" "$OFF" "$*"; }
ok()   { printf '%s ok %s %s\n' "$GREEN" "$OFF" "$*"; }
warn() { printf '%swarn%s %s\n' "$YELLOW" "$OFF" "$*"; }
die()  { printf '%sfail%s %s\n' "$RED" "$OFF" "$*" >&2; exit 1; }

MODE="ui"
PASSTHROUGH=()

while [ "$#" -gt 0 ]; do
  case "$1" in
    --reset) step "removing dist/ and node_modules/"; rm -rf dist node_modules; shift ;;
    --cli)   MODE="cli"; shift ;;
    --no-open) NO_OPEN=1; shift ;;
    *)       MODE="passthrough"; PASSTHROUGH=("$@"); break ;;
  esac
done

# --- node -------------------------------------------------------------------------

command -v node >/dev/null 2>&1 || die "node is not installed. hats needs Node 20.11 or newer — https://nodejs.org"
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
NODE_MINOR="$(node -p 'process.versions.node.split(".")[1]')"
if [ "$NODE_MAJOR" -lt 20 ] || { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -lt 11 ]; }; then
  die "node $(node -v) is too old. hats needs 20.11 or newer."
fi

# --- install and build, only when something actually changed ------------------------

if [ ! -d node_modules ]; then
  step "installing build dependencies (typescript only — zero runtime dependencies)"
  npm install --no-audit --no-fund >/dev/null || die "npm install failed"
fi

needs_build() {
  [ ! -f dist/src/cli/main.js ] && return 0
  [ -n "$(find src test -name '*.ts' -newer dist/src/cli/main.js -print -quit 2>/dev/null)" ] && return 0
  [ tsconfig.json -nt dist/src/cli/main.js ] && return 0
  return 1
}

if needs_build; then
  step "compiling"
  npm run build >/dev/null || die "build failed — run 'npm run build' to see the errors"
fi
ok "ready"

HATS=(node "$ROOT/dist/src/cli/main.js")

# --- local model server, if that is what is configured ------------------------------

CONFIG="${HATS_HOME:-$HOME/.hats}/config.json"
ollama_up() { curl -fsS -m 3 http://127.0.0.1:11434/api/tags >/dev/null 2>&1; }

if [ ! -f "$CONFIG" ] || grep -q '"ollama"' "$CONFIG" 2>/dev/null; then
  if ollama_up; then
    ok "ollama is running"
  elif command -v ollama >/dev/null 2>&1; then
    step "starting ollama"
    nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
    for _ in $(seq 1 20); do ollama_up && break; sleep 0.5; done
    ollama_up && ok "ollama started" || warn "could not reach ollama on :11434 — see /tmp/ollama-serve.log"
  else
    warn "no local model server found. You can connect a hosted provider in the control panel."
  fi
  if ollama_up && ! curl -fsS -m 3 http://127.0.0.1:11434/api/tags | grep -q '"name"'; then
    warn "ollama has no models yet — pull one, e.g.:  ollama pull qwen2.5:7b"
  fi
fi

# --- go -----------------------------------------------------------------------------

if [ "$MODE" = "passthrough" ]; then
  exec "${HATS[@]}" "${PASSTHROUGH[@]}"
fi

if [ "$MODE" = "cli" ]; then
  exec "${HATS[@]}"
fi

# The control panel is the default surface. Setup happens there, not here.
PORT="${HATS_UI_PORT:-4173}"
step "starting the control panel"

# Capture the tokenised URL the CLI prints, open it, then hand the terminal back to the
# server so Ctrl-C stops it.
FIFO="$(mktemp -u)"; mkfifo "$FIFO"
"${HATS[@]}" ui --port "$PORT" > "$FIFO" 2>&1 &
UI_PID=$!
trap 'kill $UI_PID 2>/dev/null || true; rm -f "$FIFO"' EXIT INT TERM

URL=""
while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    *http://127.0.0.1:*) URL="$(printf '%s' "$line" | tr -d ' ')" ;;
  esac
  [ -n "$URL" ] && break
done < "$FIFO"

if [ -n "$URL" ] && [ -z "${NO_OPEN:-}" ]; then
  if command -v open >/dev/null 2>&1; then open "$URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL" >/dev/null 2>&1 || true
  fi
fi

printf '\n%sEverything happens in that page.%s Pick a provider and a model there — nothing else to run.\n' "$BOLD" "$OFF"
printf '%sCtrl-C to stop.%s\n\n' "$DIM" "$OFF"

cat "$FIFO" &
wait $UI_PID
