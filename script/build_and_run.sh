#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
case "$MODE" in
  run|--debug|--logs|--telemetry|--verify) ;;
  *) echo "Usage: $0 [--debug|--logs|--telemetry|--verify]" >&2; exit 2 ;;
esac

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Upwork Enhancer"
cd "$ROOT_DIR"

pkill -x "$APP_NAME" >/dev/null 2>&1 || true
npm run safari:build
APP_BUNDLE="$(cat "$ROOT_DIR/build/safari/app-path.txt")"

if [ "$MODE" = "--debug" ]; then
  exec lldb -- "$APP_BUNDLE/Contents/MacOS/$APP_NAME"
fi

/usr/bin/open -n "$APP_BUNDLE"
case "$MODE" in
  --logs)
    exec /usr/bin/log stream --info --style compact --predicate 'process == "Upwork Enhancer"'
    ;;
  --telemetry)
    exec /usr/bin/log stream --info --style compact --predicate 'subsystem BEGINSWITH "io.github.dreaifekks.UpworkEnhancer"'
    ;;
  --verify)
    for attempt in {1..10}; do
      if pgrep -x "$APP_NAME" >/dev/null; then
        echo "Safari containing app is running. Enable and test the extension separately in Safari."
        exit 0
      fi
      sleep 0.5
    done
    echo "The containing app did not remain running." >&2
    exit 1
    ;;
esac
