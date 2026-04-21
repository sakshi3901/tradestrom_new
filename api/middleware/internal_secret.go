package middleware

import (
	"crypto/subtle"
	"net/http"

	"github.com/gin-gonic/gin"
)

func InternalSecret(expectedSecret string) gin.HandlerFunc {
	return func(c *gin.Context) {
		providedSecret := c.GetHeader("X-Internal-Secret")
		if providedSecret == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing X-Internal-Secret header"})
			return
		}

		if subtle.ConstantTimeCompare([]byte(providedSecret), []byte(expectedSecret)) != 1 {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "invalid internal secret"})
			return
		}

		c.Next()
	}
}
