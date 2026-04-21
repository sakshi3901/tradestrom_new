package handlers

import (
	"database/sql"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"tradestrom-api/models"
)

func (h *APIHandler) ListUsers(c *gin.Context) {
	rawRole := strings.ToLower(strings.TrimSpace(c.Query("role")))
	if rawRole == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "role query is required"})
		return
	}

	role := sanitizeRole(rawRole)
	if role == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid role query"})
		return
	}

	query := `
		SELECT id, email, name, role, has_access, created_by, created_at, updated_at
		FROM users
		WHERE role = ? AND has_access = TRUE
		ORDER BY created_at DESC
	`

	rows, err := h.DB.Query(query, role)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch users"})
		return
	}
	defer rows.Close()

	users := make([]models.User, 0)
	for rows.Next() {
		var user models.User
		var name sql.NullString
		if err := rows.Scan(
			&user.ID,
			&user.Email,
			&name,
			&user.Role,
			&user.HasAccess,
			&user.CreatedBy,
			&user.CreatedAt,
			&user.UpdatedAt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse users"})
			return
		}

		if name.Valid {
			user.Name = &name.String
		}

		users = append(users, user)
	}

	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to iterate users"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"users": users,
	})
}
