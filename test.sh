#!/bin/sh
set -e
cd "$(dirname "$0")"
. ./.env
base=${BASE_URL:-http://localhost:8080}
jar=$(mktemp)

curl -sf --max-time 5 -c "$jar" -H 'Content-Type: application/json' \
  -d "{\"username\":\"$AUTH_USERNAME\",\"password\":\"$AUTH_PASSWORD\"}" "$base/api/auth/login" >/dev/null
echo "login ok"

reply=$(curl -sf --max-time 5 -b "$jar" -H 'Content-Type: application/json' \
  -d '{"event":"Demo","attendeeName":"Somchai","seat":"A1"}' "$base/api/sign")
token=$(echo "$reply" | sed 's/.*"token":"\([^"]*\)".*/\1/')
echo "sign ok"

curl -sf --max-time 5 "$base/api/verify?token=$token" | grep -q '"valid":true'
echo "verify ok"

echo "pods and nodes:"
kubectl get pods -o wide --no-headers | awk '{print $1, $3, $7}'
