package movers

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"

	"tradestrom-api/internal/candle"
)

const (
	settingZerodhaAPIKey      = "zerodha_api_key"
	settingZerodhaAccessToken = "zerodha_access_token"
)

type ZerodhaCredentials struct {
	APIKey      string
	AccessToken string
}

type Repository struct {
	db         *sql.DB
	schemaOnce sync.Once
	schemaErr  error
}

func NewRepository(db *sql.DB) *Repository {
	return &Repository{db: db}
}

func (r *Repository) ensureIndexMoversTable(ctx context.Context) error {
	if r == nil || r.db == nil {
		return fmt.Errorf("database is not initialized")
	}

	r.schemaOnce.Do(func() {
		_, r.schemaErr = r.db.ExecContext(ctx, `
			CREATE TABLE IF NOT EXISTS index_movers_1m (
				index_key VARCHAR(32) NOT NULL,
				ts_minute BIGINT NOT NULL,
				rank_no INT NOT NULL,
				symbol VARCHAR(32) NOT NULL,
				per_change DOUBLE NOT NULL,
				per_to_index DOUBLE NULL,
				point_to_index DOUBLE NULL,
				abs_point_to_index DOUBLE NULL,
				created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
				updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
				PRIMARY KEY (index_key, ts_minute, symbol),
				KEY idx_index_ts_rank (index_key, ts_minute, rank_no),
				KEY idx_index_movers_ts (ts_minute)
			)
		`)
	})
	return r.schemaErr
}

func (r *Repository) LoadZerodhaCredentials(ctx context.Context) (ZerodhaCredentials, error) {
	rows, err := r.db.QueryContext(
		ctx,
		"SELECT key_name, value_text FROM app_settings WHERE key_name IN (?, ?)",
		settingZerodhaAPIKey,
		settingZerodhaAccessToken,
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "app_settings") {
			return fallbackZerodhaCredentials(), nil
		}
		return ZerodhaCredentials{}, err
	}
	defer rows.Close()

	apiKey := ""
	accessToken := ""

	for rows.Next() {
		var key string
		var value sql.NullString
		if scanErr := rows.Scan(&key, &value); scanErr != nil {
			return ZerodhaCredentials{}, scanErr
		}
		if !value.Valid {
			continue
		}
		switch key {
		case settingZerodhaAPIKey:
			apiKey = strings.TrimSpace(value.String)
		case settingZerodhaAccessToken:
			accessToken = strings.TrimSpace(value.String)
		}
	}
	if err := rows.Err(); err != nil {
		return ZerodhaCredentials{}, err
	}

	fallback := fallbackZerodhaCredentials()
	if apiKey == "" {
		apiKey = fallback.APIKey
	}
	if accessToken == "" {
		accessToken = fallback.AccessToken
	}

	if apiKey == "" {
		return ZerodhaCredentials{}, fmt.Errorf("zerodha api key is missing")
	}
	if accessToken == "" {
		return ZerodhaCredentials{}, fmt.Errorf("zerodha access token is missing")
	}

	return ZerodhaCredentials{
		APIKey:      apiKey,
		AccessToken: accessToken,
	}, nil
}

func (r *Repository) LoadInstrumentTokensBySymbol(ctx context.Context, symbols []string) (map[string]uint32, error) {
	uniqueSymbols := uniqueUpperSymbols(symbols)
	if len(uniqueSymbols) == 0 {
		return map[string]uint32{}, nil
	}

	query := "SELECT instrument_token, tradingsymbol FROM instruments WHERE exchange = 'NSE' AND UPPER(tradingsymbol) IN (" + placeholders(len(uniqueSymbols)) + ")"
	args := make([]any, 0, len(uniqueSymbols))
	for _, symbol := range uniqueSymbols {
		args = append(args, symbol)
	}

	rows, err := r.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make(map[string]uint32, len(uniqueSymbols))
	for rows.Next() {
		var instrumentToken int64
		var symbol string
		if scanErr := rows.Scan(&instrumentToken, &symbol); scanErr != nil {
			return nil, scanErr
		}

		if instrumentToken <= 0 {
			continue
		}

		tokenUint32 := uint32(instrumentToken)
		if int64(tokenUint32) != instrumentToken {
			continue
		}

		out[strings.ToUpper(strings.TrimSpace(symbol))] = tokenUint32
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	return out, nil
}

func (r *Repository) UpsertNSEInstruments(ctx context.Context, tokenToSymbol map[uint32]string) error {
	if len(tokenToSymbol) == 0 {
		return nil
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		if tx != nil {
			_ = tx.Rollback()
		}
	}()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO instruments (instrument_token, tradingsymbol, exchange)
		VALUES (?, ?, 'NSE')
		ON DUPLICATE KEY UPDATE
			tradingsymbol = VALUES(tradingsymbol),
			exchange = VALUES(exchange),
			updated_at = CURRENT_TIMESTAMP
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for token, symbol := range tokenToSymbol {
		if token == 0 {
			continue
		}
		normalizedSymbol := strings.ToUpper(strings.TrimSpace(symbol))
		if normalizedSymbol == "" {
			continue
		}
		if _, execErr := stmt.ExecContext(ctx, token, normalizedSymbol); execErr != nil {
			return execErr
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	tx = nil
	return nil
}

func (r *Repository) UpsertCandle1m(instrumentToken uint32, tsMinute int64, price float64) error {
	if instrumentToken == 0 || tsMinute <= 0 || price <= 0 {
		return nil
	}

	query := `
		INSERT INTO candles_1m (instrument_token, ts_minute, open, high, low, close)
		VALUES (?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			high = GREATEST(high, VALUES(high)),
			low = LEAST(low, VALUES(low)),
			close = VALUES(close),
			updated_at = CURRENT_TIMESTAMP
	`
	_, err := r.db.ExecContext(context.Background(), query, instrumentToken, tsMinute, price, price, price, price)
	return err
}

func (r *Repository) GetCandle1m(ctx context.Context, instrumentToken uint32, tsMinute int64) (candle.Candle, bool, error) {
	if instrumentToken == 0 || tsMinute <= 0 {
		return candle.Candle{}, false, nil
	}

	query := `SELECT open, high, low, close FROM candles_1m WHERE instrument_token = ? AND ts_minute = ? LIMIT 1`
	row := r.db.QueryRowContext(ctx, query, instrumentToken, tsMinute)

	var result candle.Candle
	if err := row.Scan(&result.Open, &result.High, &result.Low, &result.Close); err != nil {
		if err == sql.ErrNoRows {
			return candle.Candle{}, false, nil
		}
		return candle.Candle{}, false, err
	}
	return result, true, nil
}

func (r *Repository) UpsertMover1m(ctx context.Context, tsMinute int64, symbol string, metrics Metrics) error {
	query := `
		INSERT INTO movers_1m (ts_minute, symbol, per_change, per_to_index, point_to_index)
		VALUES (?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			per_change = VALUES(per_change),
			per_to_index = VALUES(per_to_index),
			point_to_index = VALUES(point_to_index),
			updated_at = CURRENT_TIMESTAMP
	`

	_, err := r.db.ExecContext(
		ctx,
		query,
		tsMinute,
		strings.ToUpper(strings.TrimSpace(symbol)),
		metrics.PerChange,
		nullableFloat(metrics.PerToIndex),
		nullableFloat(metrics.PointToIndex),
	)
	return err
}

func (r *Repository) ReplaceIndexMoverSnapshot(ctx context.Context, indexKey string, tsMinute int64, rows []ImpactRow) error {
	if tsMinute <= 0 {
		return fmt.Errorf("invalid ts_minute")
	}
	indexKey = strings.ToUpper(strings.TrimSpace(indexKey))
	if indexKey == "" {
		return fmt.Errorf("index key is required")
	}
	if err := r.ensureIndexMoversTable(ctx); err != nil {
		return err
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if _, err := tx.ExecContext(ctx, `DELETE FROM index_movers_1m WHERE index_key = ? AND ts_minute = ?`, indexKey, tsMinute); err != nil {
		return err
	}

	if len(rows) == 0 {
		return tx.Commit()
	}

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO index_movers_1m
			(index_key, ts_minute, rank_no, symbol, per_change, per_to_index, point_to_index, abs_point_to_index)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for i, row := range rows {
		symbol := strings.ToUpper(strings.TrimSpace(row.Symbol))
		if symbol == "" {
			continue
		}
		rankNo := row.Rank
		if rankNo <= 0 {
			rankNo = i + 1
		}
		pointAbs := 0.0
		if row.Metrics.PointToIndex != nil {
			value := *row.Metrics.PointToIndex
			if value < 0 {
				pointAbs = -value
			} else {
				pointAbs = value
			}
		}
		if _, err := stmt.ExecContext(
			ctx,
			indexKey,
			tsMinute,
			rankNo,
			symbol,
			row.Metrics.PerChange,
			nullableFloat(row.Metrics.PerToIndex),
			nullableFloat(row.Metrics.PointToIndex),
			pointAbs,
		); err != nil {
			return err
		}
	}

	return tx.Commit()
}

func (r *Repository) GetIndexMoverSnapshot(ctx context.Context, indexKey string, tsMinute int64, limit int) ([]ImpactRow, error) {
	indexKey = strings.ToUpper(strings.TrimSpace(indexKey))
	if indexKey == "" || tsMinute <= 0 {
		return nil, nil
	}
	if err := r.ensureIndexMoversTable(ctx); err != nil {
		return nil, err
	}
	if limit <= 0 {
		limit = 50
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT rank_no, symbol, per_change, per_to_index, point_to_index
		FROM index_movers_1m
		WHERE index_key = ? AND ts_minute = ?
		ORDER BY rank_no ASC
		LIMIT ?
	`, indexKey, tsMinute, limit)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "index_movers_1m") {
			return nil, nil
		}
		return nil, err
	}
	defer rows.Close()

	out := make([]ImpactRow, 0, limit)
	for rows.Next() {
		var rankNo int
		var symbol string
		var perChange float64
		var perToIndex sql.NullFloat64
		var pointToIndex sql.NullFloat64
		if err := rows.Scan(&rankNo, &symbol, &perChange, &perToIndex, &pointToIndex); err != nil {
			return nil, err
		}
		row := ImpactRow{
			Rank:   rankNo,
			Symbol: strings.ToUpper(strings.TrimSpace(symbol)),
			Metrics: Metrics{
				PerChange: perChange,
			},
		}
		if perToIndex.Valid {
			value := perToIndex.Float64
			row.Metrics.PerToIndex = &value
		}
		if pointToIndex.Valid {
			value := pointToIndex.Float64
			row.Metrics.PointToIndex = &value
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func parseIndexTokenFromEnv() uint32 {
	return parseIndexTokenFromEnvForIndex(indexKeyNifty50)
}

func parseIndexTokenFromEnvForIndex(indexKey string) uint32 {
	normalized := strings.ToUpper(strings.TrimSpace(indexKey))
	candidates := []string{
		"INDEX_TOKEN",
	}
	switch normalized {
	case "", indexKeyNifty50:
		candidates = append(candidates,
			"ZERODHA_NIFTY50_INSTRUMENT_TOKEN",
			"ZERODHA_NIFTY_INDEX_TOKEN",
		)
	case indexKeyNiftyBank:
		candidates = append(candidates,
			"ZERODHA_BANKNIFTY_INSTRUMENT_TOKEN",
			"ZERODHA_NIFTYBANK_INSTRUMENT_TOKEN",
		)
	case indexKeyFNO:
		candidates = append(candidates,
			"ZERODHA_NIFTY200_INSTRUMENT_TOKEN",
		)
	}
	for _, key := range candidates {
		raw := strings.TrimSpace(os.Getenv(key))
		if raw == "" {
			continue
		}
		parsed, err := strconv.ParseUint(raw, 10, 32)
		if err != nil {
			continue
		}
		if parsed > 0 {
			return uint32(parsed)
		}
	}
	if normalized == indexKeyNiftyBank {
		return 260105
	}
	if normalized == indexKeyFNO {
		return 0
	}
	return 256265
}

func fallbackZerodhaCredentials() ZerodhaCredentials {
	apiKey := firstNonEmptyEnv("ZERODHA_API_KEY", "API_KEY")
	accessToken := firstNonEmptyEnv("ZERODHA_ACCESS_TOKEN", "ZERODHA_ACCESSTOKEN", "ACCESSTOKEN")
	return ZerodhaCredentials{
		APIKey:      strings.TrimSpace(apiKey),
		AccessToken: strings.TrimSpace(accessToken),
	}
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		value := strings.TrimSpace(os.Getenv(key))
		if value != "" {
			return value
		}
	}
	return ""
}

func placeholders(count int) string {
	if count <= 0 {
		return ""
	}
	out := make([]string, count)
	for i := 0; i < count; i++ {
		out[i] = "?"
	}
	return strings.Join(out, ",")
}

func uniqueUpperSymbols(input []string) []string {
	if len(input) == 0 {
		return nil
	}
	seen := make(map[string]struct{}, len(input))
	out := make([]string, 0, len(input))
	for _, value := range input {
		symbol := strings.ToUpper(strings.TrimSpace(value))
		if symbol == "" {
			continue
		}
		if _, ok := seen[symbol]; ok {
			continue
		}
		seen[symbol] = struct{}{}
		out = append(out, symbol)
	}
	return out
}

func nullableFloat(value *float64) any {
	if value == nil {
		return nil
	}
	return *value
}
