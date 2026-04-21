package handlers

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"tradestrom-api/market"
)

func (h *APIHandler) GetOHLC(c *gin.Context) {
	_ = h.syncMarketZerodhaCredentials()

	symbol := c.DefaultQuery("symbol", "NIFTY50")
	interval := c.DefaultQuery("interval", "1m")

	from, err := parseTimestampQuery(c.Query("from"), "from")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	to, err := parseTimestampQuery(c.Query("to"), "to")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !to.After(from) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "to must be greater than from"})
		return
	}

	result, err := h.Market.GetOHLC(c.Request.Context(), symbol, from, to, interval)
	if err != nil {
		if errors.Is(err, market.ErrNoCandles) {
			source := "yahoo"
			if strings.EqualFold(strings.TrimSpace(symbol), "NIFTY50") || strings.EqualFold(strings.TrimSpace(symbol), "NIFTY") {
				source = "zerodha"
			}
			c.JSON(http.StatusOK, market.OHLCResponse{
				Symbol:   strings.ToUpper(strings.TrimSpace(symbol)),
				Interval: interval,
				Source:   source,
				Candles:  []market.Candle{},
			})
			return
		}

		statusCode := http.StatusBadRequest
		if !isClientInputError(err) {
			statusCode = http.StatusBadGateway
		}
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	go func() {
		warmCtx, cancel := context.WithTimeout(context.Background(), 24*time.Second)
		defer cancel()
		_ = h.Market.WarmOptionHistory(warmCtx)
		_ = h.Market.WarmMoversCache(warmCtx, to, interval)
	}()

	c.JSON(http.StatusOK, result)
}

func (h *APIHandler) GetMovers(c *gin.Context) {
	_ = h.syncMarketZerodhaCredentials()

	interval := c.DefaultQuery("interval", "1m")
	limit, err := parsePositiveIntWithDefault(c.Query("limit"), 50, 50)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	from, err := parseTimestampQuery(c.Query("from"), "from")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	to, err := parseTimestampQuery(c.Query("to"), "to")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !to.After(from) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "to must be greater than from"})
		return
	}

	result, err := h.Market.GetMovers(c.Request.Context(), from, to, interval, limit)
	if err != nil {
		if errors.Is(err, market.ErrNoCandles) {
			c.JSON(http.StatusOK, market.MoversResponse{
				TS1: map[int64]map[string]market.ContributionData{
					from.Unix(): {},
				},
				TS2: map[int64]map[string]market.ContributionData{
					to.Unix(): {},
				},
			})
			return
		}

		statusCode := http.StatusBadRequest
		if !isClientInputError(err) {
			statusCode = http.StatusBadGateway
		}
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *APIHandler) GetContributionSeries(c *gin.Context) {
	_ = h.syncMarketZerodhaCredentials()

	symbol := c.DefaultQuery("symbol", "NIFTY50")
	interval := c.DefaultQuery("interval", "1m")
	at := time.Now().UTC()
	onlySelected := false

	if rawOnlySelected := strings.TrimSpace(c.Query("only_selected")); rawOnlySelected != "" {
		parsedOnlySelected, err := strconv.ParseBool(rawOnlySelected)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "only_selected must be a boolean"})
			return
		}
		onlySelected = parsedOnlySelected
	}

	if rawAt := strings.TrimSpace(c.Query("at")); rawAt != "" {
		parsedAt, err := parseTimestampQuery(rawAt, "at")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		at = parsedAt.UTC()
	}

	result, err := h.Market.GetContributionSeriesForIndex(c.Request.Context(), symbol, at, interval, onlySelected)
	if err != nil {
		if errors.Is(err, market.ErrNoCandles) {
			emptySymbol := strings.ToUpper(strings.TrimSpace(symbol))
			if emptySymbol == "" {
				emptySymbol = "NIFTY50"
			}
			c.JSON(http.StatusOK, market.ContributionSeriesResponse{
				Symbol: emptySymbol,
				// Keep empty response shape stable even when a non-default index returns no candles.
				Interval:              interval,
				Source:                "zerodha",
				GeneratedAt:           time.Now().UTC().Unix(),
				SessionStartTimestamp: 0,
				SessionEndTimestamp:   0,
				WeightSum:             0,
				Constituents:          []market.ContributionSeriesConstituent{},
				IndexCandles:          []market.Candle{},
				Snapshots:             map[int64]map[string]market.ContributionData{},
			})
			return
		}

		statusCode := http.StatusBadRequest
		if !isClientInputError(err) {
			statusCode = http.StatusBadGateway
		}
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *APIHandler) GetOptionSnapshot(c *gin.Context) {
	_ = h.syncMarketZerodhaCredentials()

	rawTimestamp := strings.TrimSpace(c.Query("ts"))
	fieldName := "ts"
	if rawTimestamp == "" {
		rawTimestamp = strings.TrimSpace(c.Query("time"))
		fieldName = "time"
	}
	at, err := parseTimestampQuery(rawTimestamp, fieldName)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	symbol := c.DefaultQuery("symbol", "NIFTY")
	preferHistorical := parseBoolQuery(c.Query("historical"))
	log.Printf("[/v1/options/snapshot] request path=%s symbol=%s ts=%s time=%s", c.Request.URL.Path, symbol, c.Query("ts"), c.Query("time"))

	var result market.OptionSnapshotResponse
	if preferHistorical {
		result, err = h.Market.GetOptionSnapshotHistorical(c.Request.Context(), symbol, at)
	} else {
		result, err = h.Market.GetOptionSnapshot(c.Request.Context(), symbol, at)
	}
	if err != nil {
		statusCode := http.StatusInternalServerError
		if errors.Is(err, market.ErrNoCandles) || isNotFoundLikeError(err) {
			statusCode = http.StatusNotFound
		} else if isClientInputError(err) {
			statusCode = http.StatusBadRequest
		}
		log.Printf("[/v1/options/snapshot] error status=%d symbol=%s at=%d err=%v", statusCode, symbol, at.Unix(), err)
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *APIHandler) GetOptionDiff(c *gin.Context) {
	_ = h.syncMarketZerodhaCredentials()

	symbol := c.DefaultQuery("symbol", "NIFTY")
	limit, err := parsePositiveIntWithDefault(c.Query("limit"), 10, 21)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	from, err := parseTimestampQuery(c.Query("from"), "from")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	to, err := parseTimestampQuery(c.Query("to"), "to")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !to.After(from) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "to must be greater than from"})
		return
	}

	result, err := h.Market.GetOptionDiff(c.Request.Context(), symbol, from, to, limit)
	if err != nil {
		if errors.Is(err, market.ErrNoCandles) {
			c.JSON(http.StatusOK, market.OptionDiffResponse{
				FromTimestamp: from.Unix(),
				ToTimestamp:   to.Unix(),
				Source:        "zerodha",
				TopStrikes:    []market.OptionStrikeDiff{},
			})
			return
		}

		statusCode := http.StatusBadGateway
		if isClientInputError(err) {
			statusCode = http.StatusBadRequest
		}
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func (h *APIHandler) GetOptionRange(c *gin.Context) {
	_ = h.syncMarketZerodhaCredentials()

	symbol := c.DefaultQuery("symbol", "NIFTY")
	log.Printf("[/v1/options/range] request path=%s symbol=%s from=%s to=%s", c.Request.URL.Path, symbol, c.Query("from"), c.Query("to"))

	from, err := parseTimestampQuery(c.Query("from"), "from")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	to, err := parseTimestampQuery(c.Query("to"), "to")
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if !to.After(from) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "to must be greater than from"})
		return
	}

	result, err := h.Market.GetOptionRange(c.Request.Context(), symbol, from, to)
	if err != nil {
		statusCode := http.StatusInternalServerError
		if errors.Is(err, market.ErrNoCandles) || isNotFoundLikeError(err) {
			statusCode = http.StatusNotFound
		} else if isClientInputError(err) {
			statusCode = http.StatusBadRequest
		}
		log.Printf("[/v1/options/range] error status=%d symbol=%s from=%d to=%d err=%v", statusCode, symbol, from.Unix(), to.Unix(), err)
		c.JSON(statusCode, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, result)
}

func parseBoolQuery(raw string) bool {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case "1", "true", "yes", "y", "on":
		return true
	default:
		return false
	}
}

func parseTimestampQuery(raw, fieldName string) (time.Time, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return time.Time{}, fmt.Errorf("%s query is required", fieldName)
	}

	if unixRaw, err := strconv.ParseInt(value, 10, 64); err == nil {
		if unixRaw > 1_000_000_000_000 {
			return time.UnixMilli(unixRaw).UTC(), nil
		}
		return time.Unix(unixRaw, 0).UTC(), nil
	}

	formats := []string{
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02T15:04",
		"2006-01-02 15:04:05",
		"2006-01-02 15:04",
		"2006-01-02",
	}

	for _, format := range formats {
		if parsed, err := time.Parse(format, value); err == nil {
			return parsed.UTC(), nil
		}
	}

	return time.Time{}, fmt.Errorf("invalid %s timestamp", fieldName)
}

func parsePositiveIntWithDefault(raw string, defaultValue, maxValue int) (int, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return defaultValue, nil
	}

	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("invalid numeric query value: %s", value)
	}
	if parsed <= 0 {
		return 0, fmt.Errorf("numeric query value must be positive")
	}
	if parsed > maxValue {
		return maxValue, nil
	}
	return parsed, nil
}

func isClientInputError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "invalid") || strings.Contains(message, "unsupported") || strings.Contains(message, "required")
}

func isNotFoundLikeError(err error) bool {
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "not found") || strings.Contains(message, "no candles")
}
