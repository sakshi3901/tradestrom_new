package handlers

import (
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

const (
	settingZerodhaAPIKey      = "zerodha_api_key"
	settingZerodhaAPISecret   = "zerodha_api_secret"
	settingZerodhaAccessToken = "zerodha_access_token"
)

type zerodhaSettingsStatus struct {
	HasAPIKey      bool   `json:"has_api_key"`
	HasAPISecret   bool   `json:"has_api_secret"`
	HasAccessToken bool   `json:"has_access_token"`
	UpdatedBy      string `json:"updated_by,omitempty"`
	UpdatedAt      string `json:"updated_at,omitempty"`
}

func (h *APIHandler) GetZerodhaSettings(c *gin.Context) {
	status, err := h.loadZerodhaSettingsStatus()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load zerodha settings"})
		return
	}

	c.JSON(http.StatusOK, status)
}

func (h *APIHandler) UpsertZerodhaSettings(c *gin.Context) {
	var payload map[string]any
	if err := c.ShouldBindJSON(&payload); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	apiKey := pickString(payload, "apiKey", "api_key", "apikey")
	apiSecret := pickString(payload, "apiSecret", "api_secret", "secret")
	accessToken := pickString(payload, "accessToken", "access_token", "accesstoken")

	if apiKey == "" && apiSecret == "" && accessToken == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "provide at least one value to update"})
		return
	}

	actorEmail := normalizeEmail(c.GetHeader("X-Actor-Email"))
	if actorEmail == "" {
		actorEmail = "internal-service"
	}

	tx, err := h.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start settings transaction"})
		return
	}

	upsert := `
		INSERT INTO app_settings (key_name, value_text, updated_by, updated_at)
		VALUES (?, ?, ?, NOW())
		ON DUPLICATE KEY UPDATE
			value_text = VALUES(value_text),
			updated_by = VALUES(updated_by),
			updated_at = NOW()
	`

	if apiKey != "" {
		if _, execErr := tx.Exec(upsert, settingZerodhaAPIKey, apiKey, actorEmail); execErr != nil {
			_ = tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save zerodha api key"})
			return
		}
	}

	if apiSecret != "" {
		if _, execErr := tx.Exec(upsert, settingZerodhaAPISecret, apiSecret, actorEmail); execErr != nil {
			_ = tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save zerodha api secret"})
			return
		}
	}

	if accessToken != "" {
		if _, execErr := tx.Exec(upsert, settingZerodhaAccessToken, accessToken, actorEmail); execErr != nil {
			_ = tx.Rollback()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save zerodha access token"})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit settings update"})
		return
	}

	h.invalidateMarketZerodhaCredentialSyncCache()
	_ = h.syncMarketZerodhaCredentials()
	if h.Movers915 != nil {
		h.Movers915.Reset()
	}

	h.recordAudit(actorEmail, "update_zerodha_settings", "zerodha")

	status, err := h.loadZerodhaSettingsStatus()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "settings updated but failed to fetch latest status"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"status":  status,
	})
}

func (h *APIHandler) syncMarketZerodhaCredentials() error {
	if h == nil || h.Market == nil || h.DB == nil {
		return nil
	}

	h.zerodhaSyncMu.Lock()
	defer h.zerodhaSyncMu.Unlock()

	cacheTTL := h.zerodhaSyncCacheTTL
	if cacheTTL <= 0 {
		cacheTTL = 5 * time.Second
	}
	if !h.zerodhaSyncedAt.IsZero() && time.Since(h.zerodhaSyncedAt) < cacheTTL {
		return nil
	}

	rows, err := h.DB.Query(
		"SELECT key_name, value_text FROM app_settings WHERE key_name IN (?, ?, ?)",
		settingZerodhaAPIKey,
		settingZerodhaAPISecret,
		settingZerodhaAccessToken,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "app_settings") {
			return nil
		}
		return err
	}
	defer rows.Close()

	apiKey := ""
	apiSecret := ""
	accessToken := ""

	for rows.Next() {
		var key string
		var value sql.NullString
		if scanErr := rows.Scan(&key, &value); scanErr != nil {
			return scanErr
		}
		if !value.Valid {
			continue
		}

		switch key {
		case settingZerodhaAPIKey:
			apiKey = value.String
		case settingZerodhaAPISecret:
			apiSecret = value.String
		case settingZerodhaAccessToken:
			accessToken = value.String
		}
	}

	if err := rows.Err(); err != nil {
		return err
	}

	h.Market.SetZerodhaCredentials(apiKey, apiSecret, accessToken)
	h.zerodhaSyncedAt = time.Now()
	return nil
}

func (h *APIHandler) invalidateMarketZerodhaCredentialSyncCache() {
	if h == nil {
		return
	}
	h.zerodhaSyncMu.Lock()
	h.zerodhaSyncedAt = time.Time{}
	h.zerodhaSyncMu.Unlock()
}

func (h *APIHandler) loadZerodhaSettingsStatus() (zerodhaSettingsStatus, error) {
	rows, err := h.DB.Query(
		"SELECT key_name, value_text, updated_by, updated_at FROM app_settings WHERE key_name IN (?, ?, ?)",
		settingZerodhaAPIKey,
		settingZerodhaAPISecret,
		settingZerodhaAccessToken,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "app_settings") {
			return zerodhaSettingsStatus{}, nil
		}
		return zerodhaSettingsStatus{}, err
	}
	defer rows.Close()

	status := zerodhaSettingsStatus{}
	latestUpdatedAt := time.Time{}

	for rows.Next() {
		var key string
		var value sql.NullString
		var updatedBy sql.NullString
		var updatedAt sql.NullTime

		if scanErr := rows.Scan(&key, &value, &updatedBy, &updatedAt); scanErr != nil {
			return zerodhaSettingsStatus{}, scanErr
		}

		hasValue := value.Valid && strings.TrimSpace(value.String) != ""
		switch key {
		case settingZerodhaAPIKey:
			status.HasAPIKey = hasValue
		case settingZerodhaAPISecret:
			status.HasAPISecret = hasValue
		case settingZerodhaAccessToken:
			status.HasAccessToken = hasValue
		}

		if updatedAt.Valid && updatedAt.Time.After(latestUpdatedAt) {
			latestUpdatedAt = updatedAt.Time
			if updatedBy.Valid {
				status.UpdatedBy = updatedBy.String
			}
		}
	}

	if err := rows.Err(); err != nil {
		return zerodhaSettingsStatus{}, err
	}

	if !latestUpdatedAt.IsZero() {
		status.UpdatedAt = latestUpdatedAt.UTC().Format(time.RFC3339)
	}

	return status, nil
}

func pickString(payload map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := payload[key]
		if !ok {
			continue
		}
		text, ok := value.(string)
		if !ok {
			continue
		}
		trimmed := strings.TrimSpace(text)
		if trimmed != "" {
			return trimmed
		}
	}
	return ""
}
