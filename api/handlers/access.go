package handlers

import (
	"database/sql"
	"log"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"tradestrom-api/models"
)

type grantAccessRequest struct {
	Email string `json:"email"`
	Role  string `json:"role"`
}

type revokeAccessRequest struct {
	Email string `json:"email"`
}

var allowedRoles = map[string]bool{
	"admin":  true,
	"client": true,
}

func normalizeEmail(email string) string {
	value := strings.ToLower(strings.TrimSpace(email))
	parts := strings.Split(value, "@")
	if len(parts) != 2 {
		return value
	}

	local := parts[0]
	domain := parts[1]
	if local == "" {
		return value
	}

	if domain == "googlemail.com" {
		domain = "gmail.com"
	}

	if domain == "gmail.com" {
		if idx := strings.Index(local, "+"); idx >= 0 {
			local = local[:idx]
		}
		local = strings.ReplaceAll(local, ".", "")
	}

	return local + "@" + domain
}

func isGmail(email string) bool {
	value := strings.ToLower(strings.TrimSpace(email))
	parts := strings.Split(value, "@")
	if len(parts) != 2 || parts[0] == "" {
		return false
	}

	domain := parts[1]
	return domain == "gmail.com" || domain == "googlemail.com"
}

func sanitizeRole(role string) string {
	value := strings.ToLower(strings.TrimSpace(role))
	if value == "" {
		return "client"
	}
	if !allowedRoles[value] {
		return ""
	}
	return value
}

func (h *APIHandler) CheckAccess(c *gin.Context) {
	email := normalizeEmail(c.Query("email"))
	if email == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "email is required"})
		return
	}

	if !isGmail(email) {
		c.JSON(http.StatusOK, models.AccessCheckResponse{Allowed: false, Role: "client"})
		return
	}

	query := `
		SELECT role, has_access
		FROM users
		WHERE email = ?
		LIMIT 1
	`

	var role string
	var hasAccess bool
	if err := h.DB.QueryRow(query, email).Scan(&role, &hasAccess); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusOK, models.AccessCheckResponse{Allowed: false, Role: "client"})
			return
		}

		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to check access"})
		return
	}

	c.JSON(http.StatusOK, models.AccessCheckResponse{
		Allowed: hasAccess,
		Role:    role,
	})
}

func (h *APIHandler) GrantAccess(c *gin.Context) {
	var req grantAccessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	email := normalizeEmail(req.Email)
	if !isGmail(email) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only @gmail.com emails are allowed"})
		return
	}

	role := sanitizeRole(req.Role)
	if role == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role"})
		return
	}

	actorEmail := normalizeEmail(c.GetHeader("X-Actor-Email"))
	if actorEmail == "" {
		actorEmail = "internal-service"
	}

	query := `
		INSERT INTO users (email, role, has_access, created_by, created_at, updated_at)
		VALUES (?, ?, TRUE, ?, NOW(), NOW())
		ON DUPLICATE KEY UPDATE
			role = VALUES(role),
			has_access = TRUE,
			updated_at = NOW()
	`

	if _, err := h.DB.Exec(query, email, role, actorEmail); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to grant access"})
		return
	}

	h.recordAudit(actorEmail, "grant_access", email)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"email":   email,
		"role":    role,
	})
}

func (h *APIHandler) RevokeAccess(c *gin.Context) {
	var req revokeAccessRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	email := normalizeEmail(req.Email)
	if !isGmail(email) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "only @gmail.com emails are allowed"})
		return
	}

	result, err := h.DB.Exec(
		"UPDATE users SET has_access = FALSE, updated_at = NOW() WHERE email = ?",
		email,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke access"})
		return
	}

	rows, err := result.RowsAffected()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to revoke access"})
		return
	}

	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
		return
	}

	actorEmail := normalizeEmail(c.GetHeader("X-Actor-Email"))
	if actorEmail == "" {
		actorEmail = "internal-service"
	}
	h.recordAudit(actorEmail, "revoke_access", email)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"email":   email,
	})
}

func (h *APIHandler) recordAudit(actorEmail, action, targetEmail string) {
	_, err := h.DB.Exec(
		"INSERT INTO audit_logs (actor_email, action, target_email, created_at) VALUES (?, ?, ?, NOW())",
		actorEmail,
		action,
		targetEmail,
	)
	if err != nil {
		log.Printf("failed to write audit log: %v", err)
	}
}
