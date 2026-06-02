#!/bin/bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
NODE22_BIN="/opt/homebrew/opt/node@22/bin"
AI_BASE_URL="${EXPO_PUBLIC_AI_BASE_URL:-http://193.233.250.130:8000}"
PORT="${EXPO_PORT:-8081}"
NGROK_BIN="${NGROK_BIN:-/opt/homebrew/bin/ngrok}"
EXPO_LOG="/tmp/ai-stylist-expo.log"
NGROK_LOG="/tmp/ai-stylist-ngrok.log"

cd "$ROOT"

if [ -d "$NODE22_BIN" ]; then
  export PATH="$NODE22_BIN:$PATH"
fi

if [ ! -x "$NGROK_BIN" ]; then
  NGROK_BIN="$(command -v ngrok || true)"
fi

if [ -z "$NGROK_BIN" ] || [ ! -x "$NGROK_BIN" ]; then
  echo "ngrok is not installed. Install it first: brew install ngrok/ngrok/ngrok"
  exit 1
fi

if [ ! -x "$ROOT/node_modules/.bin/qrcode-terminal" ]; then
  echo "node_modules is missing qrcode-terminal. Run npm install first."
  exit 1
fi

pkill -f "expo start.*--port $PORT" || true
pkill -f "ngrok http.*$PORT" || true
pkill -f "@expo/ngrok.*http $PORT" || true

rm -f "$EXPO_LOG" "$NGROK_LOG"

"$NGROK_BIN" http "$PORT" --log=stdout > "$NGROK_LOG" 2>&1 &
NGROK_PID=$!

cleanup() {
  kill "$NGROK_PID" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "Starting ngrok for local port $PORT..."

URL=""
NGROK_API_URL=""
for _ in $(seq 1 40); do
  for api_port in $(seq 4040 4049); do
    candidate_api_url="http://127.0.0.1:$api_port/api/tunnels"
    URL="$(curl -fsS "$candidate_api_url" 2>/dev/null | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{try{const j=JSON.parse(s);const t=j.tunnels.find(x=>x.proto==="https");if(t) process.stdout.write(t.public_url);}catch{}});' || true)"
    if [ -n "$URL" ]; then
      NGROK_API_URL="$candidate_api_url"
      break
    fi
  done
  if [ -n "$URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$URL" ]; then
  echo "Could not start ngrok tunnel. Last ngrok log:"
  tail -80 "$NGROK_LOG" || true
  if grep -qE "lookup .*\\[::1\\]:53|resolved .* has no records" "$NGROK_LOG"; then
    echo
    echo "Looks like local DNS/proxy is broken. Try:"
    echo "  1. Turn off VPN/proxy apps like Happ/Hiddify/Karing for a minute."
    echo "  2. Run: sudo dscacheutil -flushcache; sudo killall -HUP mDNSResponder"
    echo "  3. Run npm run share:ios again."
  fi
  exit 1
fi

EXPO_URL="exp://${URL#https://}"

EXPO_PUBLIC_AI_BASE_URL="$AI_BASE_URL" \
EXPO_PACKAGER_PROXY_URL="$URL" \
npx expo start -c --lan --go --port "$PORT" > "$EXPO_LOG" 2>&1 &
EXPO_PID=$!

trap 'kill "$EXPO_PID" "$NGROK_PID" >/dev/null 2>&1 || true' EXIT

echo "Starting Expo Metro..."

for _ in $(seq 1 60); do
  if curl -fsS -H "expo-platform: ios" "$URL" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "$EXPO_PID" >/dev/null 2>&1; then
    echo "Expo stopped unexpectedly. Last Expo log:"
    tail -120 "$EXPO_LOG" || true
    exit 1
  fi
  sleep 1
done

echo
echo "Open this on iPhone with Expo Go:"
echo "$EXPO_URL"
echo
"$ROOT/node_modules/.bin/qrcode-terminal" "$EXPO_URL"
echo
echo "AI backend: $AI_BASE_URL"
echo "ngrok binary: $NGROK_BIN"
echo "ngrok API: $NGROK_API_URL"
echo "Expo log: $EXPO_LOG"
echo "ngrok log: $NGROK_LOG"
echo
echo "Keep this terminal open while you and the client test the app."

tail -f "$EXPO_LOG" &
TAIL_PID=$!
wait "$EXPO_PID"
kill "$TAIL_PID" >/dev/null 2>&1 || true
