#!/bin/sh
# Serves the app on http://localhost:8080 (Node if present, otherwise Python).
cd "$(dirname "$0")"
if command -v node >/dev/null 2>&1; then exec node serve.mjs 8080
elif command -v python3 >/dev/null 2>&1; then echo "Voltiris GH Design: http://localhost:8080"; exec python3 -m http.server 8080 --bind 127.0.0.1
else echo "Install Node.js or Python 3, then run this again."; exit 1; fi
