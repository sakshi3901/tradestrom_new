package models

import "time"

type User struct {
	ID        int64      `json:"id"`
	Email     string     `json:"email"`
	Name      *string    `json:"name,omitempty"`
	Role      string     `json:"role"`
	HasAccess bool       `json:"has_access"`
	CreatedBy string     `json:"created_by"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
}

type AccessCheckResponse struct {
	Allowed bool   `json:"allowed"`
	Role    string `json:"role"`
}
