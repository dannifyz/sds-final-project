# Build from the repo root (shared go.mod): docker build -f apps/qr-service/Dockerfile .
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/qr-service ./apps/qr-service
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/qr-service ./apps/qr-service

FROM gcr.io/distroless/static-debian12:nonroot
ENV GIN_MODE=release PORT=8083
COPY --from=build /out/qr-service /qr-service
EXPOSE 8083
ENTRYPOINT ["/qr-service"]
