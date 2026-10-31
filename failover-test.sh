#!/bin/sh
cd "$(dirname "$0")"
for node in ${NODES:-k3d-sds-agent-0 k3d-sds-agent-1 k3d-sds-agent-2 k3d-sds-agent-3}; do
  echo "== stopping $node"
  docker stop "$node" >/dev/null
  start=$(date +%s)
  fails=0
  while :; do
    if ./test.sh >/dev/null 2>&1; then
      echo "requests ok after $(( $(date +%s) - start ))s ($fails failed tries)"
      break
    fi
    fails=$((fails + 1))
    [ $(( $(date +%s) - start )) -gt 120 ] && { echo "FAILED to recover"; break; }
    sleep 1
  done
  docker start "$node" >/dev/null
  echo "== restarted $node, waiting for node ready"
  kubectl wait --for=condition=Ready "node/$node" --timeout=90s >/dev/null
  sleep 20
done
