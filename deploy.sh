#!/bin/sh
set -e
cd "$(dirname "$0")"
kubectl create secret generic app-secrets --from-env-file=.env --dry-run=client -o yaml | kubectl apply -f -
kubectl apply -k k8s
for name in auth-service signing-service qr-service web nginx; do
  kubectl rollout status deployment/$name --timeout=180s
done
