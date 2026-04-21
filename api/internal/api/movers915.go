package api

import (
	"database/sql"
	"log"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
	"tradestrom-api/internal/movers"
)

func parseBoolQuery(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

type Movers915Handler struct {
	service *movers.Service
}

func NewMovers915Handler(db *sql.DB) *Movers915Handler {
	return &Movers915Handler{
		service: movers.NewService(db),
	}
}

func (h *Movers915Handler) Reset() {
	if h == nil || h.service == nil {
		return
	}
	h.service.Reset()
}

func (h *Movers915Handler) Get(c *gin.Context) {
	if h == nil || h.service == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "movers service not initialized"})
		return
	}

	result, err := h.service.GetTopMovers915(c.Request.Context())
	if err != nil {
		statusCode := http.StatusBadGateway
		message := strings.ToLower(err.Error())
		if strings.Contains(message, "missing") || strings.Contains(message, "invalid") || strings.Contains(message, "not found") {
			statusCode = http.StatusBadRequest
		}
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *Movers915Handler) GetSnapshot(c *gin.Context) {
	if h == nil || h.service == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "movers service not initialized"})
		return
	}

	indexKey := strings.TrimSpace(c.Query("index"))
	if indexKey == "" {
		indexKey = "NIFTY50"
	}
	log.Printf("[/v1/movers/snapshot] request path=%s index=%s ts=%s interval=%s limit=%s db_only=%s", c.Request.URL.Path, indexKey, c.Query("ts"), c.Query("interval"), c.Query("limit"), c.Query("db_only"))

	tsRaw := strings.TrimSpace(c.Query("ts"))
	if tsRaw == "" {
		tsRaw = strings.TrimSpace(c.Query("timestamp"))
	}
	if tsRaw == "" {
		tsRaw = strings.TrimSpace(c.Query("at"))
	}
	if tsRaw == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "ts query param is required"})
		return
	}

	tsValue, err := strconv.ParseInt(tsRaw, 10, 64)
	if err != nil || tsValue <= 0 {
		log.Printf("[/v1/movers/snapshot] bad_request invalid ts=%q", tsRaw)
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid ts query param"})
		return
	}

	limit := 50
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		if parsedLimit, parseErr := strconv.Atoi(rawLimit); parseErr == nil && parsedLimit > 0 {
			limit = parsedLimit
		}
	}

	dbOnly := parseBoolQuery(c.Query("db_only"))

	var result movers.SnapshotResponse
	if dbOnly {
		result, err = h.service.GetTopMoversSnapshotDBOnly(c.Request.Context(), indexKey, tsValue, limit)
	} else {
		result, err = h.service.GetTopMoversSnapshot(c.Request.Context(), indexKey, tsValue, limit)
	}
	if err != nil {
		statusCode := http.StatusInternalServerError
		message := strings.ToLower(err.Error())
		if strings.Contains(message, "not found") || strings.Contains(message, "unsupported") {
			statusCode = http.StatusNotFound
		} else if strings.Contains(message, "missing") ||
			strings.Contains(message, "invalid") ||
			strings.Contains(message, "required") {
			statusCode = http.StatusBadRequest
		}
		log.Printf("[/v1/movers/snapshot] error status=%d index=%s ts=%d db_only=%t err=%v", statusCode, indexKey, tsValue, dbOnly, err)
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}
