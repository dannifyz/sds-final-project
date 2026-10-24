# Event Ticket

Issue signed QR tickets and verify them by uploading a photo of the QR code.

## Services

| Service           | Port | Exposed via nginx                   | Purpose                                                       |
| ----------------- | ---- | ----------------------------------- | ------------------------------------------------------------- |
| `nginx`           | 80   | `localhost:8080`                    | Single entry point; routes pages and APIs on one origin        |
| `web`             | 3000 | `/`, `/admin`, `/login`             | Next.js frontend                                               |
| `auth-service`    | 8081 | `/api/auth/{login,logout,me}`       | Single user from env vars; session in an HttpOnly JWT cookie   |
| `signing-service` | 8082 | `/api/sign`, `/api/verify`          | Signs ticket data as a JWT, verifies tokens from scanned QRs   |
| `qr-service`      | 8083 | — (internal only)                   | `POST /qr` turns a JWT into a PNG (go-qrcode)                  |

### Flow

```
Create (/admin, signed in)
  browser ──POST /api/sign──▶ nginx ──▶ signing-service
                                         ├─ GET  auth-service /me   (forwards session cookie; 401 → reject)
                                         ├─ sign {event, attendeeName, seat} as HS256 JWT
                                         └─ POST qr-service /qr     → PNG
  ◀── { token, qr: data:image/png;base64,…, ticket }

Scan (/, public)
  browser: upload image → jsQR decodes → JWT string
  browser ──GET /api/verify?token=…──▶ nginx ──▶ signing-service → { valid, ticket }
```

`/admin` is guarded twice: `src/proxy.ts` redirects to `/login` when there is no
session cookie, and the page calls `/api/auth/me` on load. The real check is the
`/me` call signing-service makes on every `/sign`.

## Run

```sh
cp .env.example .env   # then set AUTH_PASSWORD, SESSION_SECRET, TICKET_SECRET
docker compose up --build
```

Open http://localhost:8080. Sign in at `/login` with `AUTH_USERNAME` / `AUTH_PASSWORD`.

### Environment

| Variable         | Used by         | Notes                                                |
| ---------------- | --------------- | ---------------------------------------------------- |
| `AUTH_USERNAME`  | auth-service    | The only account                                     |
| `AUTH_PASSWORD`  | auth-service    |                                                      |
| `SESSION_SECRET` | auth-service    | Signs the session cookie (8 h)                       |
| `TICKET_SECRET`  | signing-service | Signs tickets. Changing it invalidates every ticket |
| `COOKIE_SECURE`  | auth-service    | `true` when served over HTTPS                        |
| `HTTP_PORT`      | nginx           | Host port, default `8080`                            |

### Running a Go service without Docker

```sh
AUTH_USERNAME=admin AUTH_PASSWORD=pw SESSION_SECRET=dev go run ./apps/auth-service
TICKET_SECRET=dev go run ./apps/signing-service   # AUTH_SERVICE_URL / QR_SERVICE_URL default to localhost
go run ./apps/qr-service
```

The frontend calls `/api/...` on its own origin, so it needs nginx (or another
proxy with the same routes) in front of it.
