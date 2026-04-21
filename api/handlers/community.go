package handlers

import (
	"database/sql"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

const (
	communityMaxTitleLength       = 75
	communityMaxDescriptionLength = 1500
	communityMaxImageDataLength   = 8 * 1024 * 1024
)

var communityCategoryMap = map[string]string{
	"pnl":            "PnL",
	"trading setup":  "Trading Setup",
	"trading goals":  "Trading Goals",
	"memes":          "Memes",
	"chart analysis": "Chart Analysis",
}

var communityStatusMap = map[string]string{
	"pending":  "pending",
	"approved": "approved",
	"rejected": "rejected",
}

var allowedImageMimeTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

type listCommunityPostsResponse struct {
	Posts       []communityPostResponse `json:"posts"`
	Total       int                     `json:"total"`
	TotalPosts  int                     `json:"totalPosts"`
	TotalPages  int                     `json:"totalPages"`
	CurrentPage int                     `json:"currentPage"`
}

type communityPostResponse struct {
	ID          int64                `json:"id"`
	AuthorEmail string               `json:"author_email"`
	Category    string               `json:"category"`
	Title       string               `json:"title"`
	Description string               `json:"description"`
	Images      []communityImageData `json:"images"`
	Status      string               `json:"status"`
	Likes       int                  `json:"likes"`
	Liked       bool                 `json:"liked"`
	CreatedAt   int64                `json:"created_at"`
	UpdatedAt   int64                `json:"updated_at"`
}

type communityImageData struct {
	ID   string `json:"id"`
	Src  string `json:"src"`
	Name string `json:"name,omitempty"`
}

type createCommunityPostRequest struct {
	Category       string `json:"category"`
	Title          string `json:"title"`
	Description    string `json:"description"`
	PrimaryImage   string `json:"primary_image"`
	SecondaryImage string `json:"secondary_image"`
}

type updateCommunityPostStatusRequest struct {
	Status string `json:"status"`
}

type toggleLikeResponse struct {
	PostID int64 `json:"post_id"`
	Likes  int   `json:"likes"`
	Liked  bool  `json:"liked"`
}

func normalizeCommunityCategory(value string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" || normalized == "all" {
		return "", false
	}
	canonical, ok := communityCategoryMap[normalized]
	return canonical, ok
}

func normalizeCommunityStatus(value string) (string, bool) {
	normalized := strings.ToLower(strings.TrimSpace(value))
	if normalized == "" || normalized == "all" {
		return "", false
	}
	canonical, ok := communityStatusMap[normalized]
	return canonical, ok
}

func parsePositiveIntWithBounds(value string, defaultValue int, maxValue int) int {
	numeric, err := strconv.Atoi(strings.TrimSpace(value))
	if err != nil || numeric <= 0 {
		return defaultValue
	}
	if numeric > maxValue {
		return maxValue
	}
	return numeric
}

func parseNonNegativeIntWithBounds(value string, defaultValue int, maxValue int) int {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return defaultValue
	}
	numeric, err := strconv.Atoi(trimmed)
	if err != nil || numeric < 0 {
		return defaultValue
	}
	if numeric > maxValue {
		return maxValue
	}
	return numeric
}

func validateImageDataURL(label string, value string, required bool) error {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		if required {
			return fmt.Errorf("%s is required", label)
		}
		return nil
	}

	if len(trimmed) > communityMaxImageDataLength {
		return fmt.Errorf("%s is too large", label)
	}

	if !strings.HasPrefix(trimmed, "data:") {
		return fmt.Errorf("%s must be a valid image data URL", label)
	}

	metaAndPayload := strings.SplitN(trimmed, ",", 2)
	if len(metaAndPayload) != 2 {
		return fmt.Errorf("%s must be a valid image data URL", label)
	}

	meta := metaAndPayload[0]
	parts := strings.Split(meta, ";")
	if len(parts) < 2 {
		return fmt.Errorf("%s must be base64 encoded", label)
	}

	mime := strings.TrimPrefix(parts[0], "data:")
	if !allowedImageMimeTypes[mime] {
		return fmt.Errorf("%s must be JPG, JPEG, PNG or WEBP", label)
	}

	if strings.ToLower(parts[1]) != "base64" {
		return fmt.Errorf("%s must be base64 encoded", label)
	}

	return nil
}

func buildCommunityPostResponse(
	id int64,
	authorEmail string,
	category string,
	title string,
	description string,
	primaryImage string,
	secondaryImage sql.NullString,
	status string,
	likes int,
	liked bool,
	createdAt int64,
	updatedAt int64,
) communityPostResponse {
	images := make([]communityImageData, 0, 2)

	primary := strings.TrimSpace(primaryImage)
	if primary != "" {
		images = append(images, communityImageData{
			ID:  fmt.Sprintf("%d-primary", id),
			Src: primary,
		})
	}

	if secondaryImage.Valid {
		secondary := strings.TrimSpace(secondaryImage.String)
		if secondary != "" {
			images = append(images, communityImageData{
				ID:  fmt.Sprintf("%d-secondary", id),
				Src: secondary,
			})
		}
	}

	return communityPostResponse{
		ID:          id,
		AuthorEmail: authorEmail,
		Category:    category,
		Title:       title,
		Description: description,
		Images:      images,
		Status:      status,
		Likes:       likes,
		Liked:       liked,
		CreatedAt:   createdAt,
		UpdatedAt:   updatedAt,
	}
}

func (h *APIHandler) requireAdminActor(c *gin.Context) (string, bool) {
	actorEmail := normalizeEmail(c.GetHeader("X-Actor-Email"))
	if actorEmail == "" {
		actorEmail = normalizeEmail(c.Query("actor_email"))
	}
	if actorEmail == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "actor email is required"})
		return "", false
	}

	var role string
	var hasAccess bool
	if err := h.DB.QueryRow(
		`SELECT role, has_access FROM users WHERE email = ? LIMIT 1`,
		actorEmail,
	).Scan(&role, &hasAccess); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
			return "", false
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to validate admin actor"})
		return "", false
	}

	if !hasAccess || strings.ToLower(strings.TrimSpace(role)) != "admin" {
		c.JSON(http.StatusForbidden, gin.H{"error": "admin access required"})
		return "", false
	}

	return actorEmail, true
}

func (h *APIHandler) ListCommunityPosts(c *gin.Context) {
	userEmail := normalizeEmail(c.Query("user_email"))
	if userEmail == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_email is required"})
		return
	}

	authorEmail := normalizeEmail(c.Query("author_email"))
	categoryParam := strings.TrimSpace(c.Query("category"))
	category := ""
	if categoryParam != "" && strings.ToLower(categoryParam) != "all" {
		normalizedCategory, ok := normalizeCommunityCategory(categoryParam)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid category"})
			return
		}
		category = normalizedCategory
	}

	limit := parsePositiveIntWithBounds(c.Query("limit"), 30, 30)
	page := parsePositiveIntWithBounds(c.Query("page"), 1, 1000000)
	offset := (page - 1) * limit

	countQuery := `
		SELECT COUNT(*)
		FROM community_posts p
		WHERE p.status = 'approved'
		  AND (? = '' OR p.author_email = ?)
		  AND (? = '' OR p.category = ?)
	`

	var total int
	if err := h.DB.QueryRow(countQuery, authorEmail, authorEmail, category, category).Scan(&total); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load posts"})
		return
	}

	totalPages := 1
	if total > 0 {
		totalPages = (total + limit - 1) / limit
	}
	if page > totalPages {
		page = totalPages
		offset = (page - 1) * limit
	}

	query := `
		SELECT
			p.id,
			p.author_email,
			p.category,
			p.title,
			p.description_text,
			p.primary_image,
			p.secondary_image,
			p.status,
			p.likes_count,
			UNIX_TIMESTAMP(p.created_at),
			UNIX_TIMESTAMP(p.updated_at),
			CASE WHEN l.post_id IS NULL THEN 0 ELSE 1 END AS liked
		FROM community_posts p
		LEFT JOIN community_post_likes l
			ON l.post_id = p.id
			AND l.user_email = ?
		WHERE p.status = 'approved'
		  AND (? = '' OR p.author_email = ?)
		  AND (? = '' OR p.category = ?)
		ORDER BY p.created_at DESC, p.id DESC
		LIMIT ? OFFSET ?
	`

	rows, err := h.DB.Query(query, userEmail, authorEmail, authorEmail, category, category, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load posts"})
		return
	}
	defer rows.Close()

	posts := make([]communityPostResponse, 0, limit)

	for rows.Next() {
		var (
			id             int64
			author         string
			categoryValue  string
			title          string
			description    string
			primaryImage   string
			secondaryImage sql.NullString
			status         string
			likes          int
			createdAt      int64
			updatedAt      int64
			likedInt       int
		)

		if err := rows.Scan(
			&id,
			&author,
			&categoryValue,
			&title,
			&description,
			&primaryImage,
			&secondaryImage,
			&status,
			&likes,
			&createdAt,
			&updatedAt,
			&likedInt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse posts"})
			return
		}

		posts = append(posts, buildCommunityPostResponse(
			id,
			author,
			categoryValue,
			title,
			description,
			primaryImage,
			secondaryImage,
			status,
			likes,
			likedInt == 1,
			createdAt,
			updatedAt,
		))
	}

	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read posts"})
		return
	}

	c.JSON(http.StatusOK, listCommunityPostsResponse{
		Posts:       posts,
		Total:       total,
		TotalPosts:  total,
		TotalPages:  totalPages,
		CurrentPage: page,
	})
}

func (h *APIHandler) ListAdminCommunityPosts(c *gin.Context) {
	if _, ok := h.requireAdminActor(c); !ok {
		return
	}

	statusParam := strings.TrimSpace(c.Query("status"))
	status := "pending"
	if statusParam != "" {
		if strings.EqualFold(statusParam, "all") {
			status = ""
		} else {
			normalizedStatus, ok := normalizeCommunityStatus(statusParam)
			if !ok {
				c.JSON(http.StatusBadRequest, gin.H{"error": "invalid status"})
				return
			}
			status = normalizedStatus
		}
	}

	authorEmail := normalizeEmail(c.Query("author_email"))
	categoryParam := strings.TrimSpace(c.Query("category"))
	category := ""
	if categoryParam != "" && strings.ToLower(categoryParam) != "all" {
		normalizedCategory, ok := normalizeCommunityCategory(categoryParam)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid category"})
			return
		}
		category = normalizedCategory
	}

	limit := parsePositiveIntWithBounds(c.Query("limit"), 80, 300)
	offset := parseNonNegativeIntWithBounds(c.Query("offset"), 0, 1000000)

	countQuery := `
		SELECT COUNT(*)
		FROM community_posts p
		WHERE (? = '' OR p.status = ?)
		  AND (? = '' OR p.author_email = ?)
		  AND (? = '' OR p.category = ?)
	`

	var total int
	if err := h.DB.QueryRow(countQuery, status, status, authorEmail, authorEmail, category, category).Scan(&total); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load admin community posts"})
		return
	}

	query := `
		SELECT
			p.id,
			p.author_email,
			p.category,
			p.title,
			p.description_text,
			p.primary_image,
			p.secondary_image,
			p.status,
			p.likes_count,
			UNIX_TIMESTAMP(p.created_at),
			UNIX_TIMESTAMP(p.updated_at)
		FROM community_posts p
		WHERE (? = '' OR p.status = ?)
		  AND (? = '' OR p.author_email = ?)
		  AND (? = '' OR p.category = ?)
		ORDER BY p.created_at DESC, p.id DESC
		LIMIT ? OFFSET ?
	`

	rows, err := h.DB.Query(query, status, status, authorEmail, authorEmail, category, category, limit, offset)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to load admin community posts"})
		return
	}
	defer rows.Close()

	posts := make([]communityPostResponse, 0, limit)

	for rows.Next() {
		var (
			id             int64
			author         string
			categoryValue  string
			title          string
			description    string
			primaryImage   string
			secondaryImage sql.NullString
			statusValue    string
			likes          int
			createdAt      int64
			updatedAt      int64
		)

		if err := rows.Scan(
			&id,
			&author,
			&categoryValue,
			&title,
			&description,
			&primaryImage,
			&secondaryImage,
			&statusValue,
			&likes,
			&createdAt,
			&updatedAt,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to parse admin community posts"})
			return
		}

		posts = append(posts, buildCommunityPostResponse(
			id,
			author,
			categoryValue,
			title,
			description,
			primaryImage,
			secondaryImage,
			statusValue,
			likes,
			false,
			createdAt,
			updatedAt,
		))
	}

	if err := rows.Err(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to read admin community posts"})
		return
	}

	totalPages := 1
	if total > 0 {
		totalPages = (total + limit - 1) / limit
	}
	currentPage := (offset / limit) + 1
	if currentPage > totalPages {
		currentPage = totalPages
	}

	c.JSON(http.StatusOK, listCommunityPostsResponse{
		Posts:       posts,
		Total:       total,
		TotalPosts:  total,
		TotalPages:  totalPages,
		CurrentPage: currentPage,
	})
}

func (h *APIHandler) CreateCommunityPost(c *gin.Context) {
	userEmail := normalizeEmail(c.GetHeader("X-Actor-Email"))
	if userEmail == "" {
		userEmail = normalizeEmail(c.Query("user_email"))
	}
	if userEmail == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user email is required"})
		return
	}

	var req createCommunityPostRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	category, ok := normalizeCommunityCategory(req.Category)
	if !ok {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid category"})
		return
	}

	title := strings.TrimSpace(req.Title)
	if title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title is required"})
		return
	}
	if len([]rune(title)) > communityMaxTitleLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "title exceeds max length"})
		return
	}

	description := strings.TrimSpace(req.Description)
	if description == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "description is required"})
		return
	}
	if len([]rune(description)) > communityMaxDescriptionLength {
		c.JSON(http.StatusBadRequest, gin.H{"error": "description exceeds max length"})
		return
	}

	primaryImage := strings.TrimSpace(req.PrimaryImage)
	secondaryImage := strings.TrimSpace(req.SecondaryImage)

	if err := validateImageDataURL("primary image", primaryImage, true); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if err := validateImageDataURL("secondary image", secondaryImage, false); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if secondaryImage != "" && primaryImage == secondaryImage {
		c.JSON(http.StatusBadRequest, gin.H{"error": "image 1 and image 2 cannot be same"})
		return
	}

	insertQuery := `
		INSERT INTO community_posts (
			author_email,
			category,
			title,
			description_text,
			primary_image,
			secondary_image,
			status,
			likes_count,
			created_at,
			updated_at
		) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, NOW(), NOW())
	`

	var secondaryImageSQL sql.NullString
	if secondaryImage != "" {
		secondaryImageSQL = sql.NullString{String: secondaryImage, Valid: true}
	}

	result, err := h.DB.Exec(
		insertQuery,
		userEmail,
		category,
		title,
		description,
		primaryImage,
		secondaryImageSQL,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create post"})
		return
	}

	postID, err := result.LastInsertId()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create post"})
		return
	}

	var createdAt int64
	var updatedAt int64
	if err := h.DB.QueryRow(
		`SELECT UNIX_TIMESTAMP(created_at), UNIX_TIMESTAMP(updated_at) FROM community_posts WHERE id = ?`,
		postID,
	).Scan(&createdAt, &updatedAt); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to create post"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"post": buildCommunityPostResponse(
			postID,
			userEmail,
			category,
			title,
			description,
			primaryImage,
			secondaryImageSQL,
			"pending",
			0,
			false,
			createdAt,
			updatedAt,
		),
	})
}

func (h *APIHandler) UpdateCommunityPostStatus(c *gin.Context) {
	actorEmail, ok := h.requireAdminActor(c)
	if !ok {
		return
	}

	postID, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid post id"})
		return
	}

	var req updateCommunityPostStatusRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid request body"})
		return
	}

	nextStatus, ok := normalizeCommunityStatus(req.Status)
	if !ok || (nextStatus != "approved" && nextStatus != "rejected" && nextStatus != "pending") {
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be approved, rejected, or pending"})
		return
	}

	var targetEmail string
	if err := h.DB.QueryRow(`SELECT author_email FROM community_posts WHERE id = ?`, postID).Scan(&targetEmail); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update post status"})
		return
	}

	result, err := h.DB.Exec(
		`UPDATE community_posts SET status = ?, updated_at = NOW() WHERE id = ?`,
		nextStatus,
		postID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update post status"})
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update post status"})
		return
	}
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
		return
	}

	action := "community_post_pending"
	if nextStatus == "approved" {
		action = "community_post_approved"
	} else if nextStatus == "rejected" {
		action = "community_post_rejected"
	}
	h.recordAudit(actorEmail, action, targetEmail)

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"post_id": postID,
		"status":  nextStatus,
	})
}

func (h *APIHandler) DeleteCommunityPost(c *gin.Context) {
	userEmail := normalizeEmail(c.GetHeader("X-Actor-Email"))
	if userEmail == "" {
		userEmail = normalizeEmail(c.Query("user_email"))
	}
	if userEmail == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user email is required"})
		return
	}

	postID, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid post id"})
		return
	}

	result, err := h.DB.Exec(
		`DELETE FROM community_posts WHERE id = ? AND author_email = ?`,
		postID,
		userEmail,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete post"})
		return
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to delete post"})
		return
	}
	if rowsAffected == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"success": true,
		"post_id": postID,
	})
}

func (h *APIHandler) ToggleCommunityPostLike(c *gin.Context) {
	userEmail := normalizeEmail(c.GetHeader("X-Actor-Email"))
	if userEmail == "" {
		userEmail = normalizeEmail(c.Query("user_email"))
	}
	if userEmail == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user email is required"})
		return
	}

	postID, err := strconv.ParseInt(strings.TrimSpace(c.Param("id")), 10, 64)
	if err != nil || postID <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid post id"})
		return
	}

	tx, err := h.DB.Begin()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
		return
	}
	defer func() {
		_ = tx.Rollback()
	}()

	var existingPostID int64
	if err := tx.QueryRow(`SELECT id FROM community_posts WHERE id = ? AND status = 'approved' LIMIT 1`, postID).Scan(&existingPostID); err != nil {
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "post not found"})
			return
		}
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
		return
	}

	var liked bool
	if err := tx.QueryRow(
		`SELECT EXISTS(SELECT 1 FROM community_post_likes WHERE post_id = ? AND user_email = ?)`,
		postID,
		userEmail,
	).Scan(&liked); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
		return
	}

	nextLiked := !liked

	if liked {
		if _, err := tx.Exec(
			`DELETE FROM community_post_likes WHERE post_id = ? AND user_email = ?`,
			postID,
			userEmail,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
			return
		}

		if _, err := tx.Exec(
			`UPDATE community_posts SET likes_count = GREATEST(likes_count - 1, 0), updated_at = NOW() WHERE id = ?`,
			postID,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
			return
		}
	} else {
		if _, err := tx.Exec(
			`INSERT INTO community_post_likes (post_id, user_email, created_at) VALUES (?, ?, NOW())`,
			postID,
			userEmail,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
			return
		}

		if _, err := tx.Exec(
			`UPDATE community_posts SET likes_count = likes_count + 1, updated_at = NOW() WHERE id = ?`,
			postID,
		); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
			return
		}
	}

	var likesCount int
	if err := tx.QueryRow(`SELECT likes_count FROM community_posts WHERE id = ?`, postID).Scan(&likesCount); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to toggle like"})
		return
	}

	c.JSON(http.StatusOK, toggleLikeResponse{
		PostID: postID,
		Likes:  likesCount,
		Liked:  nextLiked,
	})
}
