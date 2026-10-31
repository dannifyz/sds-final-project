# Event Ticket on Kubernetes

Issue signed QR tickets and verify them by uploading a photo of the QR code. The app runs as five containers on a Kubernetes (k3s) cluster of Raspberry Pis, and keeps working when any one Pi goes offline.

> **Branch `one-pc`**: everything in `real-demo`, plus scripts to build a fake cluster on one PC (k3d) and test failover without Raspberry Pis. For the files needed on the real Pis only, use branch `real-demo`.

Contents

1. [What the app does](#1-what-the-app-does)
2. [Architecture](#2-architecture)
3. [Build the cluster](#3-build-the-cluster)
4. [Deploy the app](#4-deploy-the-app)
5. [Check that it works](#5-check-that-it-works)
6. [Fault tolerance](#6-fault-tolerance)
7. [Try it on one PC](#7-try-it-on-one-pc)
8. [Configuration](#8-configuration)
9. [Repo layout](#9-repo-layout)
10. [Troubleshooting](#10-troubleshooting)

## 1. What the app does

- An admin signs in and creates a ticket (event name, attendee name, seat). The app signs the ticket and returns it as a QR code.
- Anyone can upload a photo of a QR code on the home page. The app checks the signature and shows whether the ticket is valid and who it belongs to.

Tickets are signed JWTs (HS256), so nothing is stored in a database. The whole app is stateless, which is why it can lose a node and carry on.

## 2. Architecture

| Container         | Port | Role                                                                          |
| ----------------- | ---- | ----------------------------------------------------------------------------- |
| `nginx`           | 80   | Single entry point. Routes pages and APIs on one origin, so cookies stay same-origin |
| `web`             | 3000 | Next.js frontend (`/`, `/login`, `/admin`)                                    |
| `auth-service`    | 8081 | Login, logout and `/me`. One admin user from env vars, session in an HttpOnly JWT cookie |
| `signing-service` | 8082 | `POST /sign` (admin only) and `GET /verify` (public)                          |
| `qr-service`      | 8083 | `POST /qr` turns a token into a PNG. Internal only                            |

Each service runs 2 replicas. Traefik (built into k3s) receives requests on port 80 of every node and forwards them to `nginx`.

### Request flow

```
Create a ticket (admin, signed in)
  browser --POST /api/sign--> Traefik --> nginx --> signing-service
                                                      |-- GET  auth-service /me    (checks the session cookie)
                                                      |-- signs the ticket as a JWT
                                                      '-- POST qr-service /qr      returns a PNG
  <-- { token, qr, ticket }

Verify a ticket (public)
  browser reads the QR in the browser (jsQR) --GET /api/verify?token=...--> nginx --> signing-service
  <-- { valid, ticket }
```

A single `POST /api/sign` is served by **four containers on separate pods**: nginx, signing-service, auth-service and qr-service. They can sit on different Pis, so the calls cross the cluster network.

### How it meets the project requirements

| Requirement                         | How                                                                                                  |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| At least N distinct container images | 5 images: `web`, `auth-service`, `signing-service`, `qr-service`, `nginx`                            |
| A request uses 2 or more containers | `/api/sign` goes through nginx, signing, auth and qr                                                 |
| Containers on different nodes       | `topologySpreadConstraints` spreads replicas across nodes                                            |
| Survives losing any one Pi          | 2 replicas of everything, readiness probes, pods evicted 10 s after a node goes down, Traefik also has 2 replicas |

## 3. Build the cluster

Layout: your laptop (or an Ubuntu VM on it) is the **master**, and each Raspberry Pi is a **worker**. The cluster uses [k3s](https://k3s.io).

### Hardware and network

- TP-Link TL-WR841N router, laptop master, Raspberry Pi 3 B+ workers, Ethernet cables.
- Connect the master and every Pi to the router's LAN ports (wired is preferred). The router's WAN port needs internet so k3s and the images can be downloaded.
- Reserve a fixed IP for the master and for each Pi in the router's DHCP settings.
- Check each Pi with `ping <pi-ip>` and `ssh <user>@<pi-ip>`.

### Prepare each Pi

1. Flash **Raspberry Pi OS Lite (64-bit)** or **Ubuntu Server (arm64)** with Raspberry Pi Imager. Enable SSH.
2. Turn on memory cgroups. Add this to the end of the single line in `/boot/firmware/cmdline.txt` (`/boot/cmdline.txt` on older images):

   ```
   cgroup_memory=1 cgroup_enable=memory
   ```

3. Reboot with `sudo reboot`.

### Install the master

Use an Ubuntu machine with at least 2 CPU cores, on the same LAN as the Pis (a VM needs a bridged adapter on the wired interface).

```sh
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --node-ip <master-ip> --tls-san <master-ip> --kube-controller-manager-arg=node-monitor-grace-period=20s" sh -
sudo cat /var/lib/rancher/k3s/server/node-token
```

The `node-monitor-grace-period` flag makes the cluster notice a dead Pi after 20 s instead of 40 s.

### Join the Pis

Run on every Pi:

```sh
curl -sfL https://get.k3s.io | K3S_URL=https://<master-ip>:6443 K3S_TOKEN=<token> INSTALL_K3S_EXEC="agent --kubelet-arg=node-status-update-frequency=5s" sh -
```

### Check the cluster

On the master:

```sh
sudo k3s kubectl get nodes
```

Every Pi should show `Ready`. To use `kubectl` from another machine, copy `/etc/rancher/k3s/k3s.yaml` to `~/.kube/config` and replace `127.0.0.1` with `<master-ip>`.

## 4. Deploy the app

You need `kubectl` pointed at the cluster, and this repo on that machine.

### 4.1 Images

The manifests use `sds/<name>:latest`. For a real cluster the images must be in a registry the Pis can pull from. Build for both architectures, because pods can land on the Pis (arm64) or on the master (amd64):

```sh
docker login <registry>
docker buildx create --use
for s in auth-service signing-service qr-service; do
  docker buildx build --platform linux/arm64,linux/amd64 -f apps/$s/Dockerfile -t <registry>/$s:latest --push .
done
docker buildx build --platform linux/arm64,linux/amd64 -t <registry>/web:latest --push apps/web
```

The images need to be public, or you must add an `imagePullSecret`. The web build is slow under emulation, so do it ahead of time.

Then add this to `k8s/kustomization.yaml`:

```yaml
images:
  - name: sds/auth-service
    newName: <registry>/auth-service
  - name: sds/signing-service
    newName: <registry>/signing-service
  - name: sds/qr-service
    newName: <registry>/qr-service
  - name: sds/web
    newName: <registry>/web
```

### 4.2 Secrets and deploy

```sh
cp .env.example .env
```

Edit `.env` and set `AUTH_PASSWORD`, `SESSION_SECRET` and `TICKET_SECRET` (see [Configuration](#8-configuration)). Then:

```sh
./deploy.sh
```

The script creates a Kubernetes Secret from `.env`, applies `k8s/` and waits until every deployment is ready. When it finishes:

```sh
kubectl get pods -o wide
```

You should see 2 pods of each service, spread over different nodes.

## 5. Check that it works

Open `http://<master-ip>` in a browser, sign in at `/login` with `AUTH_USERNAME` and `AUTH_PASSWORD`, create a ticket on `/admin`, then upload its QR code on the home page.

Or run the scripted check:

```sh
BASE_URL=http://<master-ip> ./test.sh
```

It logs in, signs a ticket, verifies it and prints `login ok`, `sign ok`, `verify ok`, then lists each pod and the node it runs on.

To see one request pass through several containers, stream the logs while you run the test:

```sh
kubectl logs -f -l 'app in (auth-service,signing-service,qr-service)' --prefix --max-log-requests 10 --tail=0
```

One `/api/sign` request shows up in `signing-service`, then `auth-service` (`/me`), then `qr-service` (`/qr`).

Use the master's IP as the entry point. Port 80 on every node works, but a Pi you point at will go away when you pull it.

## 6. Fault tolerance

Watch the pods in one terminal:

```sh
kubectl get pods -o wide -w
```

Send a request every second in another:

```sh
while true; do BASE_URL=http://<master-ip> ./test.sh >/dev/null 2>&1 && echo "$(date +%T) OK" || echo "$(date +%T) FAIL"; sleep 1; done
```

Then pull a Pi offline (unplug its power or Ethernet cable). Expected result:

1. The node shows `NotReady` after about 20 s.
2. Its pods go to `Terminating`, and 10 s later replacements start on the remaining nodes.
3. A few `FAIL` lines may appear. Requests succeed again roughly 15 to 25 s after the Pi went down, without any manual step.
4. Plug the Pi back in. It rejoins as `Ready`.

Why it works: every service has 2 replicas on different nodes, readiness probes remove dead pods from the Services, and `tolerationSeconds: 10` makes Kubernetes reschedule pods quickly instead of the default 5 minutes. Do not pull the master.

If a node only hosts a `web` pod, you may see no failures at all, because the API check doesn't touch `web`. Requests still succeed, so that's a pass.

## 7. Try it on one PC

You can rehearse everything without Raspberry Pis, using [k3d](https://k3d.io) (k3s inside Docker). You need Docker, `kubectl` and `k3d`. On Windows, run these in Git Bash.

```sh
cp .env.example .env
./local-cluster.sh
./test.sh
./failover-test.sh
```

`local-cluster.sh` creates 1 server and 4 agents (the agents stand in for the Pis), builds the images, loads them into the cluster and deploys. The app is at `http://localhost:8080`. `failover-test.sh` stops each agent in turn and prints how long requests take to succeed again (15 to 21 s when we tested it).

Stop one node by hand with `docker stop k3d-sds-agent-N`, and bring it back with `docker start k3d-sds-agent-N`. Remove everything with `k3d cluster delete sds`.

This is only a simulation. The Raspberry Pi steps in section 3 and the arm64 images have not been tested on real hardware yet. See [DEMO.md](DEMO.md) for a step-by-step rehearsal and screen-recording guide.

### Docker Compose (development only)

```sh
cp .env.example .env
docker compose up --build
```

Open `http://localhost:8080`. This runs one copy of each container with no fault tolerance, and is only useful for development.

## 8. Configuration

Set these in `.env`. `deploy.sh` loads them into a Kubernetes Secret named `app-secrets`.

| Variable         | Used by         | Notes                                                                  |
| ---------------- | --------------- | ---------------------------------------------------------------------- |
| `AUTH_USERNAME`  | auth-service    | The only account                                                       |
| `AUTH_PASSWORD`  | auth-service    | Change it                                                              |
| `SESSION_SECRET` | auth-service    | Signs the session cookie (8 h). All replicas share it, so any replica accepts the session |
| `TICKET_SECRET`  | signing-service | Signs tickets. Changing it invalidates every existing ticket           |
| `COOKIE_SECURE`  | auth-service    | Set to `true` only when serving over HTTPS                             |
| `HTTP_PORT`      | nginx (Compose) | Host port for Docker Compose, default `8080`                           |

Use long random values for the two secrets, for example `openssl rand -hex 32`, and keep them different. `.env` is git-ignored and must never be committed.

## 9. Repo layout

```
apps/
  auth-service/       Go, login and session
  signing-service/    Go, signs and verifies tickets
  qr-service/         Go, renders QR PNGs
  web/                Next.js frontend
k8s/
  app.yaml            Deployments, Services and the Ingress
  kustomization.yaml  Image names and the nginx ConfigMap
  nginx.conf          nginx routing (same file Docker Compose uses)
  traefik.yaml        Runs the built-in Traefik with 2 replicas
deploy.sh             Creates the Secret and applies k8s/
test.sh               Login, sign, verify check
local-cluster.sh      One-PC k3d cluster plus deploy
failover-test.sh      Stops each node in turn and times recovery
docker-compose.yml    Development only
DEMO.md               Rehearsal and demo-day guide
```

## 10. Troubleshooting

| Symptom                                    | Likely cause and fix                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `ImagePullBackOff`                         | Image name wrong, or the registry package is private. Check `k8s/kustomization.yaml` and the registry |
| `exec format error` in pod logs            | Image built for the wrong CPU. Rebuild with `--platform linux/arm64,linux/amd64`                       |
| Pi stays `NotReady` or k3s agent won't start | Memory cgroups missing. Check `cmdline.txt` and reboot                                              |
| Pod `OOMKilled`                            | A Pi 3 B+ has 1 GB RAM. Lower replicas of `web` or raise its limit in `k8s/app.yaml`                   |
| Requests fail for more than 30 s after pulling a Pi | Check `kubectl get nodes` and that every service has 2 replicas on different nodes           |
| `404` or blank page                        | Wait for `./deploy.sh` to finish, then check `kubectl get ingress` and `kubectl get pods`              |
| Login works but `/api/sign` returns 401    | `SESSION_SECRET` changed after login. Sign in again                                                    |
| Commands like `./deploy.sh` fail on Windows | Use Git Bash, not Command Prompt or PowerShell                                                      |
