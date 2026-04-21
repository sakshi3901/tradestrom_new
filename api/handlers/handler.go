package handlers

import (
	"database/sql"
	"sync"
	"time"
	internalapi "tradestrom-api/internal/api"
	"tradestrom-api/market"
)

type APIHandler struct {
	DB        *sql.DB
	Market    *market.Service
	Movers915 *internalapi.Movers915Handler

	zerodhaSyncMu       sync.Mutex
	zerodhaSyncedAt     time.Time
	zerodhaSyncCacheTTL time.Duration
}

func New(database *sql.DB) *APIHandler {
	marketService := market.NewService()
	marketService.SetDB(database)

	return &APIHandler{
		DB:                  database,
		Market:              marketService,
		Movers915:           internalapi.NewMovers915Handler(database),
		zerodhaSyncCacheTTL: 5 * time.Second,
	}
}
