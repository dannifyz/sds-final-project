# Build from the repo root (shared go.mod): docker build -f apps/auth-service/Dockerfile .
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/auth-service ./apps/auth-service
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/auth-service ./apps/auth-service

FROM gcr.io/distroless/static-debian12:nonroot
ENV GIN_MODE=release PORT=8081
COPY --from=build /out/auth-service /auth-service
EXPOSE 8081
ENTRYPOINT ["/auth-service"]
