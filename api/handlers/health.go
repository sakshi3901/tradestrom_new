package handlers

import (
	"net/http"

	"github.com/gin-gonic/gin"
)

func (h *APIHandler) Health(c *gin.Context) {
	c.JSON(http.StatusOK, gin.H{
		"status": "ok",
	})
}
