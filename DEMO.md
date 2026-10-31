# Demo guide

Three parts: rehearse on one PC, record evidence, then set up and run the real demo on the Raspberry Pis.

What the instructor checks on Nov 17:

1. Automatic deployment of the app, using only what is in this repo.
2. Successful client requests, each served by 2 or more containers.
3. Fault tolerance: a random Pi is pulled offline and requests work again once replacements are running.

## 1. Rehearse on one PC (k3d)

Needs Docker Desktop (running), kubectl and k3d. Use Git Bash on Windows. Run everything from the repo root.

```bash
cp .env.example .env
```

Edit `.env` and set `AUTH_PASSWORD`, `SESSION_SECRET` and `TICKET_SECRET`.

```bash
./local-cluster.sh
```

This creates 1 server plus 4 agents (the agents stand in for the Pis), builds the four images, loads them and deploys.

```bash
kubectl get nodes
kubectl get pods -o wide
./test.sh
```

`test.sh` logs in, signs a ticket, verifies it and prints which node each pod is on. Open http://localhost:8080 for the web UI.

Tear down with:

```bash
k3d cluster delete sds
```

## 2. Record evidence

Record the screen with Win+Alt+R (Xbox Game Bar) or OBS. Do not show `.env`.

### A. Automatic deployment

```bash
k3d cluster delete sds
./local-cluster.sh
kubectl get nodes
kubectl get pods -o wide
```

### B. Requests served by 2+ containers

Terminal 1, streams logs from every pod with the pod name on each line:

```bash
kubectl logs -f -l 'app in (auth-service,signing-service,qr-service)' --prefix --max-log-requests 10 --tail=0
```

Terminal 2:

```bash
./test.sh
```

One `/sign` request shows up in `signing-service`, then `auth-service` (`/me`), then `qr-service` (`/qr`). Also show the browser flow: log in at `/login`, create a ticket at `/admin`, upload the QR image at `/`.

### C. Fault tolerance

Terminal 1:

```bash
kubectl get pods -o wide -w
```

Terminal 2, a request every second:

```bash
while true; do ./test.sh >/dev/null 2>&1 && echo "$(date +%T) OK" || echo "$(date +%T) FAIL"; sleep 1; done
```

Terminal 3, pull a random "Pi":

```bash
docker stop k3d-sds-agent-$((RANDOM % 4))
```

Expect a few `FAIL` lines, then `OK` again within about 20 seconds. Bring it back with `docker start <name>`. To loop over every agent and print timings:

```bash
./failover-test.sh
```

Tested result on one PC: every agent recovered in 15 to 21 seconds.

## 3. Real demo setup

### Hardware

- 1 TP-Link TL-WR841N router
- 5 Raspberry Pi 3 B+ with power, SD card and Ethernet cable
- Laptops as masters (one is enough). Use wired Ethernet, not Wi-Fi.

### Network

1. Plug the router's WAN port into an uplink with internet. You need it to install k3s and pull images. Confirm with the instructor whether the demo room has internet; if not, see "No internet at the demo" below.
2. Connect every Pi and the master laptop to the router's LAN ports.
3. In the router's DHCP settings, reserve a fixed IP for each Pi and the master, so addresses never change.
4. Check each Pi: `ping <pi-ip>` and `ssh <user>@<pi-ip>`.

### Flash and prepare each Pi

1. Flash Raspberry Pi OS Lite (64-bit) or Ubuntu Server (arm64) with Raspberry Pi Imager. Enable SSH and set a hostname such as `pi1` to `pi5`.
2. Enable memory cgroups. Edit `/boot/firmware/cmdline.txt` (older images: `/boot/cmdline.txt`) and append, on the same single line:

   ```
   cgroup_memory=1 cgroup_enable=memory
   ```

3. `sudo reboot`.
4. Pi OS only: `sudo apt update && sudo apt install -y iptables`.

### Master (Ubuntu VM or laptop)

Use an Ubuntu VM with at least 2 cores and a **bridged** network adapter on the wired interface, so it has an IP on the router's LAN.

```bash
curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="server --node-ip <master-ip> --tls-san <master-ip> --kube-controller-manager-arg=node-monitor-grace-period=20s" sh -
sudo cat /var/lib/rancher/k3s/server/node-token
```

The `node-monitor-grace-period` flag makes the cluster notice a dead Pi in 20 seconds instead of 40.

### Join each Pi

```bash
curl -sfL https://get.k3s.io | K3S_URL=https://<master-ip>:6443 K3S_TOKEN=<token> INSTALL_K3S_EXEC="agent --kubelet-arg=node-status-update-frequency=5s" sh -
```

On the master, check:

```bash
sudo k3s kubectl get nodes
```

Every Pi should show `Ready`. To use kubectl from your own machine, copy `/etc/rancher/k3s/k3s.yaml` to `~/.kube/config` and replace `127.0.0.1` with `<master-ip>`.

### Build and publish images

The master is amd64 and the Pis are arm64, and pods may land on either, so build multi-arch images. Log in to your registry first (for example `docker login ghcr.io`). Make the packages public, or create an `imagePullSecret` if they are private.

```bash
docker buildx create --use
for s in auth-service signing-service qr-service; do
  docker buildx build --platform linux/arm64,linux/amd64 -f apps/$s/Dockerfile -t <registry>/$s:latest --push .
done
docker buildx build --platform linux/arm64,linux/amd64 -t <registry>/web:latest --push apps/web
```

The web build is slow under emulation. Do it well before demo day.

Then point the manifests at your registry by adding this to `k8s/kustomization.yaml`:

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

Commit this change, since the demo must deploy from the repo.

### Deploy

```bash
cp .env.example .env
./deploy.sh
kubectl get pods -o wide
BASE_URL=http://<master-ip> ./test.sh
```

Use the master's IP as the client entry point. It is never pulled in the demo, and port 80 on every node forwards to the app. If you point a browser at a Pi's IP, it will fail when that Pi goes offline.

### Demo day checklist

- Cluster up before your slot: `kubectl get nodes` shows all Pis `Ready`.
- Pre-pull test: `./deploy.sh` has worked at least once from a clean state (`kubectl delete -k k8s` then `./deploy.sh`).
- Terminals ready: pods watch, request loop with `BASE_URL=http://<master-ip>`, logs stream.
- For the failure test, the instructor picks a Pi. Pull its power or Ethernet cable. Pods reschedule onto the others and requests succeed after about 20 seconds. Plug it back in afterwards and wait for `Ready`.
- Do not pull the master.

### No internet at the demo

Do the k3s install and image pulls at home, then import images into each Pi's runtime:

```bash
docker save <registry>/auth-service:latest | ssh <pi> sudo k3s ctr images import -
```

Repeat for each image and Pi (the `agent` install provides `k3s ctr`). This only works if the manifests use `imagePullPolicy: IfNotPresent`, which they already do.

### Return equipment

After the demo, sign in and return everything. Reflash every Pi with default Raspberry Pi OS and factory-reset the router (hold the reset button for about 10 seconds).

## Known gaps

- The arm64 builds and the real-Pi steps are untested. Test on at least one Pi before the demo day.
- The Pi 3 B+ has 1 GB of RAM. The web pod is limited to 256 MB, so watch for `OOMKilled` in `kubectl get pods`.
