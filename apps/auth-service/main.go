// auth-service: single-user login backed by env vars, session kept in an
// HttpOnly cookie holding a short-lived HS256 JWT (no database).
package main

import (
	"crypto/subtle"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"
)

const (
	cookieName = "session"
	sessionTTL = 8 * time.Hour
)

type config struct {
	username      string
	password      string
	sessionSecret []byte
	secureCookie  bool
}

type loginRequest struct {
	Username string `json:"username" binding:"required"`
	Password string `json:"password" binding:"required"`
}

func main() {
	cfg := config{
		username:      mustEnv("AUTH_USERNAME"),
		password:      mustEnv("AUTH_PASSWORD"),
		sessionSecret: []byte(mustEnv("SESSION_SECRET")),
		secureCookie:  os.Getenv("COOKIE_SECURE") == "true",
	}

	r := gin.Default()
	r.GET("/health", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.POST("/login", cfg.login)
	r.POST("/logout", cfg.logout)
	r.GET("/me", cfg.me)

	addr := ":" + getenv("PORT", "8081")
	log.Printf("auth-service listening on %s", addr)
	log.Fatal(r.Run(addr))
}

func (cfg config) login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "username and password are required"})
		return
	}

	userOK := subtle.ConstantTimeCompare([]byte(req.Username), []byte(cfg.username)) == 1
	passOK := subtle.ConstantTimeCompare([]byte(req.Password), []byte(cfg.password)) == 1
	if !userOK || !passOK {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "invalid username or password"})
		return
	}

	now := time.Now()
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   cfg.username,
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(sessionTTL)),
	}).SignedString(cfg.sessionSecret)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "could not create session"})
		return
	}

	cfg.setCookie(c, token, int(sessionTTL.Seconds()))
	c.JSON(http.StatusOK, gin.H{"username": cfg.username})
}

func (cfg config) logout(c *gin.Context) {
	cfg.setCookie(c, "", -1)
	c.Status(http.StatusNoContent)
}

func (cfg config) me(c *gin.Context) {
	raw, err := c.Cookie(cookieName)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "not signed in"})
		return
	}

	claims := &jwt.RegisteredClaims{}
	_, err = jwt.ParseWithClaims(raw, claims, func(*jwt.Token) (any, error) {
		return cfg.sessionSecret, nil
	}, jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}), jwt.WithExpirationRequired())
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "session invalid or expired"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"username": claims.Subject})
}

func (cfg config) setCookie(c *gin.Context, value string, maxAge int) {
	c.SetSameSite(http.SameSiteLaxMode)
	c.SetCookie(cookieName, value, maxAge, "/", "", cfg.secureCookie, true)
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
