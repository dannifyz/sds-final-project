#!/bin/sh
set -e
cd "$(dirname "$0")"
k3d cluster create sds --servers 1 --agents 4 -p "8080:80@loadbalancer" \
  --k3s-arg "--kube-controller-manager-arg=node-monitor-grace-period=20s@server:0" \
  --k3s-arg "--kubelet-arg=node-status-update-frequency=5s@all" --wait
for name in auth-service signing-service qr-service; do
  docker build -q -f apps/$name/Dockerfile -t sds/$name:latest .
done
docker build -q -t sds/web:latest apps/web
k3d image import -c sds sds/auth-service:latest sds/signing-service:latest sds/qr-service:latest sds/web:latest
./deploy.sh
