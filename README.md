# Event Ticket on Kubernetes

Issue signed QR tickets and verify them by uploading a photo of the QR code. The app runs as five containers on a Kubernetes (k3s) cluster of Raspberry Pis, and keeps working when any one Pi goes offline.

> **Branch `real-demo`**: only the files needed for the Raspberry Pi cluster. To rehearse on one PC without Pis (k3d scripts and a failover test), use branch `one-pc`.

Contents

1. [What the app does](#1-what-the-app-does)
2. [Architecture](#2-architecture)
3. [Build the cluster](#3-build-the-cluster)
4. [Deploy the app](#4-deploy-the-app)
5. [Check that it works](#5-check-that-it-works)
6. [Fault tolerance](#6-fault-tolerance)
7. [Development with Docker Compose](#7-development-with-docker-compose)
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

Each service runs 1 replica by default (5 services on 5 Pis, the **5x1** mode), or 2 with `REPLICAS=2 ./deploy.sh` (**5x2**). The master runs no app pods. Traefik (built into k3s) receives requests on port 80 of every node and forwards them to `nginx`.

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
| Containers on different nodes       | `topologySpreadConstraints` keeps replicas of one service on different Pis and spreads all pods evenly |
| Survives losing any one Pi          | Pods of a dead Pi are evicted 10 s after the node goes down and rescheduled on the other Pis. Readiness probes remove dead pods from the Services. Traefik has 2 replicas |

## 3. Build the cluster

The laptop is the **master** (control plane only, no app pods) and each Pi is a **worker**, on [k3s](https://k3s.io). Below, the master is `192.168.1.101` and the Pis are `192.168.1.100`, `.102`, and so on. Use your own addresses.

### Network

- TL-WR841N router, laptop, 5 Raspberry Pi 3 B+. The router has 4 LAN ports, so add a switch or put some Pis on Wi-Fi.
- Reserve a fixed IP per machine in the router's DHCP settings. Check each with `ping` and `ssh`.
- Setup needs internet on the master and every Pi (a phone hotspot on Wi-Fi works). Cluster traffic stays on the cable.

### Each Pi

1. Flash **Raspberry Pi OS Lite (64-bit)** and enable SSH.
2. Append `cgroup_memory=1 cgroup_enable=memory` to the single line in `/boot/firmware/cmdline.txt`.
3. Point flannel (the pod network) at the cable, then reboot:

   ```sh
   sudo mkdir -p /etc/rancher/k3s
   echo 'flannel-iface: eth0' | sudo tee /etc/rancher/k3s/config.yaml
   sudo reboot
   ```

### Master

Find the Ethernet interface name with `ip -br addr`, then run:

```sh
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.37.1+k3s1 INSTALL_K3S_EXEC="server --node-ip 192.168.1.101 --advertise-address 192.168.1.101 --tls-san 192.168.1.101 --flannel-iface <ethernet-interface> --node-taint CriticalAddonsOnly=true:NoExecute --write-kubeconfig-mode 644 --kube-controller-manager-arg=node-monitor-grace-period=20s" sh -
sudo cat /var/lib/rancher/k3s/server/node-token
export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
```

- `--node-ip` and `--flannel-iface` keep pod traffic on the cable. Without them pods on different nodes cannot talk when the laptop also has Wi-Fi.
- The taint keeps app pods off the master. k3s's own add-ons tolerate it, so the master's IP still answers on port 80.
- `node-monitor-grace-period=20s` detects a dead Pi in 20 s instead of 40 s. The pinned version avoids `update.k3s.io`.

### Join the Pis

On every Pi, with the token and that Pi's own IP:

```sh
curl -sfL https://get.k3s.io | INSTALL_K3S_VERSION=v1.37.1+k3s1 K3S_URL=https://192.168.1.101:6443 K3S_TOKEN=<token> INSTALL_K3S_EXEC="agent --node-ip <this-pi-ip> --kubelet-arg=node-status-update-frequency=5s" sh -
```

If a Pi cannot reach github.com, copy `k3s-arm64` over with `scp` and use the k3s [air-gap install](https://docs.k3s.io/installation/airgap).

### Check

```sh
kubectl get nodes -o wide
```

Every Pi and the master should be `Ready`. If a Pi is missing after a minute, run `sudo journalctl -u k3s-agent -n 30` on it.

## 4. Deploy the app

You need `kubectl` pointed at the cluster, and this repo on that machine.

### 4.1 Images

The images are public at `ghcr.io/poongeta/{auth-service,signing-service,qr-service,web}` (arm64 and amd64), and `k8s/kustomization.yaml` already points at them. nginx comes from Docker Hub.

To use your own registry, build and push, then edit the `images:` block in `k8s/kustomization.yaml`:

```sh
docker login ghcr.io
docker buildx create --use
for s in auth-service signing-service qr-service; do
  docker buildx build --platform linux/arm64,linux/amd64 -f apps/$s/Dockerfile -t ghcr.io/<you>/$s:latest --push .
done
docker buildx build --platform linux/arm64,linux/amd64 -t ghcr.io/<you>/web:latest --push apps/web
```

Before the demo, cache every image on every Pi so a replacement pod can start anywhere without internet. Run it after the first `./deploy.sh`, because it reads the image list from the cluster:

```sh
./preload.sh pipatch@192.168.1.100 pipatch@192.168.1.102
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

You should see 1 pod of each service, spread over the Pis. For two replicas of each service run `REPLICAS=2 ./deploy.sh`, or switch a running cluster with `kubectl scale deploy --all --replicas=2` (back to one with `--replicas=1`).

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

In two terminals, watch the pods and send a request every second:

```sh
kubectl get pods -o wide -w
while true; do BASE_URL=http://<master-ip> ./test.sh >/dev/null 2>&1 && echo "$(date +%T) OK" || echo "$(date +%T) FAIL"; sleep 1; done
```

Pull a Pi offline (Ethernet cable or power). Expected:

1. The node shows `NotReady` after about 20 s.
2. Its pods go to `Terminating` and replacements start on the other Pis (`tolerationSeconds: 10` makes this quick instead of 5 minutes).
3. In 5x1, requests needing the lost service fail until its replacement is `Running`, about 30 to 60 s. This is allowed. In 5x2 the other replica keeps serving, and only a few `FAIL` lines appear at first. Afterwards everything is `OK` with no manual step.
4. Plug the Pi back in and wait for `Ready`. Pods do not move back.

Measured in 5x2 on a laptop plus one Pi: 3 failed requests in the first 15 s, then none. With a single worker, replacements stay `Pending` because no other Pi exists. Do not pull the master.

## 7. Development with Docker Compose

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
preload.sh            Caches every image on every Pi
test.sh               Login, sign, verify check
docker-compose.yml    Development only
DEMO.md               Demo-day checklist
```

## 10. Troubleshooting

| Symptom                                    | Likely cause and fix                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------ |
| `ImagePullBackOff`                         | Image name wrong, or the registry package is private. Check `k8s/kustomization.yaml` and the registry |
| `exec format error` in pod logs            | Image built for the wrong CPU. Rebuild with `--platform linux/arm64,linux/amd64`                       |
| Pi stays `NotReady` or k3s agent won't start | Memory cgroups missing. Check `cmdline.txt` and reboot                                              |
| Pi joins but pods on it cannot reach other pods | Flannel picked the Wi-Fi address. Set `--flannel-iface` on the master and `flannel-iface: eth0` on the Pi |
| `curl: Failed to connect to update.k3s.io` | Pin `INSTALL_K3S_VERSION` as shown in section 3                                                  |
| `ImagePullBackOff` on one Pi only          | That Pi has no cached image and no internet. Run `./preload.sh`                                 |
| Pod `OOMKilled`                            | A Pi 3 B+ has 1 GB RAM. Lower replicas of `web` or raise its limit in `k8s/app.yaml`                   |
| Requests fail for more than 30 s after pulling a Pi | Check `kubectl get nodes` and `kubectl get pods -o wide`. Replacements need a free Pi and a cached image |
| `404` or blank page                        | Wait for `./deploy.sh` to finish, then check `kubectl get ingress` and `kubectl get pods`              |
| Login works but `/api/sign` returns 401    | `SESSION_SECRET` changed after login. Sign in again                                                    |
| Commands like `./deploy.sh` fail on Windows | Use Git Bash, not Command Prompt or PowerShell                                                      |
