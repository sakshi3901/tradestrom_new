package handlers

import "github.com/gin-gonic/gin"

func (h *APIHandler) GetMovers915(c *gin.Context) {
	if h.Movers915 == nil {
		c.JSON(500, gin.H{"error": "movers service not available"})
		return
	}
	h.Movers915.Get(c)
}

func (h *APIHandler) GetMoversSnapshot(c *gin.Context) {
	if h.Movers915 == nil {
		c.JSON(500, gin.H{"error": "movers service not available"})
		return
	}
	h.Movers915.GetSnapshot(c)
}
