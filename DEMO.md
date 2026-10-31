# Demo day guide

Cluster setup and deployment are in [README.md](README.md). This file is the checklist for the on-site demo.

What the instructor checks:

1. Automatic deployment of the app, using only what is in this repo.
2. Successful client requests, each served by 2 or more containers.
3. Fault tolerance: a random Pi is pulled offline and requests work again once replacements are running.

## The three demo steps

Use the master's IP as the entry point. Run the commands in Git Bash or any Linux shell, from the repo root.

**1. Automatic deployment**

```bash
kubectl delete -k k8s
./deploy.sh
kubectl get nodes
kubectl get pods -o wide
```

**2. Requests through 2+ containers**

Terminal 1:

```bash
kubectl logs -f -l 'app in (auth-service,signing-service,qr-service)' --prefix --max-log-requests 10 --tail=0
```

Terminal 2:

```bash
BASE_URL=http://<master-ip> ./test.sh
```

One `/api/sign` request appears in `signing-service`, then `auth-service`, then `qr-service`. Also log in at `http://<master-ip>/login`, create a ticket on `/admin`, and upload the QR on `/`.

**3. Fault tolerance**

Terminal 1:

```bash
kubectl get pods -o wide -w
```

Terminal 2:

```bash
while true; do BASE_URL=http://<master-ip> ./test.sh >/dev/null 2>&1 && echo "$(date +%T) OK" || echo "$(date +%T) FAIL"; sleep 1; done
```

Pull the Pi the instructor picks (power or Ethernet cable). Expect `NotReady` after about 20 seconds, new pods on other nodes, and `OK` again shortly after. Plug it back in and wait for `Ready` before the next one.

## Checklist before your slot

- Cluster up before your slot: `kubectl get nodes` shows all Pis `Ready`.
- Pre-pull test: `./deploy.sh` has worked at least once from a clean state (`kubectl delete -k k8s` then `./deploy.sh`).
- Terminals ready: pods watch, request loop with `BASE_URL=http://<master-ip>`, logs stream.
- For the failure test, the instructor picks a Pi. Pull its power or Ethernet cable. Pods reschedule onto the others and requests succeed after about 20 seconds. Plug it back in afterwards and wait for `Ready`.
- Do not pull the master.

## No internet at the demo

Do the k3s install and image pulls at home, then import images into each Pi's runtime:

```bash
docker save <registry>/auth-service:latest | ssh <pi> sudo k3s ctr images import -
```

Repeat for each image and Pi (the `agent` install provides `k3s ctr`). This only works if the manifests use `imagePullPolicy: IfNotPresent`, which they already do.

## Return equipment

After the demo, sign in and return everything. Reflash every Pi with default Raspberry Pi OS and factory-reset the router (hold the reset button for about 10 seconds).

## Known gaps

- The arm64 builds and the real-Pi steps are untested. Test on at least one Pi before the demo day.
- The Pi 3 B+ has 1 GB of RAM. The web pod is limited to 256 MB, so watch for `OOMKilled` in `kubectl get pods`.
