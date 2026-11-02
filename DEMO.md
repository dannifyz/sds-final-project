# Demo guide

Setup is in [README.md](README.md) section 3. This is the demo script, in the order the rubric checks it. Run everything on the master, from the repo root, with `<master-ip>` replaced by its IP.

## Modes: 5x1 (default) and 5x2

- **5x1**: 5 services, 1 replica each, spread over the Pis. The clearest demo: pulling a Pi removes a service, and you watch it return on another Pi.
- **5x2**: 2 replicas per service on different Pis, so requests mostly keep working during a pull.

The master runs no app pods in either mode.

```bash
./deploy.sh                                # 5x1
REPLICAS=2 ./deploy.sh                     # 5x2
kubectl scale deploy --all --replicas=1    # switch a running cluster to 5x1
kubectl scale deploy --all --replicas=2    # switch a running cluster to 5x2
```

After deploying, check `kubectl get pods -o wide --sort-by=.spec.nodeName`. If two services share a Pi while another Pi is empty, run `kubectl delete pod <name>` on one of them and it moves.

## A. Before your slot

At home the day before, and again 30 minutes before.

1. Wire the master and all 5 Pis to the router (or a switch on the router, because it has only 4 LAN ports) and power on.
2. `export KUBECONFIG=/etc/rancher/k3s/k3s.yaml`, then `kubectl get nodes`. The master and all 5 Pis must be `Ready`.
3. Once, with internet, cache the images on every Pi: `./preload.sh <user>@<pi1-ip> <user>@<pi2-ip> ...`
4. Dry run steps 1 to 5 below from a clean state.
5. Open 3 terminals (all with `KUBECONFIG` exported) and a browser on `http://<master-ip>`.
6. Do not pull the master.

## B. The demo

**1. Cluster is up**

```bash
kubectl get nodes -o wide
```

The master is this laptop and the 5 Pis are workers, all `Ready`.

**2. Automatic deployment**

```bash
kubectl delete -k k8s
./deploy.sh
```

It creates the Secret from `.env`, applies `k8s/` and waits for every deployment, in under a minute, using only what is in this repo.

**3. The app and where it runs**

Admin signs in and creates a ticket, and gets a signed QR code. Anyone can upload a QR photo to check a ticket. There are 5 containers: `nginx`, `web`, `auth-service`, `signing-service`, `qr-service`.

```bash
kubectl get pods -o wide --sort-by=.spec.nodeName
```

**4. Requests through 2 or more containers**

Terminal 2:

```bash
kubectl logs -f -l 'app in (auth-service,signing-service,qr-service)' --prefix --max-log-requests 10 --tail=0
```

Terminal 1:

```bash
BASE_URL=http://<master-ip> ./test.sh
```

It prints `login ok`, `sign ok`, `verify ok`. One `/api/sign` shows up in `signing-service`, then `auth-service` (`/me`), then `qr-service` (`/qr`), plus nginx in front. Then repeat in the browser: sign in at `/login`, create a ticket on `/admin`, upload the QR on `/`. Stop the logs with Ctrl+C.

**5. Fault tolerance**

Terminal 2: `kubectl get pods -o wide -w`

Terminal 3, wait for steady `OK`:

```bash
while true; do BASE_URL=http://<master-ip> ./test.sh >/dev/null 2>&1 && echo "$(date +%T) OK" || echo "$(date +%T) FAIL"; sleep 1; done
```

1. The instructor picks a Pi. Note what runs on it: `kubectl get pods -A -o wide --field-selector spec.nodeName=<node-name>`
2. Pull that Pi (Ethernet cable or power).
3. After about 20 s the node is `NotReady`, its pods go `Terminating` and replacements appear on other Pis. In 5x1, `FAIL` lines for 30 to 60 s are expected while the lost service has no running replica. The app may fail until replacements are running.
4. Show the replacements: `kubectl get pods -o wide --sort-by=.spec.nodeName`. All pods are `Running` again (1 per service in 5x1, 2 in 5x2), none on the dead Pi.
5. Terminal 3 is back to `OK`. Repeat `./test.sh` and the browser flow.
6. Plug the Pi back in and wait for `Ready` before the next pick. Pods do not move back.

## C. After the demo

Sign in and return the router, Pis, power and Ethernet adapters. Flash every Pi with default Raspberry Pi OS and factory-reset the router (hold reset about 10 seconds).

## If something goes wrong

| Problem | Fix |
| --- | --- |
| A Pi is `NotReady` at the start | Check its cable and power and wait a minute. `sudo systemctl restart k3s-agent` on the Pi if it stays down |
| `./deploy.sh` waits on one deployment | `kubectl describe pod <name>`. `ImagePullBackOff` means no cached image and no internet: run `./preload.sh` |
| Two services share a Pi, another is empty | `kubectl delete pod <name>` on one of them |
| Requests fail for over 90 s after a pull | Look for replacements that are `Pending` or `ImagePullBackOff` (in 5x2 a service needs 2 different Pis) |
| Pods on different Pis cannot reach each other | Wrong flannel interface. See Troubleshooting in README.md |
