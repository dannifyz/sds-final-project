#!/bin/sh
set -e
images=$(kubectl get pods -A -o jsonpath='{.items[*].spec.containers[*].image}' | tr ' ' '\n' | sort -u)
for host in "$@"; do
  for image in $images; do
    ssh -t "$host" sudo k3s crictl pull "$image"
  done
done
