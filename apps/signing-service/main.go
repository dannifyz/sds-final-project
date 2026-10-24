// signing-service: signs ticket data as a JWT (POST /sign, admin only) and
// verifies tokens read back from a QR code (GET /verify, public).
package main

import (
	"bytes"
	"crypto/rand"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const issuer = "event-ticket/signing-service"

type config struct {
	ticketSecret []byte
	authURL      string
	qrURL        string
	client       *http.Client
}

type signRequest struct {
	Event        string `json:"event" binding:"required,max=200"`
	AttendeeName string `json:"attendeeName" binding:"required,max=200"`
	Seat         string `json:"seat" binding:"required,max=50"`
}

type ticketClaims struct {
	Event        string `json:"event"`
	AttendeeName string `json:"attendeeName"`
	Seat         string `json:"seat"`
	jwt.RegisteredClaims
}

func main() {
	cfg := config{
		ticketSecret: []byte(mustEnv("TICKET_SECRET")),
		authURL:      strings.TrimRight(getenv("AUTH_SERVICE_URL", "http://localhost:8081"), "/"),
		qrURL:        strings.TrimRight(getenv("QR_SERVICE_URL", "http://localhost:8083"), "/"),
		client:       &http.Client{Timeout: 5 * time.Second},
	}

	r := gin.Default()
	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.POST("/sign", cfg.requireAuth, cfg.sign)
	r.GET("/verify", cfg.verify)

	addr := ":" + getenv("PORT", "8082")
	log.Printf("signing-service listening on %s", addr)
	log.Fatal(r.Run(addr))
}

// requireAuth forwards the caller's cookies to auth-service /me and only lets
// the request through when the session is valid.
func (cfg config) requireAuth(c *gin.Context) {
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodGet, cfg.authURL+"/me", nil)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "could not build auth request"})
		return
	}
	req.Header.Set("Cookie", c.GetHeader("Cookie"))

	resp, err := cfg.client.Do(req)
	if err != nil {
		c.AbortWithStatusJSON(http.StatusBadGateway, gin.H{"error": "auth-service unavailable"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "not signed in"})
		return
	}

	var me struct {
		Username string `json:"username"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&me); err != nil {
		c.AbortWithStatusJSON(http.StatusBadGateway, gin.H{"error": "bad response from auth-service"})
		return
	}
	c.Set("username", me.Username)
	c.Next()
}

func (cfg config) sign(c *gin.Context) {
	var req signRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "event, attendeeName and seat are required"})
		return
	}

	claims := ticketClaims{
		Event:        strings.TrimSpace(req.Event),
		AttendeeName: strings.TrimSpace(req.AttendeeName),
		Seat:         strings.TrimSpace(req.Seat),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:   issuer,
			Subject:  c.GetString("username"),
			IssuedAt: jwt.NewNumericDate(time.Now()),
			ID:       randomID(),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString(cfg.ticketSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not sign ticket"})
		return
	}

	png, err := cfg.fetchQR(c, token)
	if err != nil {
		c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"token":  token,
		"qr":     "data:image/png;base64," + base64.StdEncoding.EncodeToString(png),
		"ticket": claims,
	})
}

func (cfg config) fetchQR(c *gin.Context, token string) ([]byte, error) {
	body, _ := json.Marshal(gin.H{"token": token})
	req, err := http.NewRequestWithContext(c.Request.Context(), http.MethodPost, cfg.qrURL+"/qr", bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("could not build qr request")
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := cfg.client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("qr-service unavailable")
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("qr-service returned %d", resp.StatusCode)
	}
	return io.ReadAll(resp.Body)
}

func (cfg config) verify(c *gin.Context) {
	raw := strings.TrimSpace(c.Query("token"))
	if raw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"valid": false, "error": "token query parameter is required"})
		return
	}

	claims := &ticketClaims{}
	_, err := jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) {
		return cfg.ticketSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithIssuer(issuer))
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"valid": false, "error": "ticket is not valid: signature or format check failed"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"valid": true, "ticket": claims})
}

func randomID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func mustEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		log.Fatalf("missing required env var %s", key)
	}
	return v
}

func getenv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
