# Build from the repo root (shared go.mod): docker build -f apps/signing-service/Dockerfile .
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY apps/signing-service ./apps/signing-service
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/signing-service ./apps/signing-service

FROM gcr.io/distroless/static-debian12:nonroot
ENV GIN_MODE=release PORT=8082
COPY --from=build /out/signing-service /signing-service
EXPOSE 8082
ENTRYPOINT ["/signing-service"]
