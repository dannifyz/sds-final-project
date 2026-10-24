// qr-service: turns a string (the signed ticket JWT) into a PNG QR code.
// Internal only; nginx does not expose it.
package main

import (
	"log"
	"net/http"
	"os"
	"strconv"

	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"
)

type qrRequest struct {
	Token string `json:"token" binding:"required"`
}

func main() {
	size, err := strconv.Atoi(getenv("QR_SIZE", "512"))
	if err != nil || size <= 0 {
		log.Fatalf("invalid QR_SIZE")
	}

	r := gin.Default()
	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.POST("/qr", func(c *gin.Context) {
		var req qrRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "token is required"})
			return
		}

		// Medium recovery keeps the code scannable from photos without making
		// long JWTs too dense.
		png, err := qrcode.Encode(req.Token, qrcode.Medium, size)
		if err != nil {
			c.JSON(http.StatusUnprocessableEntity, gin.H{"error": "could not encode QR: " + err.Error()})
			return
		}
		c.Data(http.StatusOK, "image/png", png)
	})

	addr := ":" + getenv("PORT", "8083")
	log.Printf("qr-service listening on %s", addr)
	log.Fatal(r.Run(addr))
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
