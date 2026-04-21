package market

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	yahooChartBaseURL         = "https://query1.finance.yahoo.com/v8/finance/chart/"
	zerodhaBaseURL            = "https://api.kite.trade"
	zerodhaNiftyToken         = "256265"
	zerodhaBankNiftyToken     = "260105"
	nseNifty50ConstituentsURL = "https://www.nseindia.com/api/NextApi/apiClient/indexTrackerApi?functionName=getConstituents&&index=NIFTY%2050&&noofrecords=0"
	nseNifty50ContributionURL = "https://www.nseindia.com/api/NextApi/apiClient/indexTrackerApi?functionName=getContributionData&&index=NIFTY%2050&&noofrecords=0&&flag=1"
	nseNifty50FFMCURL         = "https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%2050"
	nseIndexFFMCBaseURL       = "https://www.nseindia.com/api/equity-stockIndices"
	riskFreeRate              = 0.065
	maxMoverWorkers           = 3
	enableMoverDebugLogging   = false
	optionStrikeStep          = 50.0
	optionStrikeDepth         = 10
	defaultOptionLot          = 50
	minuteDataRetentionDays   = 30
	retentionSweepInterval    = 6 * time.Hour
)

var (
	ErrNoCandles = errors.New("no candle data available")
)

type cachedCandles struct {
	candles    []Candle
	expiresAt  time.Time
	sourceName string
}

type cachedContributionSeries struct {
	snapshots map[int64]map[string]ContributionData
	expiresAt time.Time
}

type contributionBuildCall struct {
	done      chan struct{}
	snapshots map[int64]map[string]ContributionData
	err       error
}

type cachedOptionRange struct {
	response  OptionRangeResponse
	expiresAt time.Time
}

type indexConstituentWeight struct {
	Symbol string
	Name   string
	Weight float64
}

type indexContributionFactor struct {
	Symbol          string
	PointPerRupee   float64
	LastTradedPrice float64
	ClosePrice      float64
	ChangePoints    float64
	ChangePer       float64
}

type contributionIndexSpec struct {
	Key                    string
	ResponseSymbol         string
	NSEIndexName           string
	ZerodhaIndexAliases    []string
	ExpectedConstituentCnt int
}

type optionInstrument struct {
	Token         string
	TradingSymbol string
	Expiry        time.Time
	Strike        float64
	OptionType    string
	LotSize       int64
}

type optionInstrumentPair struct {
	Strike  float64
	Call    optionInstrument
	Put     optionInstrument
	HasCall bool
	HasPut  bool
}

type cachedOptionInstrumentSet struct {
	Expiry     time.Time
	ExpiryCode string
	Pairs      map[int64]optionInstrumentPair
	SortedKeys []int64
	CachedAt   time.Time
}

type Service struct {
	db *sql.DB

	httpClient *http.Client

	cacheMu    sync.RWMutex
	chartCache map[string]cachedCandles

	contributionMu    sync.RWMutex
	contributionCache map[string]cachedContributionSeries
	buildMu           sync.Mutex
	buildInFlight     map[string]*contributionBuildCall

	optionRangeMu    sync.RWMutex
	optionRangeCache map[string]cachedOptionRange

	configMu sync.RWMutex

	zerodhaBaseURL         string
	zerodhaAPIKey          string
	zerodhaAPISecret       string
	zerodhaAccessToken     string
	zerodhaAccessTokenFile string
	zerodhaNiftyToken      string
	zerodhaBankNiftyToken  string
	zerodhaNifty200Token   string

	instrumentMu                sync.RWMutex
	zerodhaInstrumentTokens     map[string]string
	zerodhaInstrumentCacheAtUTC time.Time

	weightsMu              sync.RWMutex
	nifty50Weights         []indexConstituentWeight
	nifty50WeightsCachedAt time.Time
	indexWeights           map[string][]indexConstituentWeight
	indexWeightsCachedAt   map[string]time.Time

	optionMu            sync.RWMutex
	optionHistory       []OptionSnapshotResponse
	optionLastFetch     time.Time
	optionInterval      time.Duration
	optionIntervalLabel string
	optionInstrumentMu  sync.RWMutex
	optionInstruments   cachedOptionInstrumentSet
	indiaLocation       *time.Location
}

func NewService() *Service {
	location, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		location = time.FixedZone("IST", 5*60*60+30*60)
	}

	apiKey := firstNonEmptyEnv("ZERODHA_API_KEY", "API_KEY")
	apiSecret := firstNonEmptyEnv("ZERODHA_API_SECRET", "SECRET")
	accessToken := firstNonEmptyEnv("ZERODHA_ACCESS_TOKEN", "ZERODHA_ACCESSTOKEN", "ACCESSTOKEN")
	accessTokenFile := firstNonEmptyEnv("ZERODHA_ACCESS_TOKEN_FILE", "ACCESSTOKEN_FILE")
	if accessTokenFile == "" {
		accessTokenFile = ".env"
	}
	niftyToken := firstNonEmptyEnv("ZERODHA_NIFTY50_INSTRUMENT_TOKEN")
	if niftyToken == "" {
		niftyToken = zerodhaNiftyToken
	}
	bankNiftyToken := firstNonEmptyEnv("ZERODHA_BANKNIFTY_INSTRUMENT_TOKEN", "ZERODHA_NIFTYBANK_INSTRUMENT_TOKEN")
	if bankNiftyToken == "" {
		bankNiftyToken = zerodhaBankNiftyToken
	}
	nifty200Token := firstNonEmptyEnv("ZERODHA_NIFTY200_INSTRUMENT_TOKEN")
	baseURL := firstNonEmptyEnv("ZERODHA_BASE_URL")
	if baseURL == "" {
		baseURL = zerodhaBaseURL
	}
	optionInterval, optionIntervalLabel := parseOptionSnapshotInterval(firstNonEmptyEnv("OPTION_SNAPSHOT_INTERVAL"))

	service := &Service{
		httpClient:              &http.Client{Timeout: 15 * time.Second},
		chartCache:              make(map[string]cachedCandles),
		contributionCache:       make(map[string]cachedContributionSeries),
		buildInFlight:           make(map[string]*contributionBuildCall),
		optionRangeCache:        make(map[string]cachedOptionRange),
		zerodhaBaseURL:          strings.TrimRight(baseURL, "/"),
		zerodhaAPIKey:           apiKey,
		zerodhaAPISecret:        apiSecret,
		zerodhaAccessToken:      accessToken,
		zerodhaAccessTokenFile:  accessTokenFile,
		zerodhaNiftyToken:       niftyToken,
		zerodhaBankNiftyToken:   bankNiftyToken,
		zerodhaNifty200Token:    nifty200Token,
		zerodhaInstrumentTokens: map[string]string{},
		indexWeights:            map[string][]indexConstituentWeight{},
		indexWeightsCachedAt:    map[string]time.Time{},
		optionHistory:           make([]OptionSnapshotResponse, 0, 720),
		indiaLocation:           location,
		optionLastFetch:         time.Time{},
		optionInterval:          optionInterval,
		optionIntervalLabel:     optionIntervalLabel,
	}
	service.startOptionSnapshotCollector()
	service.startIndexSnapshotCollector()
	service.startMinuteDataRetentionWorker()
	return service
}

func (s *Service) SetDB(db *sql.DB) {
	s.db = db
}

func normalizeContributionIndex(raw string) (contributionIndexSpec, error) {
	normalized := strings.ToUpper(strings.TrimSpace(raw))
	normalized = strings.ReplaceAll(normalized, "-", "")
	normalized = strings.ReplaceAll(normalized, "_", "")
	normalized = strings.ReplaceAll(normalized, " ", "")

	switch normalized {
	case "", "NIFTY", "NIFTY50":
		return contributionIndexSpec{
			Key:                    "NIFTY50",
			ResponseSymbol:         "NIFTY50",
			NSEIndexName:           "NIFTY 50",
			ZerodhaIndexAliases:    []string{"NIFTY 50", "NIFTY50"},
			ExpectedConstituentCnt: 50,
		}, nil
	case "FNO", "NIFTY200":
		return contributionIndexSpec{
			Key:                    "NIFTY200",
			ResponseSymbol:         "NIFTY200",
			NSEIndexName:           "NIFTY 200",
			ZerodhaIndexAliases:    []string{"NIFTY 200", "NIFTY200"},
			ExpectedConstituentCnt: 200,
		}, nil
	case "BANKNIFTY", "NIFTYBANK":
		return contributionIndexSpec{
			Key:                    "BANKNIFTY",
			ResponseSymbol:         "BANKNIFTY",
			NSEIndexName:           "NIFTY BANK",
			ZerodhaIndexAliases:    []string{"NIFTY BANK", "BANKNIFTY"},
			ExpectedConstituentCnt: 12,
		}, nil
	default:
		return contributionIndexSpec{}, fmt.Errorf("unsupported contribution index: %s", raw)
	}
}

func nseIndexFFMCURL(indexName string) string {
	values := url.Values{}
	values.Set("index", strings.TrimSpace(indexName))
	return fmt.Sprintf("%s?%s", nseIndexFFMCBaseURL, values.Encode())
}

func parseOptionSnapshotInterval(raw string) (time.Duration, string) {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "3m", "3min", "3minute":
		return 3 * time.Minute, "3m"
	default:
		return 1 * time.Minute, "1m"
	}
}

func (s *Service) startOptionSnapshotCollector() {
	interval := s.optionInterval
	if interval <= 0 {
		interval = time.Minute
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			_ = s.captureLiveOptionSnapshot(ctx)
			cancel()
			<-ticker.C
		}
	}()
}

func (s *Service) startIndexSnapshotCollector() {
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()

		for {
			ctx, cancel := context.WithTimeout(context.Background(), 12*time.Second)
			if err := s.captureAndPersistIndexSnapshots(ctx); err != nil && !errors.Is(err, ErrNoCandles) {
				log.Printf("[index_candles_1m] collector_error: %v", err)
			}
			cancel()
			<-ticker.C
		}
	}()
}

func (s *Service) startMinuteDataRetentionWorker() {
	go func() {
		// Run one sweep on startup, then periodic sweeps.
		s.runMinuteDataRetentionSweep()

		ticker := time.NewTicker(retentionSweepInterval)
		defer ticker.Stop()

		for range ticker.C {
			s.runMinuteDataRetentionSweep()
		}
	}()
}

func (s *Service) runMinuteDataRetentionSweep() {
	if s.db == nil {
		return
	}
	cutoffUnix := time.Now().UTC().AddDate(0, 0, -minuteDataRetentionDays).Unix()
	ctx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
	defer cancel()

	if err := s.cleanupMinuteDataOlderThan(ctx, cutoffUnix); err != nil {
		log.Printf("[minute_data_retention] cleanup_error cutoff=%d err=%v", cutoffUnix, err)
	}
}

func (s *Service) cleanupMinuteDataOlderThan(ctx context.Context, cutoffUnix int64) error {
	if s.db == nil || cutoffUnix <= 0 {
		return nil
	}
	tables := []string{
		"candles_1m",
		"movers_1m",
		"index_movers_1m",
		"index_candles_1m",
		"option_chain_1m",
	}
	for _, tableName := range tables {
		if _, err := s.db.ExecContext(ctx, fmt.Sprintf("DELETE FROM %s WHERE ts_minute < ?", tableName), cutoffUnix); err != nil {
			if isTableMissingError(err) {
				continue
			}
			return err
		}
	}
	return nil
}

func isTableMissingError(err error) bool {
	if err == nil {
		return false
	}
	message := strings.ToLower(err.Error())
	return strings.Contains(message, "doesn't exist") || strings.Contains(message, "unknown table")
}

func isIndianTradingDay(local time.Time) bool {
	switch local.Weekday() {
	case time.Saturday, time.Sunday:
		return false
	default:
		return true
	}
}

func (s *Service) latestClosedMarketMinuteIST(now time.Time) (int64, bool) {
	local := now.In(s.indiaLocation)
	if !isIndianTradingDay(local) {
		return 0, false
	}

	year, month, day := local.Date()
	sessionStart := time.Date(year, month, day, 9, 15, 0, 0, s.indiaLocation)
	sessionClose := time.Date(year, month, day, 15, 30, 0, 0, s.indiaLocation)

	// Only collect during market hours.
	if local.Before(sessionStart.Add(time.Minute)) || !local.Before(sessionClose) {
		return 0, false
	}

	closedMinute := local.Truncate(time.Minute).Add(-time.Minute)
	if closedMinute.Before(sessionStart) {
		return 0, false
	}

	return closedMinute.Unix(), true
}

func (s *Service) captureAndPersistIndexSnapshots(ctx context.Context) error {
	if s.db == nil {
		return nil
	}

	targetMinute, ok := s.latestClosedMarketMinuteIST(time.Now().UTC())
	if !ok || targetMinute <= 0 {
		return nil
	}

	from := time.Unix(targetMinute-60, 0).UTC()
	to := time.Unix(targetMinute, 0).UTC()
	indexKeys := []string{"NIFTY50", "BANKNIFTY", "NIFTY200"}

	var firstErr error
	for _, indexKey := range indexKeys {
		spec, specErr := normalizeContributionIndex(indexKey)
		if specErr != nil {
			if firstErr == nil {
				firstErr = specErr
			}
			continue
		}

		token, tokenErr := s.getContributionIndexToken(ctx, spec)
		if tokenErr != nil {
			if firstErr == nil {
				firstErr = tokenErr
			}
			continue
		}

		candles, source, candleErr := s.fetchZerodhaCandlesByToken(ctx, token, from, to, "1m")
		if candleErr != nil {
			if firstErr == nil {
				firstErr = candleErr
			}
			continue
		}
		if len(candles) == 0 {
			continue
		}

		selected := candles[len(candles)-1]
		for _, candle := range candles {
			if candle.Timestamp == targetMinute {
				selected = candle
				break
			}
		}
		if selected.Timestamp <= 0 {
			continue
		}

		if persistErr := s.persistIndexCandle1m(ctx, spec.Key, selected, source); persistErr != nil {
			if firstErr == nil {
				firstErr = persistErr
			}
		}
	}

	return firstErr
}

func (s *Service) persistIndexCandle1m(ctx context.Context, indexKey string, candle Candle, source string) error {
	if s.db == nil {
		return nil
	}
	normalizedIndexKey := strings.ToUpper(strings.TrimSpace(indexKey))
	if normalizedIndexKey == "" || candle.Timestamp <= 0 {
		return nil
	}
	if source = strings.TrimSpace(source); source == "" {
		source = "zerodha"
	}

	_, err := s.db.ExecContext(
		ctx,
		`INSERT INTO index_candles_1m (index_key, ts_minute, open, high, low, close, volume, source)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
		   open = VALUES(open),
		   high = VALUES(high),
		   low = VALUES(low),
		   close = VALUES(close),
		   volume = VALUES(volume),
		   source = VALUES(source),
		   updated_at = CURRENT_TIMESTAMP`,
		normalizedIndexKey,
		candle.Timestamp,
		candle.Open,
		candle.High,
		candle.Low,
		candle.Close,
		candle.Volume,
		source,
	)
	if err != nil && isTableMissingError(err) {
		return nil
	}
	return err
}

func (s *Service) persistOptionSnapshotToDB(ctx context.Context, snapshot OptionSnapshotResponse) error {
	if s.db == nil || snapshot.Timestamp <= 0 {
		return nil
	}
	if len(snapshot.Rows) == 0 {
		return nil
	}

	symbol := strings.ToUpper(strings.TrimSpace(snapshot.Symbol))
	if symbol == "" {
		symbol = "NIFTY"
	}
	expiry := strings.TrimSpace(snapshot.Expiry)
	source := strings.TrimSpace(snapshot.Source)
	if source == "" {
		source = "zerodha"
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO option_chain_1m (
			symbol, ts_minute, contract_key, expiry, strike, option_type,
			oi, volume, iv, ltp, underlying, source
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			expiry = VALUES(expiry),
			oi = VALUES(oi),
			volume = VALUES(volume),
			iv = VALUES(iv),
			ltp = VALUES(ltp),
			underlying = VALUES(underlying),
			source = VALUES(source),
			updated_at = CURRENT_TIMESTAMP
	`)
	if err != nil {
		if isTableMissingError(err) {
			return nil
		}
		return err
	}
	defer stmt.Close()

	for _, row := range snapshot.Rows {
		optionType := strings.ToUpper(strings.TrimSpace(row.Type))
		if optionType != "CE" && optionType != "PE" {
			continue
		}

		tsMinute := snapshot.Timestamp
		if row.Timestamp > 0 {
			tsMinute = row.Timestamp
		}
		rowExpiry := strings.TrimSpace(row.Expiry)
		if rowExpiry == "" {
			rowExpiry = expiry
		}
		contractKey := fmt.Sprintf("%s:%s:%.2f:%s", symbol, rowExpiry, row.Strike, optionType)

		if _, err := stmt.ExecContext(
			ctx,
			symbol,
			tsMinute,
			contractKey,
			rowExpiry,
			row.Strike,
			optionType,
			row.OI,
			row.Volume,
			row.IV,
			row.LTP,
			snapshot.Underlying,
			source,
		); err != nil {
			if isTableMissingError(err) {
				return nil
			}
			return err
		}
	}

	if err := tx.Commit(); err != nil {
		return err
	}
	return nil
}

func optionExpiryCodeFromDate(raw string, location *time.Location) string {
	value := strings.TrimSpace(raw)
	if value == "" {
		return ""
	}

	layouts := []string{
		"2006-01-02",
		"02-Jan-2006",
		"02 Jan 2006",
		"2006/01/02",
		"02/01/2006",
		"02-01-2006",
	}

	for _, layout := range layouts {
		parsed, err := time.ParseInLocation(layout, value, location)
		if err != nil {
			continue
		}
		return strings.ToUpper(parsed.Format("02Jan"))
	}

	return ""
}

func optionDataKey(symbol, expiry string, strike float64, optionType string, location *time.Location) string {
	normalizedSymbol := strings.ToUpper(strings.TrimSpace(symbol))
	if normalizedSymbol == "" {
		normalizedSymbol = "NIFTY"
	}
	normalizedType := strings.ToUpper(strings.TrimSpace(optionType))
	if normalizedType != "CE" && normalizedType != "PE" {
		return ""
	}
	strikeInt := int64(math.Round(strike))
	if strikeInt <= 0 {
		return ""
	}
	expiryCode := optionExpiryCodeFromDate(expiry, location)
	return fmt.Sprintf("NFO:%s%s%d%s", normalizedSymbol, expiryCode, strikeInt, normalizedType)
}

func (s *Service) loadOptionSnapshotFromDB(ctx context.Context, symbol string, tsMinute int64) (OptionSnapshotResponse, bool, error) {
	if s.db == nil || tsMinute <= 0 {
		return OptionSnapshotResponse{}, false, nil
	}

	normalizedSymbol := strings.ToUpper(strings.TrimSpace(symbol))
	if normalizedSymbol == "" {
		normalizedSymbol = "NIFTY"
	}

	rows, err := s.db.QueryContext(
		ctx,
		`SELECT ts_minute, expiry, strike, option_type, oi, volume, iv, ltp, underlying, source
		 FROM option_chain_1m
		 WHERE symbol = ? AND ts_minute = ?
		 ORDER BY strike ASC, option_type ASC`,
		normalizedSymbol,
		tsMinute,
	)
	if err != nil {
		if isTableMissingError(err) {
			return OptionSnapshotResponse{}, false, nil
		}
		return OptionSnapshotResponse{}, false, err
	}
	defer rows.Close()

	snapshot := OptionSnapshotResponse{
		Timestamp: tsMinute,
		Symbol:    normalizedSymbol,
		Source:    "db",
		Interval:  s.optionIntervalLabel,
		Data:      map[string]float64{},
		Rows:      make([]OptionChainRow, 0, 48),
		Strikes:   make([]OptionStrikeSnapshot, 0, 24),
	}
	strikeIndex := make(map[string]int)
	found := false

	for rows.Next() {
		var rowTS int64
		var expiry string
		var strike float64
		var optionType string
		var oi int64
		var volume int64
		var iv float64
		var ltp float64
		var underlying float64
		var source string

		if scanErr := rows.Scan(
			&rowTS,
			&expiry,
			&strike,
			&optionType,
			&oi,
			&volume,
			&iv,
			&ltp,
			&underlying,
			&source,
		); scanErr != nil {
			return OptionSnapshotResponse{}, false, scanErr
		}

		normalizedType := strings.ToUpper(strings.TrimSpace(optionType))
		if normalizedType != "CE" && normalizedType != "PE" {
			continue
		}

		found = true
		if rowTS > 0 {
			snapshot.Timestamp = rowTS
		}
		if strings.TrimSpace(snapshot.Expiry) == "" && strings.TrimSpace(expiry) != "" {
			snapshot.Expiry = strings.TrimSpace(expiry)
		}
		if strings.TrimSpace(snapshot.ExpiryCode) == "" {
			snapshot.ExpiryCode = optionExpiryCodeFromDate(expiry, s.indiaLocation)
		}
		if strings.TrimSpace(source) != "" {
			snapshot.Source = strings.TrimSpace(source)
		}
		if underlying > 0 {
			snapshot.Underlying = roundTo(underlying, 2)
		}

		row := OptionChainRow{
			Timestamp: snapshot.Timestamp,
			Symbol:    normalizedSymbol,
			Expiry:    strings.TrimSpace(expiry),
			Strike:    roundTo(strike, 2),
			Type:      normalizedType,
			OI:        oi,
			Volume:    volume,
			IV:        roundTo(iv, 4),
			LTP:       roundTo(ltp, 2),
		}
		snapshot.Rows = append(snapshot.Rows, row)

		strikeKey := fmt.Sprintf("%.2f", row.Strike)
		strikePos, exists := strikeIndex[strikeKey]
		if !exists {
			strikePos = len(snapshot.Strikes)
			strikeIndex[strikeKey] = strikePos
			snapshot.Strikes = append(snapshot.Strikes, OptionStrikeSnapshot{
				Strike: row.Strike,
			})
		}

		if normalizedType == "CE" {
			snapshot.Strikes[strikePos].Call = OptionLegMetrics{
				OI:     oi,
				Volume: volume,
				IV:     roundTo(iv, 4),
				LTP:    roundTo(ltp, 2),
			}
		} else {
			snapshot.Strikes[strikePos].Put = OptionLegMetrics{
				OI:     oi,
				Volume: volume,
				IV:     roundTo(iv, 4),
				LTP:    roundTo(ltp, 2),
			}
		}

		dataKey := optionDataKey(normalizedSymbol, expiry, row.Strike, normalizedType, s.indiaLocation)
		if dataKey != "" {
			snapshot.Data[dataKey] = optionDisplayOIValue(oi, defaultOptionLot)
		}
	}
	if err := rows.Err(); err != nil {
		return OptionSnapshotResponse{}, false, err
	}
	if !found || len(snapshot.Strikes) == 0 {
		return OptionSnapshotResponse{}, false, nil
	}

	sort.Slice(snapshot.Strikes, func(i, j int) bool {
		return snapshot.Strikes[i].Strike < snapshot.Strikes[j].Strike
	})
	sort.Slice(snapshot.Rows, func(i, j int) bool {
		if snapshot.Rows[i].Strike == snapshot.Rows[j].Strike {
			return snapshot.Rows[i].Type < snapshot.Rows[j].Type
		}
		return snapshot.Rows[i].Strike < snapshot.Rows[j].Strike
	})

	return snapshot, true, nil
}

func (s *Service) nearestOptionSnapshotTimestampFromDB(ctx context.Context, symbol string, targetUnix int64, maxDistanceSeconds int64) (int64, bool, error) {
	if s.db == nil || targetUnix <= 0 {
		return 0, false, nil
	}
	normalizedSymbol := strings.ToUpper(strings.TrimSpace(symbol))
	if normalizedSymbol == "" {
		normalizedSymbol = "NIFTY"
	}

	var prev sql.NullInt64
	prevErr := s.db.QueryRowContext(
		ctx,
		`SELECT MAX(ts_minute) FROM option_chain_1m WHERE symbol = ? AND ts_minute <= ?`,
		normalizedSymbol,
		targetUnix,
	).Scan(&prev)
	if prevErr != nil {
		if isTableMissingError(prevErr) {
			return 0, false, nil
		}
		return 0, false, prevErr
	}

	var next sql.NullInt64
	nextErr := s.db.QueryRowContext(
		ctx,
		`SELECT MIN(ts_minute) FROM option_chain_1m WHERE symbol = ? AND ts_minute >= ?`,
		normalizedSymbol,
		targetUnix,
	).Scan(&next)
	if nextErr != nil {
		if isTableMissingError(nextErr) {
			return 0, false, nil
		}
		return 0, false, nextErr
	}

	if !prev.Valid && !next.Valid {
		return 0, false, nil
	}

	chosen := int64(0)
	if prev.Valid && next.Valid {
		prevDistance := absInt64(prev.Int64 - targetUnix)
		nextDistance := absInt64(next.Int64 - targetUnix)
		if prevDistance <= nextDistance {
			chosen = prev.Int64
		} else {
			chosen = next.Int64
		}
	} else if prev.Valid {
		chosen = prev.Int64
	} else {
		chosen = next.Int64
	}

	if chosen <= 0 {
		return 0, false, nil
	}
	if maxDistanceSeconds > 0 && absInt64(chosen-targetUnix) > maxDistanceSeconds {
		return 0, false, nil
	}
	return chosen, true, nil
}

func (s *Service) getOptionSnapshotFromDBNearest(ctx context.Context, symbol string, targetUnix int64, maxDistanceSeconds int64) (OptionSnapshotResponse, bool, error) {
	ts, ok, err := s.nearestOptionSnapshotTimestampFromDB(ctx, symbol, targetUnix, maxDistanceSeconds)
	if err != nil || !ok {
		return OptionSnapshotResponse{}, false, err
	}
	return s.loadOptionSnapshotFromDB(ctx, symbol, ts)
}

func (s *Service) loadNearestOptionLegFromDB(
	ctx context.Context,
	symbol string,
	expiry string,
	strike float64,
	optionType string,
	targetUnix int64,
	maxDistanceSeconds int64,
) (OptionLegMetrics, bool, error) {
	if s.db == nil || targetUnix <= 0 {
		return OptionLegMetrics{}, false, nil
	}

	normalizedSymbol := strings.ToUpper(strings.TrimSpace(symbol))
	if normalizedSymbol == "" {
		normalizedSymbol = "NIFTY"
	}
	normalizedType := strings.ToUpper(strings.TrimSpace(optionType))
	if normalizedType != "CE" && normalizedType != "PE" {
		return OptionLegMetrics{}, false, nil
	}
	normalizedExpiry := strings.TrimSpace(expiry)
	if normalizedExpiry == "" {
		return OptionLegMetrics{}, false, nil
	}
	strikeValue := roundTo(strike, 2)
	if strikeValue <= 0 {
		return OptionLegMetrics{}, false, nil
	}

	type row struct {
		TS     int64
		OI     int64
		Volume int64
		IV     float64
		LTP    float64
	}

	loadRow := func(query string, args ...any) (row, bool, error) {
		var out row
		err := s.db.QueryRowContext(ctx, query, args...).Scan(
			&out.TS,
			&out.OI,
			&out.Volume,
			&out.IV,
			&out.LTP,
		)
		if err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return row{}, false, nil
			}
			if isTableMissingError(err) {
				return row{}, false, nil
			}
			return row{}, false, err
		}
		return out, true, nil
	}

	prevRow, hasPrev, prevErr := loadRow(
		`SELECT ts_minute, oi, volume, iv, ltp
		 FROM option_chain_1m
		 WHERE symbol = ? AND expiry = ? AND strike = ? AND option_type = ? AND ts_minute <= ?
		 ORDER BY ts_minute DESC
		 LIMIT 1`,
		normalizedSymbol,
		normalizedExpiry,
		strikeValue,
		normalizedType,
		targetUnix,
	)
	if prevErr != nil {
		return OptionLegMetrics{}, false, prevErr
	}

	nextRow, hasNext, nextErr := loadRow(
		`SELECT ts_minute, oi, volume, iv, ltp
		 FROM option_chain_1m
		 WHERE symbol = ? AND expiry = ? AND strike = ? AND option_type = ? AND ts_minute >= ?
		 ORDER BY ts_minute ASC
		 LIMIT 1`,
		normalizedSymbol,
		normalizedExpiry,
		strikeValue,
		normalizedType,
		targetUnix,
	)
	if nextErr != nil {
		return OptionLegMetrics{}, false, nextErr
	}

	if !hasPrev && !hasNext {
		return OptionLegMetrics{}, false, nil
	}

	chosen := row{}
	if hasPrev && hasNext {
		if absInt64(prevRow.TS-targetUnix) <= absInt64(nextRow.TS-targetUnix) {
			chosen = prevRow
		} else {
			chosen = nextRow
		}
	} else if hasPrev {
		chosen = prevRow
	} else {
		chosen = nextRow
	}

	if maxDistanceSeconds > 0 && absInt64(chosen.TS-targetUnix) > maxDistanceSeconds {
		return OptionLegMetrics{}, false, nil
	}

	metrics := OptionLegMetrics{
		OI:     chosen.OI,
		Volume: chosen.Volume,
		IV:     roundTo(chosen.IV, 4),
		LTP:    roundTo(chosen.LTP, 2),
	}
	if metrics.OI <= 0 && metrics.LTP <= 0 && metrics.Volume <= 0 {
		return OptionLegMetrics{}, false, nil
	}
	return metrics, true, nil
}

func (s *Service) optionSnapshotsBetweenFromDB(ctx context.Context, symbol string, startUnix, endUnix int64) ([]OptionSnapshotResponse, error) {
	if s.db == nil {
		return nil, nil
	}
	if endUnix < startUnix {
		startUnix, endUnix = endUnix, startUnix
	}
	if startUnix <= 0 || endUnix <= 0 {
		return nil, nil
	}

	normalizedSymbol := strings.ToUpper(strings.TrimSpace(symbol))
	if normalizedSymbol == "" {
		normalizedSymbol = "NIFTY"
	}

	queryRows, err := s.db.QueryContext(
		ctx,
		`SELECT ts_minute, expiry, strike, option_type, oi, volume, iv, ltp, underlying, source
		 FROM option_chain_1m
		 WHERE symbol = ? AND ts_minute BETWEEN ? AND ?
		 ORDER BY ts_minute ASC, strike ASC, option_type ASC`,
		normalizedSymbol,
		startUnix,
		endUnix,
	)
	if err != nil {
		if isTableMissingError(err) {
			return nil, nil
		}
		return nil, err
	}
	defer queryRows.Close()

	type builder struct {
		snapshot    OptionSnapshotResponse
		strikeIndex map[string]int
	}

	builders := make(map[int64]*builder)
	timestamps := make([]int64, 0, 512)

	ensureBuilder := func(ts int64) *builder {
		if existing, ok := builders[ts]; ok {
			return existing
		}
		created := &builder{
			snapshot: OptionSnapshotResponse{
				Timestamp: ts,
				Symbol:    normalizedSymbol,
				Source:    "db",
				Interval:  s.optionIntervalLabel,
				Data:      map[string]float64{},
				Rows:      make([]OptionChainRow, 0, 48),
				Strikes:   make([]OptionStrikeSnapshot, 0, 24),
			},
			strikeIndex: make(map[string]int),
		}
		builders[ts] = created
		timestamps = append(timestamps, ts)
		return created
	}

	for queryRows.Next() {
		var rowTS int64
		var expiry string
		var strike float64
		var optionType string
		var oi int64
		var volume int64
		var iv float64
		var ltp float64
		var underlying float64
		var source string

		if scanErr := queryRows.Scan(
			&rowTS,
			&expiry,
			&strike,
			&optionType,
			&oi,
			&volume,
			&iv,
			&ltp,
			&underlying,
			&source,
		); scanErr != nil {
			return nil, scanErr
		}

		normalizedType := strings.ToUpper(strings.TrimSpace(optionType))
		if normalizedType != "CE" && normalizedType != "PE" {
			continue
		}

		current := ensureBuilder(rowTS)
		if strings.TrimSpace(current.snapshot.Expiry) == "" && strings.TrimSpace(expiry) != "" {
			current.snapshot.Expiry = strings.TrimSpace(expiry)
		}
		if strings.TrimSpace(current.snapshot.ExpiryCode) == "" {
			current.snapshot.ExpiryCode = optionExpiryCodeFromDate(expiry, s.indiaLocation)
		}
		if strings.TrimSpace(source) != "" {
			current.snapshot.Source = strings.TrimSpace(source)
		}
		if underlying > 0 {
			current.snapshot.Underlying = roundTo(underlying, 2)
		}

		row := OptionChainRow{
			Timestamp: rowTS,
			Symbol:    normalizedSymbol,
			Expiry:    strings.TrimSpace(expiry),
			Strike:    roundTo(strike, 2),
			Type:      normalizedType,
			OI:        oi,
			Volume:    volume,
			IV:        roundTo(iv, 4),
			LTP:       roundTo(ltp, 2),
		}
		current.snapshot.Rows = append(current.snapshot.Rows, row)

		strikeKey := fmt.Sprintf("%.2f", row.Strike)
		strikePos, exists := current.strikeIndex[strikeKey]
		if !exists {
			strikePos = len(current.snapshot.Strikes)
			current.strikeIndex[strikeKey] = strikePos
			current.snapshot.Strikes = append(current.snapshot.Strikes, OptionStrikeSnapshot{
				Strike: row.Strike,
			})
		}
		if normalizedType == "CE" {
			current.snapshot.Strikes[strikePos].Call = OptionLegMetrics{
				OI:     oi,
				Volume: volume,
				IV:     roundTo(iv, 4),
				LTP:    roundTo(ltp, 2),
			}
		} else {
			current.snapshot.Strikes[strikePos].Put = OptionLegMetrics{
				OI:     oi,
				Volume: volume,
				IV:     roundTo(iv, 4),
				LTP:    roundTo(ltp, 2),
			}
		}

		dataKey := optionDataKey(normalizedSymbol, expiry, row.Strike, normalizedType, s.indiaLocation)
		if dataKey != "" {
			current.snapshot.Data[dataKey] = optionDisplayOIValue(oi, defaultOptionLot)
		}
	}
	if err := queryRows.Err(); err != nil {
		return nil, err
	}

	if len(timestamps) == 0 {
		return nil, nil
	}

	sort.Slice(timestamps, func(i, j int) bool {
		return timestamps[i] < timestamps[j]
	})

	output := make([]OptionSnapshotResponse, 0, len(timestamps))
	for _, ts := range timestamps {
		current := builders[ts]
		if current == nil || len(current.snapshot.Strikes) == 0 {
			continue
		}
		sort.Slice(current.snapshot.Strikes, func(i, j int) bool {
			return current.snapshot.Strikes[i].Strike < current.snapshot.Strikes[j].Strike
		})
		sort.Slice(current.snapshot.Rows, func(i, j int) bool {
			if current.snapshot.Rows[i].Strike == current.snapshot.Rows[j].Strike {
				return current.snapshot.Rows[i].Type < current.snapshot.Rows[j].Type
			}
			return current.snapshot.Rows[i].Strike < current.snapshot.Rows[j].Strike
		})
		output = append(output, current.snapshot)
	}

	return output, nil
}

func (s *Service) GetOHLC(ctx context.Context, symbol string, from, to time.Time, intervalRaw string) (OHLCResponse, error) {
	interval, intervalSeconds, err := normalizeInterval(intervalRaw)
	if err != nil {
		return OHLCResponse{}, err
	}

	resolved, err := ResolveSymbol(symbol)
	if err != nil {
		return OHLCResponse{}, err
	}

	from = from.UTC()
	to = to.UTC()

	if resolved.Symbol == niftyIndex.Symbol {
		zerodhaCandles, zerodhaSource, zerodhaErr := s.fetchZerodhaCandles(ctx, from, to, interval)
		if zerodhaErr == nil && len(zerodhaCandles) > 0 {
			return OHLCResponse{
				Symbol:   resolved.Symbol,
				Interval: interval,
				Source:   zerodhaSource,
				Candles:  zerodhaCandles,
			}, nil
		}
		if zerodhaErr != nil {
			return OHLCResponse{}, zerodhaErr
		}
	} else {
		instrumentTokens, tokenErr := s.getZerodhaInstrumentTokens(ctx)
		if tokenErr == nil {
			if instrumentToken := strings.TrimSpace(instrumentTokens[strings.ToUpper(strings.TrimSpace(resolved.Symbol))]); instrumentToken != "" {
				zerodhaCandles, zerodhaSource, zerodhaErr := s.fetchZerodhaCandlesByTokenCached(ctx, instrumentToken, from, to, interval)
				if zerodhaErr == nil && len(zerodhaCandles) > 0 {
					return OHLCResponse{
						Symbol:   resolved.Symbol,
						Interval: interval,
						Source:   zerodhaSource,
						Candles:  zerodhaCandles,
					}, nil
				}
			}
		}
	}

	padding := time.Duration(intervalSeconds*2) * time.Second
	rawCandles, source, err := s.fetchYahooCandles(ctx, resolved.Yahoo, from.Add(-padding), to.Add(padding))
	if err != nil {
		return OHLCResponse{}, err
	}

	aggregated := aggregateCandles(rawCandles, intervalSeconds)
	filtered := filterCandles(aggregated, from.Unix(), to.Unix())
	if len(filtered) == 0 {
		return OHLCResponse{}, ErrNoCandles
	}

	return OHLCResponse{
		Symbol:   resolved.Symbol,
		Interval: interval,
		Source:   source,
		Candles:  filtered,
	}, nil
}

func (s *Service) fetchZerodhaCandles(ctx context.Context, from, to time.Time, interval string) ([]Candle, string, error) {
	return s.fetchZerodhaCandlesByToken(ctx, s.zerodhaNiftyToken, from, to, interval)
}

func (s *Service) fetchZerodhaCandlesByToken(ctx context.Context, instrumentToken string, from, to time.Time, interval string) ([]Candle, string, error) {
	_, intervalSeconds, intervalErr := normalizeInterval(interval)
	if intervalErr != nil {
		return nil, "", intervalErr
	}

	kiteInterval, err := zerodhaInterval(interval)
	if err != nil {
		return nil, "", err
	}

	apiKey, accessToken, err := s.getZerodhaAuth()
	if err != nil {
		return nil, "", err
	}

	fromValue := from.In(s.indiaLocation).Format("2006-01-02 15:04:05")
	toValue := to.In(s.indiaLocation).Format("2006-01-02 15:04:05")
	values := url.Values{}
	values.Set("from", fromValue)
	values.Set("to", toValue)
	values.Set("continuous", "0")
	values.Set("oi", "0")

	requestURL := fmt.Sprintf(
		"%s/instruments/historical/%s/%s?%s",
		s.zerodhaBaseURL,
		url.PathEscape(strings.TrimSpace(instrumentToken)),
		url.PathEscape(kiteInterval),
		values.Encode(),
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, "", err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Kite-Version", "3")
	req.Header.Set("Authorization", fmt.Sprintf("token %s:%s", apiKey, accessToken))
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	var payload struct {
		Status    string `json:"status"`
		ErrorType string `json:"error_type"`
		Message   string `json:"message"`
		Data      struct {
			Candles [][]any `json:"candles"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, "", err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || strings.ToLower(payload.Status) == "error" {
		message := strings.TrimSpace(payload.Message)
		if message == "" {
			message = fmt.Sprintf("zerodha market data request failed (%d)", resp.StatusCode)
		}
		return nil, "", fmt.Errorf("%s", message)
	}

	candles := make([]Candle, 0, len(payload.Data.Candles))
	for _, row := range payload.Data.Candles {
		if len(row) < 6 {
			continue
		}

		ts, parseErr := parseKiteTimestamp(row[0])
		if parseErr != nil {
			continue
		}

		open, okOpen := anyToFloat64(row[1])
		high, okHigh := anyToFloat64(row[2])
		low, okLow := anyToFloat64(row[3])
		closePrice, okClose := anyToFloat64(row[4])
		volume, okVolume := anyToFloat64(row[5])
		if !okOpen || !okHigh || !okLow || !okClose || !okVolume {
			continue
		}

		tsUnix := ts.UTC().Unix()
		if intervalSeconds > 0 {
			tsUnix = (tsUnix / intervalSeconds) * intervalSeconds
		}
		if tsUnix < from.Unix() || tsUnix > to.Unix() {
			continue
		}

		candles = append(candles, Candle{
			Timestamp: tsUnix,
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closePrice,
			Volume:    int64(math.Round(volume)),
		})
	}

	if len(candles) == 0 {
		return nil, "", ErrNoCandles
	}

	sort.Slice(candles, func(i, j int) bool {
		return candles[i].Timestamp < candles[j].Timestamp
	})

	// Drop only the current in-progress bucket to avoid partial candles while still
	// showing today's first available candle early in the session.
	if intervalSeconds > 0 && len(candles) > 0 {
		currentBucketStart := (time.Now().UTC().Unix() / intervalSeconds) * intervalSeconds
		stableCutoff := currentBucketStart
		trimIndex := len(candles)
		for trimIndex > 0 && candles[trimIndex-1].Timestamp >= stableCutoff {
			trimIndex--
		}
		if trimIndex > 0 {
			candles = candles[:trimIndex]
		}
	}

	if len(candles) == 0 {
		return nil, "", ErrNoCandles
	}

	return candles, "zerodha", nil
}

func zerodhaCandlesCacheKey(instrumentToken string, from, to time.Time, interval string) string {
	return strings.Join([]string{
		"zerodha",
		strings.TrimSpace(instrumentToken),
		strings.TrimSpace(interval),
		strconv.FormatInt(from.UTC().Unix(), 10),
		strconv.FormatInt(to.UTC().Unix(), 10),
	}, "|")
}

func (s *Service) fetchZerodhaCandlesByTokenCached(ctx context.Context, instrumentToken string, from, to time.Time, interval string) ([]Candle, string, error) {
	cacheKey := zerodhaCandlesCacheKey(instrumentToken, from, to, interval)

	if cached, ok := s.getCachedCandles(cacheKey); ok {
		return cached.candles, cached.sourceName, nil
	}

	candles, source, err := s.fetchZerodhaCandlesByToken(ctx, instrumentToken, from, to, interval)
	if err != nil {
		return nil, "", err
	}

	s.setCachedCandles(cacheKey, cachedCandles{
		candles:    candles,
		expiresAt:  time.Now().Add(55 * time.Second),
		sourceName: source,
	})

	return candles, source, nil
}

func zerodhaInterval(interval string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(interval)) {
	case "1m":
		return "minute", nil
	case "3m":
		return "3minute", nil
	case "5m":
		return "5minute", nil
	case "15m":
		return "15minute", nil
	case "1h":
		return "60minute", nil
	default:
		return "", fmt.Errorf("unsupported interval for zerodha: %s", interval)
	}
}

func (s *Service) SetZerodhaCredentials(apiKey, apiSecret, accessToken string) {
	s.configMu.Lock()
	defer s.configMu.Unlock()

	if strings.TrimSpace(apiKey) != "" {
		s.zerodhaAPIKey = strings.TrimSpace(apiKey)
	}
	if strings.TrimSpace(apiSecret) != "" {
		s.zerodhaAPISecret = strings.TrimSpace(apiSecret)
	}
	if strings.TrimSpace(accessToken) != "" {
		s.zerodhaAccessToken = strings.TrimSpace(accessToken)
	}
}

func (s *Service) getZerodhaAuth() (string, string, error) {
	s.configMu.RLock()
	apiKey := strings.TrimSpace(s.zerodhaAPIKey)
	apiSecret := strings.TrimSpace(s.zerodhaAPISecret)
	accessToken := strings.TrimSpace(s.zerodhaAccessToken)
	accessTokenFile := strings.TrimSpace(s.zerodhaAccessTokenFile)
	s.configMu.RUnlock()

	fileAPIKey := ""
	fileAPISecret := ""
	fileAccessToken := ""
	if apiKey == "" || apiSecret == "" || accessToken == "" {
		fileAPIKey, fileAPISecret, fileAccessToken = readZerodhaCredentialsFromEnvFile(accessTokenFile)
	}
	if apiKey == "" && fileAPIKey != "" {
		apiKey = fileAPIKey
	}
	if apiKey == "" {
		apiKey = strings.TrimSpace(firstNonEmptyEnv("ZERODHA_API_KEY", "API_KEY"))
	}

	if accessToken == "" && fileAccessToken != "" {
		accessToken = fileAccessToken
	}
	if accessToken == "" {
		accessToken = strings.TrimSpace(firstNonEmptyEnv("ZERODHA_ACCESS_TOKEN", "ZERODHA_ACCESSTOKEN", "ACCESSTOKEN"))
	}
	if apiSecret == "" && fileAPISecret != "" {
		apiSecret = fileAPISecret
	}

	if apiKey == "" {
		return "", "", fmt.Errorf("zerodha api key is missing; set ZERODHA_API_KEY or API_KEY")
	}
	if accessToken == "" {
		return "", "", fmt.Errorf("zerodha access token is missing; update it daily from admin dashboard or api/.env")
	}

	return apiKey, accessToken, nil
}

func parseKiteTimestamp(raw any) (time.Time, error) {
	value, ok := raw.(string)
	if !ok {
		return time.Time{}, fmt.Errorf("invalid timestamp value")
	}

	layouts := []string{
		"2006-01-02T15:04:05-0700",
		time.RFC3339,
		"2006-01-02 15:04:05",
	}

	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, value); err == nil {
			return parsed, nil
		}
		if parsed, err := time.ParseInLocation(layout, value, time.UTC); err == nil {
			return parsed, nil
		}
	}

	return time.Time{}, fmt.Errorf("invalid kite timestamp")
}

func anyToFloat64(raw any) (float64, bool) {
	switch value := raw.(type) {
	case float64:
		return value, true
	case float32:
		return float64(value), true
	case int:
		return float64(value), true
	case int64:
		return float64(value), true
	case json.Number:
		parsed, err := value.Float64()
		return parsed, err == nil
	case string:
		parsed, err := strconv.ParseFloat(strings.TrimSpace(value), 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func firstNonEmptyEnv(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func readZerodhaCredentialsFromEnvFile(path string) (string, string, string) {
	content, err := os.ReadFile(path)
	if err != nil {
		return "", "", ""
	}

	apiKey := ""
	apiSecret := ""
	accessToken := ""

	lines := strings.Split(string(content), "\n")
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") || strings.HasPrefix(trimmed, "[") {
			continue
		}

		parts := strings.SplitN(trimmed, "=", 2)
		if len(parts) != 2 {
			continue
		}

		key := strings.TrimSpace(parts[0])
		value := strings.Trim(strings.TrimSpace(parts[1]), "\"'")
		switch {
		case strings.EqualFold(key, "ZERODHA_API_KEY") || strings.EqualFold(key, "API_KEY"):
			apiKey = value
		case strings.EqualFold(key, "ZERODHA_API_SECRET") || strings.EqualFold(key, "SECRET"):
			apiSecret = value
		case strings.EqualFold(key, "ZERODHA_ACCESS_TOKEN") || strings.EqualFold(key, "ZERODHA_ACCESSTOKEN") || strings.EqualFold(key, "ACCESSTOKEN"):
			accessToken = value
		}
	}

	return apiKey, apiSecret, accessToken
}

func (s *Service) marketSessionBoundsUTC(at time.Time) (time.Time, time.Time) {
	local := at.In(s.indiaLocation)
	year, month, day := local.Date()
	sessionStart := time.Date(year, month, day, 9, 15, 0, 0, s.indiaLocation)
	sessionEnd := time.Date(year, month, day, 15, 30, 0, 0, s.indiaLocation)
	return sessionStart.UTC(), sessionEnd.UTC()
}

func cloneStringMap(input map[string]string) map[string]string {
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func cloneIndexConstituentWeights(input []indexConstituentWeight) []indexConstituentWeight {
	output := make([]indexConstituentWeight, len(input))
	copy(output, input)
	return output
}

func fallbackNifty50Weights() []indexConstituentWeight {
	symbols := Constituents()
	if len(symbols) == 0 {
		return nil
	}

	weight := 100.0 / float64(len(symbols))
	output := make([]indexConstituentWeight, 0, len(symbols))
	for _, symbolInfo := range symbols {
		output = append(output, indexConstituentWeight{
			Symbol: symbolInfo.Symbol,
			Name:   symbolInfo.Name,
			Weight: weight,
		})
	}
	return output
}

func parseNSEFloat(value any) float64 {
	switch typed := value.(type) {
	case nil:
		return 0
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return 0
		}
		return typed
	case float32:
		value := float64(typed)
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return 0
		}
		return value
	case int:
		return float64(typed)
	case int64:
		return float64(typed)
	case json.Number:
		parsed, err := typed.Float64()
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0
		}
		return parsed
	case string:
		clean := strings.TrimSpace(strings.ReplaceAll(typed, ",", ""))
		if clean == "" || clean == "-" {
			return 0
		}
		parsed, err := strconv.ParseFloat(clean, 64)
		if err != nil || math.IsNaN(parsed) || math.IsInf(parsed, 0) {
			return 0
		}
		return parsed
	default:
		return 0
	}
}

func (s *Service) getNifty50ConstituentWeights(ctx context.Context) ([]indexConstituentWeight, error) {
	s.weightsMu.RLock()
	cached := cloneIndexConstituentWeights(s.nifty50Weights)
	cachedAt := s.nifty50WeightsCachedAt
	s.weightsMu.RUnlock()

	if len(cached) > 0 && time.Since(cachedAt) < 5*time.Minute {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, nseNifty50FFMCURL, nil)
	if err != nil {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")
	req.Header.Set("Referer", "https://www.nseindia.com/index-tracker/NIFTY%2050")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("nse nifty 50 constituents request failed (%d)", resp.StatusCode)
	}

	var payload struct {
		Data []struct {
			Symbol string `json:"symbol"`
			FFMC   any    `json:"ffmc"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, err
	}

	nameBySymbol := make(map[string]string, len(Constituents()))
	for _, symbolInfo := range Constituents() {
		symbol := strings.ToUpper(strings.TrimSpace(symbolInfo.Symbol))
		if symbol == "" {
			continue
		}
		nameBySymbol[symbol] = strings.TrimSpace(symbolInfo.Name)
	}

	ffmcBySymbol := make(map[string]float64, len(payload.Data))
	totalFFMC := 0.0
	for _, row := range payload.Data {
		symbol := strings.ToUpper(strings.TrimSpace(row.Symbol))
		if symbol == "" {
			continue
		}
		if symbol == "NIFTY 50" {
			continue
		}
		ffmc := parseNSEFloat(row.FFMC)
		if ffmc <= 0 {
			continue
		}
		ffmcBySymbol[symbol] = ffmc
		totalFFMC += ffmc
	}

	if len(ffmcBySymbol) == 0 || totalFFMC <= 0 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, ErrNoCandles
	}

	weights := make([]indexConstituentWeight, 0, len(ffmcBySymbol))
	for symbol, ffmc := range ffmcBySymbol {
		name := strings.TrimSpace(nameBySymbol[symbol])
		if name == "" {
			name = symbol
		}
		weightLivePct := (ffmc / totalFFMC) * 100.0
		if weightLivePct <= 0 || math.IsNaN(weightLivePct) || math.IsInf(weightLivePct, 0) {
			continue
		}
		weights = append(weights, indexConstituentWeight{
			Symbol: symbol,
			Name:   name,
			Weight: weightLivePct,
		})
	}

	if len(weights) == 0 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, ErrNoCandles
	}
	if len(weights) != 50 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("expected 50 nifty constituents from NSE ffmc feed, got %d", len(weights))
	}

	sort.Slice(weights, func(i, j int) bool {
		return weights[i].Symbol < weights[j].Symbol
	})

	s.weightsMu.Lock()
	s.nifty50Weights = cloneIndexConstituentWeights(weights)
	s.nifty50WeightsCachedAt = time.Now().UTC()
	s.weightsMu.Unlock()

	return weights, nil
}

func cloneIndexWeightCacheMap(input map[string][]indexConstituentWeight) map[string][]indexConstituentWeight {
	output := make(map[string][]indexConstituentWeight, len(input))
	for key, value := range input {
		output[key] = cloneIndexConstituentWeights(value)
	}
	return output
}

func (s *Service) getIndexConstituentWeights(ctx context.Context, spec contributionIndexSpec) ([]indexConstituentWeight, error) {
	if spec.Key == "NIFTY50" {
		return s.getNifty50ConstituentWeights(ctx)
	}

	s.weightsMu.RLock()
	cached := cloneIndexConstituentWeights(s.indexWeights[spec.Key])
	cachedAt := s.indexWeightsCachedAt[spec.Key]
	s.weightsMu.RUnlock()
	if len(cached) > 0 && time.Since(cachedAt) < 5*time.Minute {
		return cached, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, nseIndexFFMCURL(spec.NSEIndexName), nil)
	if err != nil {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")
	req.Header.Set("Referer", "https://www.nseindia.com/")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("nse %s constituents request failed (%d)", strings.ToLower(spec.Key), resp.StatusCode)
	}

	var payload struct {
		Data []struct {
			Symbol     string `json:"symbol"`
			Identifier string `json:"identifier"`
			FFMC       any    `json:"ffmc"`
			Meta       struct {
				CompanyName string `json:"companyName"`
			} `json:"meta"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, err
	}

	ffmcBySymbol := make(map[string]float64, len(payload.Data))
	nameBySymbol := make(map[string]string, len(payload.Data))
	totalFFMC := 0.0
	indexRowNameUpper := strings.ToUpper(strings.TrimSpace(spec.NSEIndexName))
	for _, row := range payload.Data {
		symbol := strings.ToUpper(strings.TrimSpace(row.Symbol))
		if symbol == "" {
			continue
		}
		if symbol == indexRowNameUpper || strings.EqualFold(symbol, spec.ResponseSymbol) {
			continue
		}

		ffmc := parseNSEFloat(row.FFMC)
		if ffmc <= 0 {
			continue
		}
		ffmcBySymbol[symbol] = ffmc
		totalFFMC += ffmc

		name := strings.TrimSpace(row.Meta.CompanyName)
		if name == "" {
			name = strings.TrimSpace(row.Identifier)
		}
		if name == "" {
			name = symbol
		}
		nameBySymbol[symbol] = name
	}

	if len(ffmcBySymbol) == 0 || totalFFMC <= 0 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, ErrNoCandles
	}

	weights := make([]indexConstituentWeight, 0, len(ffmcBySymbol))
	for symbol, ffmc := range ffmcBySymbol {
		weightLivePct := (ffmc / totalFFMC) * 100.0
		if weightLivePct <= 0 || math.IsNaN(weightLivePct) || math.IsInf(weightLivePct, 0) {
			continue
		}
		weights = append(weights, indexConstituentWeight{
			Symbol: symbol,
			Name:   strings.TrimSpace(nameBySymbol[symbol]),
			Weight: weightLivePct,
		})
	}

	if len(weights) == 0 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, ErrNoCandles
	}
	if spec.ExpectedConstituentCnt > 0 && len(weights) != spec.ExpectedConstituentCnt {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("expected %d constituents from %s ffmc feed, got %d", spec.ExpectedConstituentCnt, spec.Key, len(weights))
	}

	sort.Slice(weights, func(i, j int) bool {
		return weights[i].Symbol < weights[j].Symbol
	})

	s.weightsMu.Lock()
	s.indexWeights[spec.Key] = cloneIndexConstituentWeights(weights)
	s.indexWeightsCachedAt[spec.Key] = time.Now().UTC()
	s.weightsMu.Unlock()

	return weights, nil
}

func (s *Service) getContributionIndexToken(ctx context.Context, spec contributionIndexSpec) (string, error) {
	switch spec.Key {
	case "NIFTY50":
		if token := strings.TrimSpace(s.zerodhaNiftyToken); token != "" {
			return token, nil
		}
	case "BANKNIFTY":
		if token := strings.TrimSpace(s.zerodhaBankNiftyToken); token != "" {
			return token, nil
		}
	case "NIFTY200":
		if token := strings.TrimSpace(s.zerodhaNifty200Token); token != "" {
			return token, nil
		}
	}

	instrumentTokens, err := s.getZerodhaInstrumentTokens(ctx)
	if err != nil {
		return "", err
	}
	for _, alias := range spec.ZerodhaIndexAliases {
		key := strings.ToUpper(strings.TrimSpace(alias))
		if key == "" {
			continue
		}
		if token := strings.TrimSpace(instrumentTokens[key]); token != "" {
			return token, nil
		}
	}

	return "", fmt.Errorf("zerodha instrument token not found for %s", spec.NSEIndexName)
}

func (s *Service) getNifty50ContributionFactors(ctx context.Context) (map[string]indexContributionFactor, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, nseNifty50ContributionURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")
	req.Header.Set("Referer", "https://www.nseindia.com/index-tracker/NIFTY%2050")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("nse nifty 50 contribution request failed (%d)", resp.StatusCode)
	}

	var payload struct {
		Data []struct {
			Symbol          string  `json:"icSymbol"`
			LastTradedPrice float64 `json:"lastTradedPrice"`
			ClosePrice      float64 `json:"closePrice"`
			ChangePer       float64 `json:"changePer"`
			ChangePoints    float64 `json:"changePoints"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, err
	}

	output := make(map[string]indexContributionFactor, len(payload.Data))
	for _, row := range payload.Data {
		symbol := strings.ToUpper(strings.TrimSpace(row.Symbol))
		if symbol == "" {
			continue
		}

		delta := row.LastTradedPrice - row.ClosePrice
		if !math.IsNaN(delta) && !math.IsInf(delta, 0) && math.Abs(delta) > 1e-9 {
			output[symbol] = indexContributionFactor{
				Symbol:          symbol,
				PointPerRupee:   row.ChangePoints / delta,
				LastTradedPrice: row.LastTradedPrice,
				ClosePrice:      row.ClosePrice,
				ChangePoints:    row.ChangePoints,
				ChangePer:       row.ChangePer,
			}
			continue
		}

		output[symbol] = indexContributionFactor{
			Symbol:          symbol,
			PointPerRupee:   0,
			LastTradedPrice: row.LastTradedPrice,
			ClosePrice:      row.ClosePrice,
			ChangePoints:    row.ChangePoints,
			ChangePer:       row.ChangePer,
		}
	}

	if len(output) == 0 {
		return nil, ErrNoCandles
	}

	return output, nil
}

func (s *Service) getZerodhaInstrumentTokens(ctx context.Context) (map[string]string, error) {
	s.instrumentMu.RLock()
	cached := cloneStringMap(s.zerodhaInstrumentTokens)
	cachedAt := s.zerodhaInstrumentCacheAtUTC
	s.instrumentMu.RUnlock()

	if len(cached) > 0 && time.Since(cachedAt) < 6*time.Hour {
		return cached, nil
	}

	apiKey, accessToken, err := s.getZerodhaAuth()
	if err != nil {
		return nil, err
	}

	requestURL := fmt.Sprintf("%s/instruments/NSE", s.zerodhaBaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, err
	}

	req.Header.Set("Accept", "text/csv")
	req.Header.Set("X-Kite-Version", "3")
	req.Header.Set("Authorization", fmt.Sprintf("token %s:%s", apiKey, accessToken))
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("zerodha instruments request failed (%d)", resp.StatusCode)
	}

	reader := csv.NewReader(resp.Body)
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, err
	}
	if len(rows) <= 1 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("zerodha instruments payload is empty")
	}

	header := make(map[string]int, len(rows[0]))
	for index, column := range rows[0] {
		normalized := strings.TrimSpace(strings.TrimPrefix(column, "\ufeff"))
		header[strings.ToLower(normalized)] = index
	}

	tokenIndex, okToken := header["instrument_token"]
	symbolIndex, okSymbol := header["tradingsymbol"]
	exchangeIndex, okExchange := header["exchange"]
	segmentIndex, okSegment := header["segment"]
	if !okToken || !okSymbol {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("zerodha instruments payload missing required columns")
	}

	instrumentTokens := make(map[string]string, 1800)
	for _, row := range rows[1:] {
		if tokenIndex >= len(row) || symbolIndex >= len(row) {
			continue
		}

		token := strings.TrimSpace(row[tokenIndex])
		symbol := strings.ToUpper(strings.TrimSpace(row[symbolIndex]))
		if token == "" || symbol == "" {
			continue
		}

		if okExchange && exchangeIndex < len(row) {
			if !strings.EqualFold(strings.TrimSpace(row[exchangeIndex]), "NSE") {
				continue
			}
		}

		if okSegment && segmentIndex < len(row) {
			segment := strings.TrimSpace(row[segmentIndex])
			if segment != "" && !strings.EqualFold(segment, "NSE") && !strings.EqualFold(segment, "INDICES") {
				continue
			}
		}

		instrumentTokens[symbol] = token
	}

	if len(instrumentTokens) == 0 {
		if len(cached) > 0 {
			return cached, nil
		}
		return nil, fmt.Errorf("zerodha instruments mapping is empty")
	}

	s.instrumentMu.Lock()
	s.zerodhaInstrumentTokens = cloneStringMap(instrumentTokens)
	s.zerodhaInstrumentCacheAtUTC = time.Now().UTC()
	s.instrumentMu.Unlock()

	return instrumentTokens, nil
}

func (s *Service) GetMovers(ctx context.Context, from, to time.Time, intervalRaw string, limit int) (MoversResponse, error) {
	_, _, err := normalizeInterval(intervalRaw)
	if err != nil {
		return MoversResponse{}, err
	}
	_ = limit

	from = from.UTC()
	to = to.UTC()
	if !to.After(from) {
		return MoversResponse{}, fmt.Errorf("to must be greater than from")
	}

	sessionStartUTC, _ := s.marketSessionBoundsUTC(from)
	snapshots, err := s.getOrBuildOneMinuteContributionSeries(ctx, sessionStartUTC)
	if err != nil {
		return MoversResponse{}, err
	}

	ts1SnapshotData, ok := contributionSnapshotAtOrNearest(snapshots, from.Unix())
	if !ok || len(ts1SnapshotData) == 0 {
		return MoversResponse{}, ErrNoCandles
	}

	ts2SnapshotData, ok := contributionSnapshotAtOrNearest(snapshots, to.Unix())
	if !ok || len(ts2SnapshotData) == 0 {
		return MoversResponse{}, ErrNoCandles
	}

	if constituents, weightsErr := s.getNifty50ConstituentWeights(ctx); weightsErr == nil && len(constituents) > 0 {
		for _, constituent := range constituents {
			symbol := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
			if symbol == "" {
				continue
			}
			if _, exists := ts1SnapshotData[symbol]; !exists {
				ts1SnapshotData[symbol] = ContributionData{}
			}
			if _, exists := ts2SnapshotData[symbol]; !exists {
				ts2SnapshotData[symbol] = ContributionData{}
			}
		}
	}

	if enableMoverDebugLogging {
		debugPrintMoverPerChange("ts1", from.Unix(), ts1SnapshotData)
		debugPrintMoverPerChange("ts2", to.Unix(), ts2SnapshotData)
	}

	return MoversResponse{
		TS1: map[int64]map[string]ContributionData{
			from.Unix(): cloneContributionDataMap(ts1SnapshotData),
		},
		TS2: map[int64]map[string]ContributionData{
			to.Unix(): cloneContributionDataMap(ts2SnapshotData),
		},
	}, nil
}

func (s *Service) GetContributionSeries(ctx context.Context, at time.Time, intervalRaw string, onlySelected bool) (ContributionSeriesResponse, error) {
	interval, _, err := normalizeInterval(intervalRaw)
	if err != nil {
		return ContributionSeriesResponse{}, err
	}

	at = at.UTC()
	sessionStartUTC, sessionEndUTC := s.marketSessionBoundsUTC(at)

	snapshots, err := s.getOrBuildContributionSeries(ctx, sessionStartUTC, interval)
	if err != nil {
		return ContributionSeriesResponse{}, err
	}

	indexCandles, sourceName, err := s.fetchZerodhaCandlesByTokenCached(ctx, s.zerodhaNiftyToken, sessionStartUTC, sessionEndUTC, interval)
	if err != nil {
		return ContributionSeriesResponse{}, err
	}
	if len(indexCandles) == 0 {
		return ContributionSeriesResponse{}, ErrNoCandles
	}

	filteredSnapshots := make(map[int64]map[string]ContributionData, len(indexCandles))
	for _, candle := range indexCandles {
		if snapshot, ok := snapshots[candle.Timestamp]; ok && len(snapshot) > 0 {
			filteredSnapshots[candle.Timestamp] = cloneContributionDataMap(snapshot)
		}
	}
	if len(filteredSnapshots) == 0 {
		filteredSnapshots = cloneContributionSnapshots(snapshots)
	}
	if onlySelected && len(indexCandles) > 0 {
		targetUnix := at.UTC().Unix()
		selectedCandle := indexCandles[0]
		bestDiff := math.Abs(float64(selectedCandle.Timestamp - targetUnix))
		for _, candle := range indexCandles[1:] {
			diff := math.Abs(float64(candle.Timestamp - targetUnix))
			if diff < bestDiff {
				bestDiff = diff
				selectedCandle = candle
			}
		}

		selectedSnapshots := map[int64]map[string]ContributionData{}
		if snapshot, ok := filteredSnapshots[selectedCandle.Timestamp]; ok && len(snapshot) > 0 {
			selectedSnapshots[selectedCandle.Timestamp] = cloneContributionDataMap(snapshot)
		} else {
			selectedSnapshots[selectedCandle.Timestamp] = map[string]ContributionData{}
		}

		filteredSnapshots = selectedSnapshots
		indexCandles = []Candle{selectedCandle}
	}
	firstSnapshotTimestamp := int64(0)
	for ts := range filteredSnapshots {
		if firstSnapshotTimestamp == 0 || ts < firstSnapshotTimestamp {
			firstSnapshotTimestamp = ts
		}
	}

	constituentRows := make([]ContributionSeriesConstituent, 0)
	weightSum := 0.0
	if !onlySelected {
		constituents, weightsErr := s.getNifty50ConstituentWeights(ctx)
		if weightsErr != nil || len(constituents) == 0 {
			localConstituents := Constituents()
			if len(localConstituents) == 0 {
				return ContributionSeriesResponse{}, ErrNoCandles
			}
			equalWeight := 100.0 / float64(len(localConstituents))
			constituents = make([]indexConstituentWeight, 0, len(localConstituents))
			for _, item := range localConstituents {
				constituents = append(constituents, indexConstituentWeight{
					Symbol: item.Symbol,
					Name:   item.Name,
					Weight: equalWeight,
				})
			}
		}

		quoteBySymbol := make(map[string]zerodhaQuoteRow, len(constituents))
		if len(constituents) > 0 {
			quoteKeys := make([]string, 0, len(constituents))
			for _, constituent := range constituents {
				symbol := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
				if symbol == "" {
					continue
				}
				quoteKeys = append(quoteKeys, "NSE:"+symbol)
			}
			if quoteRows, quoteErr := s.fetchZerodhaQuotes(ctx, quoteKeys); quoteErr == nil {
				for key, row := range quoteRows {
					symbolKey := strings.ToUpper(strings.TrimSpace(key))
					if strings.HasPrefix(symbolKey, "NSE:") {
						symbolKey = strings.TrimPrefix(symbolKey, "NSE:")
					}
					if symbolKey == "" {
						continue
					}
					quoteBySymbol[symbolKey] = row
				}
			}
		}

		constituentRows = make([]ContributionSeriesConstituent, 0, len(constituents))
		for _, constituent := range constituents {
			symbol := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
			if symbol == "" {
				continue
			}
			weightValue := roundTo(constituent.Weight, 6)
			weightSum += weightValue
			quoteRow := quoteBySymbol[symbol]
			ltp := 0.0
			prevClose := 0.0
			if quoteRow.LastPrice > 0 {
				ltp = roundTo(quoteRow.LastPrice, 2)
			}
			if firstSnapshotTimestamp > 0 {
				if row, ok := filteredSnapshots[firstSnapshotTimestamp][symbol]; ok && row.SessionPrevClose > 0 {
					prevClose = roundTo(row.SessionPrevClose, 2)
				}
			}
			if prevClose <= 0 && quoteRow.OHLCClose > 0 {
				prevClose = roundTo(quoteRow.OHLCClose, 2)
			}
			constituentRows = append(constituentRows, ContributionSeriesConstituent{
				Symbol:           symbol,
				Name:             strings.TrimSpace(constituent.Name),
				Weight:           weightValue,
				LTP:              ltp,
				PreviousDayClose: prevClose,
			})
		}
		sort.Slice(constituentRows, func(i, j int) bool {
			return constituentRows[i].Symbol < constituentRows[j].Symbol
		})
	}

	return ContributionSeriesResponse{
		Symbol:                "NIFTY50",
		Interval:              interval,
		Source:                sourceName,
		GeneratedAt:           time.Now().UTC().Unix(),
		SessionStartTimestamp: sessionStartUTC.Unix(),
		SessionEndTimestamp:   sessionEndUTC.Unix(),
		WeightSum:             roundTo(weightSum, 6),
		Constituents:          constituentRows,
		IndexCandles:          indexCandles,
		Snapshots:             filteredSnapshots,
	}, nil
}

func (s *Service) GetContributionSeriesForIndex(ctx context.Context, symbol string, at time.Time, intervalRaw string, onlySelected bool) (ContributionSeriesResponse, error) {
	spec, err := normalizeContributionIndex(symbol)
	if err != nil {
		return ContributionSeriesResponse{}, err
	}
	if spec.Key == "NIFTY50" {
		return s.GetContributionSeries(ctx, at, intervalRaw, onlySelected)
	}

	interval, _, err := normalizeInterval(intervalRaw)
	if err != nil {
		return ContributionSeriesResponse{}, err
	}

	at = at.UTC()
	sessionStartUTC, sessionEndUTC := s.marketSessionBoundsUTC(at)
	snapshots, err := s.getOrBuildContributionSeriesForIndex(ctx, spec, sessionStartUTC, interval)
	if err != nil {
		return ContributionSeriesResponse{}, err
	}

	indexToken, err := s.getContributionIndexToken(ctx, spec)
	if err != nil {
		return ContributionSeriesResponse{}, err
	}
	indexCandles, sourceName, err := s.fetchZerodhaCandlesByTokenCached(ctx, indexToken, sessionStartUTC, sessionEndUTC, interval)
	if err != nil {
		return ContributionSeriesResponse{}, err
	}
	if len(indexCandles) == 0 {
		return ContributionSeriesResponse{}, ErrNoCandles
	}

	filteredSnapshots := make(map[int64]map[string]ContributionData, len(indexCandles))
	for _, candle := range indexCandles {
		if snapshot, ok := snapshots[candle.Timestamp]; ok && len(snapshot) > 0 {
			filteredSnapshots[candle.Timestamp] = cloneContributionDataMap(snapshot)
		}
	}
	if len(filteredSnapshots) == 0 {
		filteredSnapshots = cloneContributionSnapshots(snapshots)
	}

	if onlySelected && len(indexCandles) > 0 {
		targetUnix := at.UTC().Unix()
		selectedCandle := indexCandles[0]
		bestDiff := math.Abs(float64(selectedCandle.Timestamp - targetUnix))
		for _, candle := range indexCandles[1:] {
			diff := math.Abs(float64(candle.Timestamp - targetUnix))
			if diff < bestDiff {
				bestDiff = diff
				selectedCandle = candle
			}
		}
		selectedSnapshots := map[int64]map[string]ContributionData{}
		if snapshot, ok := filteredSnapshots[selectedCandle.Timestamp]; ok && len(snapshot) > 0 {
			selectedSnapshots[selectedCandle.Timestamp] = cloneContributionDataMap(snapshot)
		} else {
			selectedSnapshots[selectedCandle.Timestamp] = map[string]ContributionData{}
		}
		filteredSnapshots = selectedSnapshots
		indexCandles = []Candle{selectedCandle}
	}

	firstSnapshotTimestamp := int64(0)
	for ts := range filteredSnapshots {
		if firstSnapshotTimestamp == 0 || ts < firstSnapshotTimestamp {
			firstSnapshotTimestamp = ts
		}
	}

	constituentRows := make([]ContributionSeriesConstituent, 0)
	weightSum := 0.0
	if !onlySelected {
		constituents, weightsErr := s.getIndexConstituentWeights(ctx, spec)
		if weightsErr != nil || len(constituents) == 0 {
			return ContributionSeriesResponse{}, ErrNoCandles
		}

		quoteBySymbol := make(map[string]zerodhaQuoteRow, len(constituents))
		quoteKeys := make([]string, 0, len(constituents))
		for _, constituent := range constituents {
			sym := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
			if sym == "" {
				continue
			}
			quoteKeys = append(quoteKeys, "NSE:"+sym)
		}
		if len(quoteKeys) > 0 {
			if quoteRows, quoteErr := s.fetchZerodhaQuotes(ctx, quoteKeys); quoteErr == nil {
				for key, row := range quoteRows {
					symbolKey := strings.ToUpper(strings.TrimSpace(key))
					if strings.HasPrefix(symbolKey, "NSE:") {
						symbolKey = strings.TrimPrefix(symbolKey, "NSE:")
					}
					if symbolKey == "" {
						continue
					}
					quoteBySymbol[symbolKey] = row
				}
			}
		}

		constituentRows = make([]ContributionSeriesConstituent, 0, len(constituents))
		for _, constituent := range constituents {
			sym := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
			if sym == "" {
				continue
			}
			weightValue := roundTo(constituent.Weight, 6)
			weightSum += weightValue
			quoteRow := quoteBySymbol[sym]
			ltp := 0.0
			prevClose := 0.0
			if quoteRow.LastPrice > 0 {
				ltp = roundTo(quoteRow.LastPrice, 2)
			}
			if firstSnapshotTimestamp > 0 {
				if row, ok := filteredSnapshots[firstSnapshotTimestamp][sym]; ok && row.SessionPrevClose > 0 {
					prevClose = roundTo(row.SessionPrevClose, 2)
				}
			}
			if prevClose <= 0 && quoteRow.OHLCClose > 0 {
				prevClose = roundTo(quoteRow.OHLCClose, 2)
			}
			constituentRows = append(constituentRows, ContributionSeriesConstituent{
				Symbol:           sym,
				Name:             strings.TrimSpace(constituent.Name),
				Weight:           weightValue,
				LTP:              ltp,
				PreviousDayClose: prevClose,
			})
		}
		sort.Slice(constituentRows, func(i, j int) bool {
			return constituentRows[i].Symbol < constituentRows[j].Symbol
		})
	}

	return ContributionSeriesResponse{
		Symbol:                spec.ResponseSymbol,
		Interval:              interval,
		Source:                sourceName,
		GeneratedAt:           time.Now().UTC().Unix(),
		SessionStartTimestamp: sessionStartUTC.Unix(),
		SessionEndTimestamp:   sessionEndUTC.Unix(),
		WeightSum:             roundTo(weightSum, 6),
		Constituents:          constituentRows,
		IndexCandles:          indexCandles,
		Snapshots:             filteredSnapshots,
	}, nil
}

func (s *Service) getOrBuildContributionSeriesForIndex(ctx context.Context, spec contributionIndexSpec, sessionStartUTC time.Time, intervalRaw string) (map[int64]map[string]ContributionData, error) {
	if spec.Key == "NIFTY50" {
		return s.getOrBuildContributionSeries(ctx, sessionStartUTC, intervalRaw)
	}

	interval, _, err := normalizeInterval(intervalRaw)
	if err != nil {
		return nil, err
	}

	sessionStartUTC = sessionStartUTC.UTC()
	cacheKey := contributionCacheKeyForIndex(spec.Key, sessionStartUTC, interval)

	if cached, ok, fresh := s.getCachedContributionSeriesWithFreshness(cacheKey); ok && len(cached.snapshots) > 0 && contributionSnapshotsHaveExtendedFields(cached.snapshots) {
		if fresh {
			return cached.snapshots, nil
		}
		s.refreshContributionSeriesAsyncForIndex(spec, sessionStartUTC, interval, cacheKey)
		return cached.snapshots, nil
	}

	series, buildErr := s.buildContributionSeriesCoalesced(ctx, cacheKey, func(buildCtx context.Context) (map[int64]map[string]ContributionData, error) {
		return s.buildContributionSeriesForIndex(buildCtx, spec, sessionStartUTC, interval)
	})
	if buildErr != nil {
		if cached, ok, _ := s.getCachedContributionSeriesWithFreshness(cacheKey); ok && len(cached.snapshots) > 0 {
			return cached.snapshots, nil
		}
		return nil, buildErr
	}

	s.cacheContributionSeriesForIndex(cacheKey, series)
	return cloneContributionSnapshots(series), nil
}

func (s *Service) refreshContributionSeriesAsyncForIndex(spec contributionIndexSpec, sessionStartUTC time.Time, interval, cacheKey string) {
	go func() {
		refreshCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()

		series, err := s.buildContributionSeriesCoalesced(refreshCtx, cacheKey, func(buildCtx context.Context) (map[int64]map[string]ContributionData, error) {
			return s.buildContributionSeriesForIndex(buildCtx, spec, sessionStartUTC, interval)
		})
		if err != nil || len(series) == 0 {
			return
		}

		s.cacheContributionSeriesForIndex(cacheKey, series)
	}()
}

func (s *Service) cacheContributionSeriesForIndex(cacheKey string, snapshots map[int64]map[string]ContributionData) {
	cloned := cloneContributionSnapshots(snapshots)
	s.setCachedContributionSeries(cacheKey, cachedContributionSeries{
		snapshots: cloned,
		expiresAt: time.Now().Add(55 * time.Second),
	})
}

func (s *Service) buildContributionSeriesForIndex(ctx context.Context, spec contributionIndexSpec, sessionStartUTC time.Time, interval string) (map[int64]map[string]ContributionData, error) {
	if spec.Key == "NIFTY50" {
		return s.buildContributionSeries(ctx, sessionStartUTC, interval)
	}

	interval, intervalSeconds, err := normalizeInterval(interval)
	if err != nil {
		return nil, err
	}

	constituents, err := s.getIndexConstituentWeights(ctx, spec)
	if err != nil {
		return nil, err
	}
	instrumentTokens, err := s.getZerodhaInstrumentTokens(ctx)
	if err != nil {
		return nil, err
	}
	indexToken, err := s.getContributionIndexToken(ctx, spec)
	if err != nil {
		return nil, err
	}

	_, sessionEndUTC := s.marketSessionBoundsUTC(sessionStartUTC)
	lookbackStartUTC := sessionStartUTC.Add(-96 * time.Hour)
	indexCandles, _, err := s.fetchZerodhaCandlesByTokenCached(ctx, indexToken, lookbackStartUTC, sessionEndUTC, interval)
	if err != nil {
		return nil, err
	}
	indexSessionCandles := filterCandles(indexCandles, sessionStartUTC.Unix(), sessionEndUTC.Unix())
	if len(indexSessionCandles) == 0 {
		return nil, ErrNoCandles
	}
	indexPrevCloseCandles := indexCandles
	if !strings.EqualFold(interval, "1m") {
		if candles1m, _, err1m := s.fetchZerodhaCandlesByTokenCached(ctx, indexToken, lookbackStartUTC, sessionEndUTC, "1m"); err1m == nil && len(candles1m) > 0 {
			indexPrevCloseCandles = candles1m
		}
	}

	indexPreviousDayClose := 0.0
	if prevIndexCandle, prevOK := candleAtOrBefore(indexPrevCloseCandles, sessionStartUTC.Unix()-1); prevOK {
		indexPreviousDayClose = prevIndexCandle.Close
		if indexPreviousDayClose <= 0 {
			indexPreviousDayClose = prevIndexCandle.Open
		}
	}
	if indexPreviousDayClose <= 0 {
		indexPreviousDayClose = indexSessionCandles[0].Open
		if indexPreviousDayClose <= 0 {
			indexPreviousDayClose = indexSessionCandles[0].Close
		}
	}

	type workerResult struct {
		symbol        string
		contributions map[int64]ContributionData
	}

	workers := maxMoverWorkers
	if workers > len(constituents) {
		workers = len(constituents)
	}
	if workers <= 0 {
		return nil, ErrNoCandles
	}

	jobCh := make(chan indexConstituentWeight)
	resultCh := make(chan workerResult, len(constituents))
	var wg sync.WaitGroup
	rateTicker := time.NewTicker(350 * time.Millisecond)
	defer rateTicker.Stop()

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for constituent := range jobCh {
				symbol := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
				token := strings.TrimSpace(instrumentTokens[symbol])
				if token == "" {
					continue
				}

				cacheKey := zerodhaCandlesCacheKey(token, lookbackStartUTC, sessionEndUTC, interval)
				if _, isCached := s.getCachedCandles(cacheKey); !isCached {
					select {
					case <-ctx.Done():
						return
					case <-rateTicker.C:
					}
				}

				candles, _, candleErr := s.fetchZerodhaCandlesByTokenCached(ctx, token, lookbackStartUTC, sessionEndUTC, interval)
				if candleErr != nil || len(candles) == 0 {
					continue
				}
				prevCloseCandles := candles
				if !strings.EqualFold(interval, "1m") {
					prevCloseCacheKey := zerodhaCandlesCacheKey(token, lookbackStartUTC, sessionEndUTC, "1m")
					if _, isCached := s.getCachedCandles(prevCloseCacheKey); !isCached {
						select {
						case <-ctx.Done():
							return
						case <-rateTicker.C:
						}
					}
					if candles1m, _, err1m := s.fetchZerodhaCandlesByTokenCached(ctx, token, lookbackStartUTC, sessionEndUTC, "1m"); err1m == nil && len(candles1m) > 0 {
						prevCloseCandles = candles1m
					}
				}

				previousDayClose := 0.0
				if previousCandle, previousOK := candleAtOrBefore(prevCloseCandles, sessionStartUTC.Unix()-1); previousOK && previousCandle.Close > 0 {
					previousDayClose = previousCandle.Close
				}
				if previousDayClose <= 0 {
					continue
				}

				sessionCandles := filterCandles(candles, sessionStartUTC.Unix(), sessionEndUTC.Unix())
				if len(sessionCandles) == 0 {
					continue
				}

				contributionByTimestamp := make(map[int64]ContributionData, len(sessionCandles))
				for _, candle := range sessionCandles {
					currentClose := candle.Close
					if currentClose <= 0 {
						currentClose = candle.Open
					}
					if currentClose <= 0 {
						continue
					}
					snapshotPrice := currentClose
					sourceTimestamp := candle.Timestamp

					indexCandle, indexOK := candleAtOrBeforeOrAfter(indexSessionCandles, candle.Timestamp)
					if !indexOK {
						continue
					}
					indexValue := indexCandle.Close
					if indexValue <= 0 {
						indexValue = indexCandle.Open
					}
					if indexValue <= 0 {
						continue
					}

					perChange := ((snapshotPrice - previousDayClose) / previousDayClose) * 100.0
					pointBase := indexPreviousDayClose
					if pointBase <= 0 {
						pointBase = indexValue
					}
					perToIndex := perChange * (constituent.Weight / 100.0)
					pointToIndex := 0.0
					if pointBase > 0 {
						pointToIndex = (perToIndex / 100.0) * pointBase
					}

					openValue := candle.Open
					if openValue <= 0 {
						openValue = currentClose
					}

					contributionByTimestamp[candle.Timestamp] = ContributionData{
						PerChange:        roundTo(perChange, 4),
						PerToIndex:       roundTo(perToIndex, 6),
						PointToIndex:     roundTo(pointToIndex, 4),
						Open:             roundTo(openValue, 2),
						Close:            roundTo(snapshotPrice, 2),
						SessionPrevClose: roundTo(previousDayClose, 2),
						Weight:           roundTo(constituent.Weight, 6),
						SourceTimestamp:  sourceTimestamp,
						Exact:            true,
					}
				}

				if len(contributionByTimestamp) == 0 {
					continue
				}

				resultCh <- workerResult{
					symbol:        symbol,
					contributions: contributionByTimestamp,
				}
			}
		}()
	}

	for _, constituent := range constituents {
		jobCh <- constituent
	}
	close(jobCh)
	wg.Wait()
	close(resultCh)

	seriesBySymbol := make(map[string]map[int64]ContributionData, len(constituents))
	for result := range resultCh {
		if len(result.contributions) == 0 {
			continue
		}
		seriesBySymbol[strings.ToUpper(strings.TrimSpace(result.symbol))] = result.contributions
	}
	if len(seriesBySymbol) == 0 {
		return nil, ErrNoCandles
	}

	sessionTimestamps := make([]int64, 0, len(indexSessionCandles))
	for _, candle := range indexSessionCandles {
		sessionTimestamps = append(sessionTimestamps, candle.Timestamp)
	}
	sort.Slice(sessionTimestamps, func(i, j int) bool { return sessionTimestamps[i] < sessionTimestamps[j] })

	snapshots := make(map[int64]map[string]ContributionData, len(sessionTimestamps))
	for _, ts := range sessionTimestamps {
		snapshots[ts] = make(map[string]ContributionData, len(constituents))
	}

	for _, constituent := range constituents {
		symbol := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
		if symbol == "" {
			continue
		}
		series := seriesBySymbol[symbol]
		if len(series) == 0 {
			continue
		}
		seriesTimestamps := sortedContributionTimestamps(series)
		if len(seriesTimestamps) == 0 {
			continue
		}

		for _, timestamp := range sessionTimestamps {
			nearestTimestamp, ok := nearestTimestampFromSorted(seriesTimestamps, timestamp, intervalSeconds)
			if !ok {
				continue
			}
			data, exists := series[nearestTimestamp]
			if !exists {
				continue
			}
			if nearestTimestamp > timestamp {
				fallbackPrice := data.Close
				if fallbackPrice <= 0 {
					fallbackPrice = data.Open
				}
				prevClose := data.SessionPrevClose
				if fallbackPrice > 0 && prevClose > 0 {
					perChange := ((fallbackPrice - prevClose) / prevClose) * 100.0
					pointBase := indexPreviousDayClose
					perToIndex := perChange * (constituent.Weight / 100.0)
					pointToIndex := 0.0
					if pointBase > 0 {
						pointToIndex = (perToIndex / 100.0) * pointBase
					}
					data.PerChange = roundTo(perChange, 4)
					data.PerToIndex = roundTo(perToIndex, 6)
					data.PointToIndex = roundTo(pointToIndex, 4)
					data.Close = roundTo(fallbackPrice, 2)
					data.Weight = roundTo(constituent.Weight, 6)
				}
			}
			data.Exact = nearestTimestamp == timestamp
			snapshots[timestamp][symbol] = data
		}
	}

	for timestamp, snapshot := range snapshots {
		if len(snapshot) == 0 {
			delete(snapshots, timestamp)
		}
	}
	if len(snapshots) == 0 {
		return nil, ErrNoCandles
	}

	return snapshots, nil
}

func debugPrintMoverPerChange(label string, ts int64, snapshot map[string]ContributionData) {
	if len(snapshot) == 0 {
		fmt.Printf("%s (%d): no mover data\n", label, ts)
		return
	}

	symbols := make([]string, 0, len(snapshot))
	for symbol := range snapshot {
		symbols = append(symbols, symbol)
	}
	sort.Strings(symbols)

	fmt.Printf("%s (%d) mover snapshot:\n", label, ts)
	for _, symbol := range symbols {
		row := snapshot[symbol]
		fmt.Printf(
			"  %s: {per_change: %.4f, per_to_index: %.6f, point_to_index: %.4f}\n",
			symbol,
			row.PerChange,
			row.PerToIndex,
			row.PointToIndex,
		)
	}
}

func normalizeOptionSymbol(symbol string) (string, error) {
	normalized := strings.ToUpper(strings.TrimSpace(symbol))
	if normalized == "" {
		normalized = "NIFTY"
	}
	if normalized == "NIFTY50" {
		normalized = "NIFTY"
	}
	if normalized != "NIFTY" {
		return "", fmt.Errorf("unsupported option symbol: %s", symbol)
	}
	return normalized, nil
}

func (s *Service) getOptionSnapshotRaw(ctx context.Context, symbol string, at time.Time) (OptionSnapshotResponse, error) {
	normalizedSymbol, err := normalizeOptionSymbol(symbol)
	if err != nil {
		return OptionSnapshotResponse{}, err
	}

	targetUnix := at.UTC().Unix()
	maxDistanceSeconds := int64(180)
	if s.optionInterval > 0 {
		maxDistanceSeconds = int64((2 * s.optionInterval) / time.Second)
		if maxDistanceSeconds < 60 {
			maxDistanceSeconds = 60
		}
	}
	nowUnix := time.Now().UTC().Unix()
	isRecentRequest := absInt64(nowUnix-targetUnix) <= maxDistanceSeconds

	closest, hasClosest := s.closestOptionSnapshot(targetUnix)
	if hasClosest {
		closestDistance := absInt64(closest.Timestamp - targetUnix)
		// For recent requests, prefer the nearest cached snapshot immediately to avoid
		// blocking on live capture/historical rebuild during UI executes.
		if isRecentRequest && closestDistance <= maxDistanceSeconds {
			return closest, nil
		}
	}

	var captureErr error
	if isRecentRequest {
		captureErr = s.captureLiveOptionSnapshot(ctx)
		if captureErr != nil {
			if _, ok := s.getLatestOptionSnapshot(); !ok && !hasClosest {
				return OptionSnapshotResponse{}, captureErr
			}
		}
	}

	closest, hasClosest = s.closestOptionSnapshot(targetUnix)
	if hasClosest && closest.Timestamp == targetUnix {
		sourceLower := strings.ToLower(strings.TrimSpace(closest.Source))
		if isRecentRequest || strings.Contains(sourceLower, "historical") {
			return closest, nil
		}
	}
	if hasClosest && isRecentRequest && absInt64(closest.Timestamp-targetUnix) <= maxDistanceSeconds {
		return closest, nil
	}

	historicalSnapshot, historicalErr := s.buildOptionSnapshotFromHistorical(ctx, at.UTC())
	if historicalErr == nil {
		s.storeOptionSnapshot(historicalSnapshot)
		return historicalSnapshot, nil
	}

	if hasClosest && absInt64(closest.Timestamp-targetUnix) <= maxDistanceSeconds {
		return closest, nil
	}
	if captureErr != nil {
		return OptionSnapshotResponse{}, captureErr
	}
	if historicalErr != nil {
		dbSnapshot, hasDBSnapshot, dbErr := s.getOptionSnapshotFromDBNearest(ctx, normalizedSymbol, targetUnix, maxDistanceSeconds)
		if dbErr != nil {
			log.Printf("[option_chain_1m] nearest_lookup_error symbol=%s target=%d err=%v", normalizedSymbol, targetUnix, dbErr)
		}
		if hasDBSnapshot {
			return dbSnapshot, nil
		}
		return OptionSnapshotResponse{}, historicalErr
	}
	return OptionSnapshotResponse{}, ErrNoCandles
}

func (s *Service) GetOptionSnapshot(ctx context.Context, symbol string, at time.Time) (OptionSnapshotResponse, error) {
	rawSnapshot, err := s.getOptionSnapshotRaw(ctx, symbol, at)
	if err != nil {
		return OptionSnapshotResponse{}, err
	}
	return trimOptionSnapshotAroundATM(rawSnapshot, 10), nil
}

func (s *Service) GetOptionSnapshotHistorical(ctx context.Context, symbol string, at time.Time) (OptionSnapshotResponse, error) {
	normalizedSymbol, err := normalizeOptionSymbol(symbol)
	if err != nil {
		return OptionSnapshotResponse{}, err
	}

	targetUnix := optionSnapshotTimestamp(at.UTC().Unix(), s.optionInterval)
	if targetUnix <= 0 {
		targetUnix = at.UTC().Unix()
	}

	dbSnapshot, ok, dbErr := s.loadOptionSnapshotFromDB(ctx, normalizedSymbol, targetUnix)
	if dbErr != nil {
		log.Printf("[option_chain_1m] exact_lookup_error symbol=%s ts=%d err=%v", normalizedSymbol, targetUnix, dbErr)
	}
	if ok {
		return trimOptionSnapshotAroundATM(dbSnapshot, 10), nil
	}

	snapshot, buildErr := s.buildOptionSnapshotFromHistorical(ctx, time.Unix(targetUnix, 0).UTC())
	if buildErr == nil {
		s.storeOptionSnapshot(snapshot)
		return trimOptionSnapshotAroundATM(snapshot, 10), nil
	}

	// Fall back to default snapshot flow if historical fetch fails.
	rawSnapshot, rawErr := s.getOptionSnapshotRaw(ctx, normalizedSymbol, at)
	if rawErr == nil {
		return trimOptionSnapshotAroundATM(rawSnapshot, 10), nil
	}
	return OptionSnapshotResponse{}, buildErr
}

func (s *Service) GetOptionDiff(ctx context.Context, symbol string, from, to time.Time, limit int) (OptionDiffResponse, error) {
	normalizedSymbol, err := normalizeOptionSymbol(symbol)
	if err != nil {
		return OptionDiffResponse{}, err
	}

	if limit <= 0 {
		limit = 10
	}
	if limit > 21 {
		limit = 21
	}

	from = from.UTC()
	to = to.UTC()

	fromSnapshot, err := s.getOptionSnapshotRaw(ctx, normalizedSymbol, from)
	if err != nil {
		return OptionDiffResponse{}, err
	}

	toSnapshot, err := s.getOptionSnapshotRaw(ctx, normalizedSymbol, to)
	if err != nil {
		return OptionDiffResponse{}, err
	}

	fromByStrike := make(map[float64]OptionStrikeSnapshot, len(fromSnapshot.Strikes))
	toByStrike := make(map[float64]OptionStrikeSnapshot, len(toSnapshot.Strikes))

	for _, strike := range fromSnapshot.Strikes {
		fromByStrike[strike.Strike] = strike
	}
	for _, strike := range toSnapshot.Strikes {
		toByStrike[strike.Strike] = strike
	}

	diffs := make([]OptionStrikeDiff, 0, len(fromByStrike))
	for strike, fromStrike := range fromByStrike {
		toStrike, ok := toByStrike[strike]
		if !ok {
			continue
		}

		callOIChange := toStrike.Call.OI - fromStrike.Call.OI
		putOIChange := toStrike.Put.OI - fromStrike.Put.OI
		totalOIChange := callOIChange + putOIChange

		callVolumeChange := toStrike.Call.Volume - fromStrike.Call.Volume
		putVolumeChange := toStrike.Put.Volume - fromStrike.Put.Volume
		totalVolumeChange := callVolumeChange + putVolumeChange

		callIVChange := roundTo(toStrike.Call.IV-fromStrike.Call.IV, 2)
		putIVChange := roundTo(toStrike.Put.IV-fromStrike.Put.IV, 2)
		totalIVChange := roundTo(callIVChange+putIVChange, 2)

		direction := "flat"
		if totalOIChange > 0 {
			direction = "build_up"
		} else if totalOIChange < 0 {
			direction = "unwinding"
		}

		diffs = append(diffs, OptionStrikeDiff{
			Strike:            strike,
			CallChangeOI:      callOIChange,
			PutChangeOI:       putOIChange,
			TotalChangeOI:     totalOIChange,
			CallChangeVolume:  callVolumeChange,
			PutChangeVolume:   putVolumeChange,
			TotalChangeVolume: totalVolumeChange,
			CallChangeIV:      callIVChange,
			PutChangeIV:       putIVChange,
			TotalChangeIV:     totalIVChange,
			OIBuildDirection:  direction,
		})
	}

	if len(diffs) == 0 {
		return OptionDiffResponse{}, ErrNoCandles
	}

	positiveBuildUps := make([]OptionStrikeDiff, 0, len(diffs))
	for _, diff := range diffs {
		if diff.TotalChangeOI > 0 {
			positiveBuildUps = append(positiveBuildUps, diff)
		}
	}

	rankByBuildUp := func(values []OptionStrikeDiff) {
		sort.Slice(values, func(i, j int) bool {
			left := values[i]
			right := values[j]
			if left.TotalChangeOI == right.TotalChangeOI {
				return math.Abs(left.TotalChangeIV) > math.Abs(right.TotalChangeIV)
			}
			return left.TotalChangeOI > right.TotalChangeOI
		})
	}

	selected := positiveBuildUps
	if len(selected) == 0 {
		selected = diffs
		sort.Slice(selected, func(i, j int) bool {
			left := selected[i]
			right := selected[j]
			if math.Abs(float64(left.TotalChangeOI)) == math.Abs(float64(right.TotalChangeOI)) {
				return math.Abs(left.TotalChangeIV) > math.Abs(right.TotalChangeIV)
			}
			return math.Abs(float64(left.TotalChangeOI)) > math.Abs(float64(right.TotalChangeOI))
		})
	} else {
		rankByBuildUp(selected)
	}

	if limit < len(selected) {
		selected = selected[:limit]
	}

	underlyingPointChange := roundTo(toSnapshot.Underlying-fromSnapshot.Underlying, 2)
	underlyingPctChange := 0.0
	if fromSnapshot.Underlying != 0 {
		underlyingPctChange = roundTo((underlyingPointChange/fromSnapshot.Underlying)*100.0, 4)
	}

	return OptionDiffResponse{
		FromTimestamp:         from.Unix(),
		ToTimestamp:           to.Unix(),
		Source:                fromSnapshot.Source,
		UnderlyingFrom:        fromSnapshot.Underlying,
		UnderlyingTo:          toSnapshot.Underlying,
		UnderlyingPointChange: underlyingPointChange,
		UnderlyingPctChange:   underlyingPctChange,
		FromSnapshot:          fromSnapshot,
		ToSnapshot:            toSnapshot,
		TopStrikes:            selected,
	}, nil
}

func (s *Service) GetOptionRange(ctx context.Context, symbol string, from, to time.Time) (OptionRangeResponse, error) {
	normalizedSymbol, err := normalizeOptionSymbol(symbol)
	if err != nil {
		return OptionRangeResponse{}, err
	}

	from = from.UTC()
	to = to.UTC()
	if !to.After(from) {
		return OptionRangeResponse{}, fmt.Errorf("to must be greater than from")
	}

	latestSnapshotTS := int64(0)
	if latest, ok := s.getLatestOptionSnapshot(); ok {
		latestSnapshotTS = latest.Timestamp
	}
	cacheKey := optionRangeCacheKey(normalizedSymbol, from, to, latestSnapshotTS)
	if cached, ok := s.getCachedOptionRange(cacheKey); ok {
		return cached, nil
	}

	_ = s.captureLiveOptionSnapshot(ctx)
	if latest, ok := s.getLatestOptionSnapshot(); ok {
		latestSnapshotTS = latest.Timestamp
	}
	cacheKey = optionRangeCacheKey(normalizedSymbol, from, to, latestSnapshotTS)
	if cached, ok := s.getCachedOptionRange(cacheKey); ok {
		return cached, nil
	}

	var startSnapshot OptionSnapshotResponse
	var endSnapshot OptionSnapshotResponse
	var startErr error
	var endErr error
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		startSnapshot, startErr = s.getOptionSnapshotRaw(ctx, normalizedSymbol, from)
	}()
	go func() {
		defer wg.Done()
		endSnapshot, endErr = s.getOptionSnapshotRaw(ctx, normalizedSymbol, to)
	}()
	wg.Wait()
	if startErr != nil {
		return OptionRangeResponse{}, startErr
	}
	if endErr != nil {
		return OptionRangeResponse{}, endErr
	}

	startSnapshot = cloneOptionSnapshot(startSnapshot)
	endSnapshot = cloneOptionSnapshot(endSnapshot)
	latestSnapshot := cloneOptionSnapshot(endSnapshot)
	if latest, ok := s.getLatestOptionSnapshot(); ok && latest.Timestamp >= latestSnapshot.Timestamp {
		latestSnapshot = latest
	}

	selectedFrom := startSnapshot.Timestamp
	selectedTo := endSnapshot.Timestamp
	if selectedFrom > selectedTo {
		selectedFrom, selectedTo = selectedTo, selectedFrom
	}

	selectedSnapshots := s.optionSnapshotsBetween(ctx, normalizedSymbol, selectedFrom, selectedTo)
	if len(selectedSnapshots) == 0 {
		selectedSnapshots = []OptionSnapshotResponse{startSnapshot}
		if endSnapshot.Timestamp != startSnapshot.Timestamp {
			selectedSnapshots = append(selectedSnapshots, endSnapshot)
		}
	}

	sessionStartUTC, _ := s.marketSessionBoundsUTC(time.Unix(selectedTo, 0).UTC())
	sessionSnapshots := s.optionSnapshotsBetween(ctx, normalizedSymbol, sessionStartUTC.Unix(), selectedTo)
	if len(sessionSnapshots) == 0 {
		sessionSnapshots = append([]OptionSnapshotResponse{}, selectedSnapshots...)
	}
	sessionCall, sessionPut, sessionTotal := sumSnapshotTotals(sessionSnapshots)
	sessionPCR := 0.0
	if sessionPut > 0 {
		sessionPCR = roundTo(float64(sessionCall)/float64(sessionPut), 4)
	}
	displayStartSnapshot := trimOptionSnapshotAroundATM(startSnapshot, 10)
	displayEndSnapshot := trimOptionSnapshotAroundATM(endSnapshot, 10)
	displayLatestSnapshot := trimOptionSnapshotAroundATM(latestSnapshot, 10)
	startDataMap := snapshotDataMap(displayStartSnapshot)
	endDataMap := snapshotDataMap(displayEndSnapshot)
	latestDataMap := snapshotDataMap(displayLatestSnapshot)

	highestCallStrike := 0.0
	highestPutStrike := 0.0
	highestCallOI := 0.0
	highestPutOI := 0.0
	highestCallTS := displayLatestSnapshot.Timestamp
	highestPutTS := displayLatestSnapshot.Timestamp
	for key, value := range latestDataMap {
		upperKey := strings.ToUpper(strings.TrimSpace(key))
		strike, ok := parseStrikeFromOptionSymbol(upperKey)
		if !ok {
			continue
		}
		if strings.HasSuffix(upperKey, "CE") {
			if value > highestCallOI {
				highestCallOI = value
				highestCallStrike = float64(strike)
			}
			continue
		}
		if strings.HasSuffix(upperKey, "PE") && value > highestPutOI {
			highestPutOI = value
			highestPutStrike = float64(strike)
		}
	}

	selectedDataMaps := make([]map[string]float64, 0, len(selectedSnapshots))
	for _, snapshot := range selectedSnapshots {
		displaySnapshot := trimOptionSnapshotAroundATM(snapshot, 10)
		selectedDataMaps = append(selectedDataMaps, snapshotDataMap(displaySnapshot))
	}
	if len(selectedDataMaps) == 0 {
		selectedDataMaps = append(selectedDataMaps, startDataMap, endDataMap)
	}

	commonOptionKeys := intersectOptionKeysAcrossMaps(selectedDataMaps)
	calcStartDataMap := filterOptionDataByKeys(startDataMap, commonOptionKeys)
	calcEndDataMap := filterOptionDataByKeys(endDataMap, commonOptionKeys)
	commonStrikeCount := len(commonOptionKeys) / 2

	totalTs1 := 0.0
	for _, value := range calcStartDataMap {
		totalTs1 += value
	}
	totalTs1 = roundTo(totalTs1, 1)

	totalTs2 := 0.0
	for _, value := range calcEndDataMap {
		totalTs2 += value
	}
	totalTs2 = roundTo(totalTs2, 1)

	net := roundTo(totalTs2-totalTs1, 1)
	netPct := 0.0
	if totalTs1 != 0 {
		netPct = roundTo((net/totalTs1)*100.0, 2)
	}

	diffKey := make(map[string]float64, len(commonOptionKeys))
	selectedCallOI := 0.0
	selectedPutOI := 0.0
	for key := range commonOptionKeys {
		diff := roundTo(calcEndDataMap[key]-calcStartDataMap[key], 1)
		diffKey[key] = diff
		upperKey := strings.ToUpper(strings.TrimSpace(key))
		if strings.HasSuffix(upperKey, "CE") {
			selectedCallOI += diff
			continue
		}
		if strings.HasSuffix(upperKey, "PE") {
			selectedPutOI += diff
		}
	}
	selectedCallOI = roundTo(selectedCallOI, 1)
	selectedPutOI = roundTo(selectedPutOI, 1)
	selectedTotalOI := roundTo(selectedCallOI+selectedPutOI, 1)
	selectedPCR := 0.0
	if selectedCallOI != 0 {
		selectedPCR = roundTo(selectedPutOI/selectedCallOI, 2)
	}

	snapshotMap := make(map[string]OptionSnapshotResponse, len(selectedSnapshots))
	for _, snapshot := range selectedSnapshots {
		key := strconv.FormatInt(snapshot.Timestamp, 10)
		snapshotMap[key] = trimOptionSnapshotAroundATM(snapshot, 10)
	}

	selectedRequested := 1
	if s.optionInterval > 0 && selectedTo >= selectedFrom {
		selectedRequested = int((selectedTo-selectedFrom)/int64(s.optionInterval/time.Second)) + 1
		if selectedRequested < 1 {
			selectedRequested = 1
		}
	}
	requested := selectedRequested
	if s.optionInterval > 0 {
		requested = int((to.Unix()-from.Unix())/int64(s.optionInterval/time.Second)) + 1
		if requested < 1 {
			requested = 1
		}
	}

	startSnapshotPtr := cloneOptionSnapshot(displayStartSnapshot)
	endSnapshotPtr := cloneOptionSnapshot(displayEndSnapshot)
	latestSnapshotPtr := cloneOptionSnapshot(displayLatestSnapshot)

	response := OptionRangeResponse{
		Symbol:         normalizedSymbol,
		Source:         startSnapshot.Source,
		Interval:       s.optionIntervalLabel,
		StartTimestamp: from.Unix(),
		EndTimestamp:   to.Unix(),
		TS1: OptionSnapshotPoint{
			RequestTimestamp:  from.Unix(),
			ResolvedTimestamp: startSnapshot.Timestamp,
			ExactMatch:        startSnapshot.Timestamp == from.Unix(),
			Snapshot:          &startSnapshotPtr,
		},
		TS2: OptionSnapshotPoint{
			RequestTimestamp:  to.Unix(),
			ResolvedTimestamp: endSnapshot.Timestamp,
			ExactMatch:        endSnapshot.Timestamp == to.Unix(),
			Snapshot:          &endSnapshotPtr,
		},
		Selected: OptionRangeStats{
			SnapshotCount: len(selectedSnapshots),
			CallOiTotal:   int64(math.Round(selectedCallOI)),
			PutOiTotal:    int64(math.Round(selectedPutOI)),
			TotalOi:       int64(math.Round(selectedTotalOI)),
			Pcr:           selectedPCR,
		},
		Session: OptionRangeStats{
			SnapshotCount:          len(sessionSnapshots),
			CallOiTotal:            sessionCall,
			PutOiTotal:             sessionPut,
			TotalOi:                sessionTotal,
			Pcr:                    sessionPCR,
			SessionStartTimestamp:  sessionStartUTC.Unix(),
			SessionLatestTimestamp: selectedTo,
		},
		NetOiChange: OptionRangeNetOiChange{
			TotalTs1: totalTs1,
			TotalTs2: totalTs2,
			Net:      net,
			Pct:      netPct,
		},
		HighestOI: OptionRangeHighestOI{
			CallStrike:    highestCallStrike,
			CallOI:        highestCallOI,
			CallTimestamp: highestCallTS,
			PutStrike:     highestPutStrike,
			PutOI:         highestPutOI,
			PutTimestamp:  highestPutTS,
		},
		Coverage: OptionRangeCoverage{
			Requested:         requested,
			Resolved:          len(selectedSnapshots),
			SelectedRequested: selectedRequested,
			SelectedResolved:  len(selectedSnapshots),
			CommonStrikeCount: commonStrikeCount,
		},
		Data: map[string]map[string]float64{
			fmt.Sprintf("%d.0", from.Unix()): startDataMap,
			fmt.Sprintf("%d.0", to.Unix()):   endDataMap,
		},
		Snapshots:      snapshotMap,
		StartSnapshot:  &startSnapshotPtr,
		EndSnapshot:    &endSnapshotPtr,
		LatestSnapshot: &latestSnapshotPtr,
	}

	s.storeCachedOptionRange(cacheKey, response, 6*time.Second)
	return response, nil
}

func (s *Service) WarmOptionHistory(ctx context.Context) error {
	return s.captureLiveOptionSnapshot(ctx)
}

func (s *Service) WarmMoversCache(ctx context.Context, at time.Time, intervalRaw string) error {
	_, _, err := normalizeInterval(intervalRaw)
	if err != nil {
		return err
	}
	sessionStartUTC, _ := s.marketSessionBoundsUTC(at)
	_, err = s.getOrBuildOneMinuteContributionSeries(ctx, sessionStartUTC)
	return err
}

func contributionCacheKey(sessionStartUTC time.Time, interval string) string {
	return fmt.Sprintf("%s|%d", strings.ToLower(strings.TrimSpace(interval)), sessionStartUTC.UTC().Unix())
}

func contributionCacheKeyForIndex(indexKey string, sessionStartUTC time.Time, interval string) string {
	normalizedIndex := strings.ToUpper(strings.TrimSpace(indexKey))
	if normalizedIndex == "" || normalizedIndex == "NIFTY50" {
		return contributionCacheKey(sessionStartUTC, interval)
	}
	return fmt.Sprintf("%s|%s|%d",
		strings.ToLower(strings.TrimSpace(interval)),
		strings.ToLower(normalizedIndex),
		sessionStartUTC.UTC().Unix(),
	)
}

func optionRangeCacheKey(symbol string, from, to time.Time, latestSnapshotTS int64) string {
	return fmt.Sprintf("%s|%d|%d|%d",
		strings.ToUpper(strings.TrimSpace(symbol)),
		from.UTC().Unix(),
		to.UTC().Unix(),
		latestSnapshotTS,
	)
}

func (s *Service) getCachedOptionRange(key string) (OptionRangeResponse, bool) {
	s.optionRangeMu.RLock()
	entry, ok := s.optionRangeCache[key]
	s.optionRangeMu.RUnlock()
	if !ok {
		return OptionRangeResponse{}, false
	}
	if time.Now().After(entry.expiresAt) {
		s.optionRangeMu.Lock()
		if current, exists := s.optionRangeCache[key]; exists && time.Now().After(current.expiresAt) {
			delete(s.optionRangeCache, key)
		}
		s.optionRangeMu.Unlock()
		return OptionRangeResponse{}, false
	}
	return entry.response, true
}

func (s *Service) storeCachedOptionRange(key string, response OptionRangeResponse, ttl time.Duration) {
	if ttl <= 0 {
		ttl = 5 * time.Second
	}
	expiresAt := time.Now().Add(ttl)

	s.optionRangeMu.Lock()
	defer s.optionRangeMu.Unlock()

	if len(s.optionRangeCache) > 128 {
		now := time.Now()
		for cacheKey, entry := range s.optionRangeCache {
			if now.After(entry.expiresAt) {
				delete(s.optionRangeCache, cacheKey)
			}
		}
		if len(s.optionRangeCache) > 160 {
			for cacheKey := range s.optionRangeCache {
				delete(s.optionRangeCache, cacheKey)
				if len(s.optionRangeCache) <= 96 {
					break
				}
			}
		}
	}

	s.optionRangeCache[key] = cachedOptionRange{
		response:  response,
		expiresAt: expiresAt,
	}
}

func (s *Service) loadContributionSeriesFromDB(ctx context.Context, sessionStartUTC time.Time, interval string) (map[int64]map[string]ContributionData, bool, error) {
	if s.db == nil || !strings.EqualFold(strings.TrimSpace(interval), "1m") {
		return nil, false, nil
	}

	_, sessionEndUTC := s.marketSessionBoundsUTC(sessionStartUTC)
	rows, err := s.db.QueryContext(
		ctx,
		`SELECT ts_minute, symbol, per_change, per_to_index, point_to_index
		 FROM movers_1m
		 WHERE ts_minute BETWEEN ? AND ?
		 ORDER BY ts_minute ASC, symbol ASC`,
		sessionStartUTC.UTC().Unix(),
		sessionEndUTC.UTC().Unix(),
	)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "movers_1m") {
			return nil, false, nil
		}
		return nil, false, err
	}
	defer rows.Close()

	snapshots := make(map[int64]map[string]ContributionData)
	for rows.Next() {
		var ts int64
		var symbol string
		var perChange float64
		var perToIndex sql.NullFloat64
		var pointToIndex sql.NullFloat64
		if scanErr := rows.Scan(&ts, &symbol, &perChange, &perToIndex, &pointToIndex); scanErr != nil {
			return nil, false, scanErr
		}

		symbol = strings.ToUpper(strings.TrimSpace(symbol))
		if ts <= 0 || symbol == "" {
			continue
		}

		row := ContributionData{
			PerChange:       roundTo(perChange, 4),
			SourceTimestamp: ts,
			Exact:           true,
		}
		if perToIndex.Valid {
			row.PerToIndex = roundTo(perToIndex.Float64, 6)
		}
		if pointToIndex.Valid {
			row.PointToIndex = roundTo(pointToIndex.Float64, 4)
		}

		if _, ok := snapshots[ts]; !ok {
			snapshots[ts] = make(map[string]ContributionData, 64)
		}
		snapshots[ts][symbol] = row
	}
	if err := rows.Err(); err != nil {
		return nil, false, err
	}

	if len(snapshots) == 0 {
		return nil, false, nil
	}

	return snapshots, true, nil
}

func (s *Service) persistContributionSeriesToDB(ctx context.Context, interval string, snapshots map[int64]map[string]ContributionData) error {
	if s.db == nil || !strings.EqualFold(strings.TrimSpace(interval), "1m") || len(snapshots) == 0 {
		return nil
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	stmt, err := tx.PrepareContext(ctx, `
		INSERT INTO movers_1m (ts_minute, symbol, per_change, per_to_index, point_to_index)
		VALUES (?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			per_change = VALUES(per_change),
			per_to_index = VALUES(per_to_index),
			point_to_index = VALUES(point_to_index),
			updated_at = CURRENT_TIMESTAMP
	`)
	if err != nil {
		return err
	}
	defer stmt.Close()

	for ts, snapshot := range snapshots {
		if ts <= 0 || len(snapshot) == 0 {
			continue
		}
		for rawSymbol, row := range snapshot {
			symbol := strings.ToUpper(strings.TrimSpace(rawSymbol))
			if symbol == "" {
				continue
			}

			var perToIndex any = nil
			var pointToIndex any = nil
			if !math.IsNaN(row.PerToIndex) && !math.IsInf(row.PerToIndex, 0) {
				perToIndex = row.PerToIndex
			}
			if !math.IsNaN(row.PointToIndex) && !math.IsInf(row.PointToIndex, 0) {
				pointToIndex = row.PointToIndex
			}

			if _, execErr := stmt.ExecContext(ctx, ts, symbol, row.PerChange, perToIndex, pointToIndex); execErr != nil {
				return execErr
			}
		}
	}

	return tx.Commit()
}

func (s *Service) isContributionSeriesDBFresh(sessionStartUTC time.Time, interval string, snapshots map[int64]map[string]ContributionData) bool {
	if len(snapshots) == 0 {
		return false
	}

	interval = strings.ToLower(strings.TrimSpace(interval))
	if interval != "1m" {
		return true
	}

	// For historical dates, persisted snapshots are considered fresh.
	nowLocal := time.Now().In(s.indiaLocation)
	sessionLocal := sessionStartUTC.In(s.indiaLocation)
	ny, nm, nd := nowLocal.Date()
	sy, sm, sd := sessionLocal.Date()
	if ny != sy || nm != sm || nd != sd {
		return true
	}

	latestSnapshotTs := int64(0)
	for ts, rows := range snapshots {
		if len(rows) == 0 {
			continue
		}
		if ts > latestSnapshotTs {
			latestSnapshotTs = ts
		}
	}
	if latestSnapshotTs <= 0 {
		return false
	}

	currentBucketStart := (time.Now().UTC().Unix() / 60) * 60
	latestClosedBucket := currentBucketStart - 60
	if latestClosedBucket < sessionStartUTC.UTC().Unix() {
		// Before the first candle closes, any persisted data is acceptable.
		return true
	}

	_, sessionEndUTC := s.marketSessionBoundsUTC(sessionStartUTC)
	if latestClosedBucket > sessionEndUTC.UTC().Unix() {
		latestClosedBucket = sessionEndUTC.UTC().Unix()
	}

	// Allow a 1-minute lag before forcing a rebuild.
	return latestSnapshotTs >= (latestClosedBucket - 60)
}

func (s *Service) getOrBuildContributionSeries(ctx context.Context, sessionStartUTC time.Time, intervalRaw string) (map[int64]map[string]ContributionData, error) {
	interval, _, err := normalizeInterval(intervalRaw)
	if err != nil {
		return nil, err
	}

	sessionStartUTC = sessionStartUTC.UTC()
	cacheKey := contributionCacheKey(sessionStartUTC, interval)

	if cached, ok, fresh := s.getCachedContributionSeriesWithFreshness(cacheKey); ok && len(cached.snapshots) > 0 && contributionSnapshotsHaveExtendedFields(cached.snapshots) {
		if fresh {
			return cached.snapshots, nil
		}
		s.refreshContributionSeriesAsync(sessionStartUTC, interval, cacheKey)
		return cached.snapshots, nil
	}

	if dbSnapshots, ok, dbErr := s.loadContributionSeriesFromDB(ctx, sessionStartUTC, interval); dbErr == nil && ok && len(dbSnapshots) > 0 {
		if !contributionSnapshotsHaveExtendedFields(dbSnapshots) {
			// The legacy DB cache stores only contribution metrics (no close/weight/session prev close).
			// Returning it as a full contribution snapshot causes frontend tables (e.g. top movers)
			// to show zero close values. Skip DB snapshots and rebuild from live candles instead.
			dbSnapshots = nil
		}
		if len(dbSnapshots) == 0 {
			goto buildContributionSeriesNow
		}

		cloned := cloneContributionSnapshots(dbSnapshots)
		if s.isContributionSeriesDBFresh(sessionStartUTC, interval, dbSnapshots) {
			s.setCachedContributionSeries(cacheKey, cachedContributionSeries{
				snapshots: cloned,
				expiresAt: time.Now().Add(55 * time.Second),
			})
			return cloneContributionSnapshots(cloned), nil
		}

		// Serve stale DB snapshots immediately and refresh in the background to avoid
		// blocking clients on a full 50-symbol rebuild every cache expiry boundary.
		s.setCachedContributionSeries(cacheKey, cachedContributionSeries{
			snapshots: cloned,
			expiresAt: time.Now().Add(5 * time.Second),
		})
		s.refreshContributionSeriesAsync(sessionStartUTC, interval, cacheKey)
		return cloneContributionSnapshots(cloned), nil
	}

buildContributionSeriesNow:
	series, buildErr := s.buildContributionSeriesCoalesced(ctx, cacheKey, func(buildCtx context.Context) (map[int64]map[string]ContributionData, error) {
		return s.buildContributionSeries(buildCtx, sessionStartUTC, interval)
	})
	if buildErr != nil {
		if cached, ok, _ := s.getCachedContributionSeriesWithFreshness(cacheKey); ok && len(cached.snapshots) > 0 {
			return cached.snapshots, nil
		}
		return nil, buildErr
	}

	s.cacheContributionSeries(cacheKey, interval, series)
	return cloneContributionSnapshots(series), nil
}

func contributionSnapshotsHaveExtendedFields(snapshots map[int64]map[string]ContributionData) bool {
	for _, snapshot := range snapshots {
		for _, row := range snapshot {
			if row.Close > 0 || row.Open > 0 || row.SessionPrevClose > 0 || row.Weight > 0 {
				return true
			}
		}
	}
	return false
}

func (s *Service) getOrBuildOneMinuteContributionSeries(ctx context.Context, sessionStartUTC time.Time) (map[int64]map[string]ContributionData, error) {
	return s.getOrBuildContributionSeries(ctx, sessionStartUTC, "1m")
}

func (s *Service) buildContributionSeriesCoalesced(
	ctx context.Context,
	key string,
	buildFn func(context.Context) (map[int64]map[string]ContributionData, error),
) (map[int64]map[string]ContributionData, error) {
	s.buildMu.Lock()
	if call, ok := s.buildInFlight[key]; ok {
		s.buildMu.Unlock()
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-call.done:
			if call.err != nil {
				return nil, call.err
			}
			return cloneContributionSnapshots(call.snapshots), nil
		}
	}

	call := &contributionBuildCall{done: make(chan struct{})}
	s.buildInFlight[key] = call
	s.buildMu.Unlock()

	defer func() {
		s.buildMu.Lock()
		delete(s.buildInFlight, key)
		s.buildMu.Unlock()
		close(call.done)
	}()

	snapshots, err := buildFn(ctx)
	if err != nil {
		call.err = err
		return nil, err
	}

	call.snapshots = cloneContributionSnapshots(snapshots)
	return cloneContributionSnapshots(call.snapshots), nil
}

func (s *Service) refreshContributionSeriesAsync(sessionStartUTC time.Time, interval, cacheKey string) {
	go func() {
		refreshCtx, cancel := context.WithTimeout(context.Background(), 25*time.Second)
		defer cancel()

		series, err := s.buildContributionSeriesCoalesced(refreshCtx, cacheKey, func(buildCtx context.Context) (map[int64]map[string]ContributionData, error) {
			return s.buildContributionSeries(buildCtx, sessionStartUTC, interval)
		})
		if err != nil || len(series) == 0 {
			return
		}

		s.cacheContributionSeries(cacheKey, interval, series)
	}()
}

func (s *Service) cacheContributionSeries(cacheKey, interval string, snapshots map[int64]map[string]ContributionData) {
	cloned := cloneContributionSnapshots(snapshots)
	s.setCachedContributionSeries(cacheKey, cachedContributionSeries{
		snapshots: cloned,
		expiresAt: time.Now().Add(55 * time.Second),
	})

	if strings.EqualFold(interval, "1m") {
		persistInput := cloneContributionSnapshots(cloned)
		go func() {
			persistCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			_ = s.persistContributionSeriesToDB(persistCtx, "1m", persistInput)
		}()
	}
}

func (s *Service) buildContributionSeries(ctx context.Context, sessionStartUTC time.Time, interval string) (map[int64]map[string]ContributionData, error) {
	interval, intervalSeconds, err := normalizeInterval(interval)
	if err != nil {
		return nil, err
	}

	constituents, err := s.getNifty50ConstituentWeights(ctx)
	if err != nil {
		return nil, err
	}
	instrumentTokens, err := s.getZerodhaInstrumentTokens(ctx)
	if err != nil {
		return nil, err
	}

	_, sessionEndUTC := s.marketSessionBoundsUTC(sessionStartUTC)
	lookbackStartUTC := sessionStartUTC.Add(-96 * time.Hour)
	constituentSymbols := make([]string, 0, len(constituents))
	for _, constituent := range constituents {
		symbol := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
		if symbol == "" {
			continue
		}
		constituentSymbols = append(constituentSymbols, symbol)
	}
	indexCandles, _, err := s.fetchZerodhaCandlesByTokenCached(ctx, s.zerodhaNiftyToken, lookbackStartUTC, sessionEndUTC, interval)
	if err != nil {
		return nil, err
	}
	indexSessionCandles := filterCandles(indexCandles, sessionStartUTC.Unix(), sessionEndUTC.Unix())
	if len(indexSessionCandles) == 0 {
		return nil, ErrNoCandles
	}
	indexPrevCloseCandles := indexCandles
	if !strings.EqualFold(interval, "1m") {
		if candles1m, _, err1m := s.fetchZerodhaCandlesByTokenCached(ctx, s.zerodhaNiftyToken, lookbackStartUTC, sessionEndUTC, "1m"); err1m == nil && len(candles1m) > 0 {
			indexPrevCloseCandles = candles1m
		}
	}
	indexPreviousDayClose := 0.0
	if prevIndexCandle, prevOK := candleAtOrBefore(indexPrevCloseCandles, sessionStartUTC.Unix()-1); prevOK {
		indexPreviousDayClose = prevIndexCandle.Close
		if indexPreviousDayClose <= 0 {
			indexPreviousDayClose = prevIndexCandle.Open
		}
	}
	if indexPreviousDayClose <= 0 {
		indexPreviousDayClose = indexSessionCandles[0].Open
		if indexPreviousDayClose <= 0 {
			indexPreviousDayClose = indexSessionCandles[0].Close
		}
	}

	type workerResult struct {
		symbol        string
		contributions map[int64]ContributionData
	}

	workers := maxMoverWorkers
	if workers > len(constituents) {
		workers = len(constituents)
	}
	if workers <= 0 {
		return nil, ErrNoCandles
	}

	jobCh := make(chan indexConstituentWeight)
	resultCh := make(chan workerResult, len(constituents))
	var wg sync.WaitGroup
	rateTicker := time.NewTicker(350 * time.Millisecond)
	defer rateTicker.Stop()

	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for constituent := range jobCh {
				symbol := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
				token := strings.TrimSpace(instrumentTokens[symbol])
				if token == "" {
					continue
				}

				cacheKey := zerodhaCandlesCacheKey(token, lookbackStartUTC, sessionEndUTC, interval)
				if _, isCached := s.getCachedCandles(cacheKey); !isCached {
					select {
					case <-ctx.Done():
						return
					case <-rateTicker.C:
					}
				}

				candles, _, candleErr := s.fetchZerodhaCandlesByTokenCached(ctx, token, lookbackStartUTC, sessionEndUTC, interval)
				if candleErr != nil || len(candles) == 0 {
					continue
				}
				prevCloseCandles := candles
				if !strings.EqualFold(interval, "1m") {
					prevCloseCacheKey := zerodhaCandlesCacheKey(token, lookbackStartUTC, sessionEndUTC, "1m")
					if _, isCached := s.getCachedCandles(prevCloseCacheKey); !isCached {
						select {
						case <-ctx.Done():
							return
						case <-rateTicker.C:
						}
					}
					if candles1m, _, err1m := s.fetchZerodhaCandlesByTokenCached(ctx, token, lookbackStartUTC, sessionEndUTC, "1m"); err1m == nil && len(candles1m) > 0 {
						prevCloseCandles = candles1m
					}
				}

				// Previous day close is always the prior session's final 1m intraday
				// candle close (typically the 15:29 1m candle), regardless of the
				// selected contribution interval.
				previousDayClose := 0.0
				if previousCandle, previousOK := candleAtOrBefore(prevCloseCandles, sessionStartUTC.Unix()-1); previousOK && previousCandle.Close > 0 {
					previousDayClose = previousCandle.Close
				}
				if previousDayClose <= 0 {
					continue
				}

				sessionCandles := filterCandles(candles, sessionStartUTC.Unix(), sessionEndUTC.Unix())
				if len(sessionCandles) == 0 {
					continue
				}

				contributionByTimestamp := make(map[int64]ContributionData, len(sessionCandles))
				for _, candle := range sessionCandles {
					currentClose := candle.Close
					if currentClose <= 0 {
						currentClose = candle.Open
					}
					if currentClose <= 0 {
						continue
					}
					// Contribution snapshots use the selected/current candle close.
					snapshotPrice := currentClose
					sourceTimestamp := candle.Timestamp

					indexCandle, indexOK := candleAtOrBeforeOrAfter(indexSessionCandles, candle.Timestamp)
					if !indexOK {
						continue
					}
					indexValue := indexCandle.Close
					if indexValue <= 0 {
						indexValue = indexCandle.Open
					}
					if indexValue <= 0 {
						continue
					}
					// per_change = ((current_candle_close - previous_day_close) / previous_day_close) * 100
					// previous_day_close is the prior session's final intraday candle close.
					perChange := ((snapshotPrice - previousDayClose) / previousDayClose) * 100.0
					pointBase := indexPreviousDayClose
					if pointBase <= 0 {
						pointBase = indexValue
					}

					// Weight-based contribution model:
					// per_to_index = per_change * (weight_pct / 100)
					// point_to_index = (per_to_index / 100) * nifty_prev_day_close
					perToIndex := perChange * (constituent.Weight / 100.0)
					pointToIndex := 0.0
					if pointBase > 0 {
						pointToIndex = (perToIndex / 100.0) * pointBase
					}

					openValue := candle.Open
					if openValue <= 0 {
						openValue = currentClose
					}

					contributionByTimestamp[candle.Timestamp] = ContributionData{
						PerChange:        roundTo(perChange, 4),
						PerToIndex:       roundTo(perToIndex, 6),
						PointToIndex:     roundTo(pointToIndex, 4),
						Open:             roundTo(openValue, 2),
						Close:            roundTo(snapshotPrice, 2),
						SessionPrevClose: roundTo(previousDayClose, 2),
						Weight:           roundTo(constituent.Weight, 6),
						SourceTimestamp:  sourceTimestamp,
						Exact:            true,
					}
				}

				if len(contributionByTimestamp) == 0 {
					continue
				}

				resultCh <- workerResult{
					symbol:        symbol,
					contributions: contributionByTimestamp,
				}
			}
		}()
	}

	for _, constituent := range constituents {
		jobCh <- constituent
	}
	close(jobCh)

	wg.Wait()
	close(resultCh)

	seriesBySymbol := make(map[string]map[int64]ContributionData, len(constituents))
	for result := range resultCh {
		if len(result.contributions) == 0 {
			continue
		}
		seriesBySymbol[strings.ToUpper(strings.TrimSpace(result.symbol))] = result.contributions
	}

	if len(seriesBySymbol) == 0 {
		return nil, ErrNoCandles
	}

	sessionTimestamps := make([]int64, 0, len(indexSessionCandles))
	for _, candle := range indexSessionCandles {
		sessionTimestamps = append(sessionTimestamps, candle.Timestamp)
	}
	sort.Slice(sessionTimestamps, func(i, j int) bool {
		return sessionTimestamps[i] < sessionTimestamps[j]
	})

	snapshots := make(map[int64]map[string]ContributionData, len(sessionTimestamps))
	for _, timestamp := range sessionTimestamps {
		snapshots[timestamp] = make(map[string]ContributionData, len(constituents))
	}

	for _, constituent := range constituents {
		symbol := strings.ToUpper(strings.TrimSpace(constituent.Symbol))
		if symbol == "" {
			continue
		}

		series := seriesBySymbol[symbol]
		if len(series) == 0 {
			continue
		}

		seriesTimestamps := sortedContributionTimestamps(series)
		if len(seriesTimestamps) == 0 {
			continue
		}

		for _, timestamp := range sessionTimestamps {
			nearestTimestamp, ok := nearestTimestampFromSorted(seriesTimestamps, timestamp, intervalSeconds)
			if !ok {
				continue
			}

			data, exists := series[nearestTimestamp]
			if !exists {
				continue
			}
			if nearestTimestamp > timestamp {
				// If the first stock bar is forward-labeled (e.g. 09:16 for the
				// 09:15-09:16 interval), keep candle-close semantics for the selected
				// index timestamp by using the source candle close.
				fallbackPrice := data.Close
				if fallbackPrice <= 0 {
					fallbackPrice = data.Open
				}
				prevClose := data.SessionPrevClose
				if fallbackPrice > 0 && prevClose > 0 {
					perChange := ((fallbackPrice - prevClose) / prevClose) * 100.0
					pointBase := indexPreviousDayClose
					if pointBase <= 0 {
						pointBase = 0
					}

					perToIndex := perChange * (constituent.Weight / 100.0)
					pointToIndex := 0.0
					if pointBase > 0 {
						pointToIndex = (perToIndex / 100.0) * pointBase
					}

					data.PerChange = roundTo(perChange, 4)
					data.PerToIndex = roundTo(perToIndex, 6)
					data.PointToIndex = roundTo(pointToIndex, 4)
					data.Close = roundTo(fallbackPrice, 2)
					data.Weight = roundTo(constituent.Weight, 6)
				}
			}
			data.Exact = nearestTimestamp == timestamp
			snapshots[timestamp][symbol] = data
		}
	}

	for timestamp, snapshot := range snapshots {
		if len(snapshot) == 0 {
			delete(snapshots, timestamp)
		}
	}

	if len(snapshots) == 0 {
		return nil, ErrNoCandles
	}

	return snapshots, nil
}

func (s *Service) getZerodhaPreviousCloses(ctx context.Context, symbols []string) (map[string]float64, error) {
	output := make(map[string]float64, len(symbols))
	if len(symbols) == 0 {
		return output, nil
	}

	apiKey, accessToken, err := s.getZerodhaAuth()
	if err != nil {
		return output, err
	}

	values := url.Values{}
	for _, rawSymbol := range symbols {
		symbol := strings.ToUpper(strings.TrimSpace(rawSymbol))
		if symbol == "" {
			continue
		}
		values.Add("i", "NSE:"+symbol)
	}
	if len(values["i"]) == 0 {
		return output, nil
	}

	requestURL := fmt.Sprintf("%s/quote?%s", s.zerodhaBaseURL, values.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return output, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Kite-Version", "3")
	req.Header.Set("Authorization", fmt.Sprintf("token %s:%s", apiKey, accessToken))
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return output, err
	}
	defer resp.Body.Close()

	var payload struct {
		Status    string `json:"status"`
		ErrorType string `json:"error_type"`
		Message   string `json:"message"`
		Data      map[string]struct {
			OHLC struct {
				Close float64 `json:"close"`
			} `json:"ohlc"`
		} `json:"data"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return output, err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || strings.EqualFold(strings.TrimSpace(payload.Status), "error") {
		message := strings.TrimSpace(payload.Message)
		if message == "" {
			message = fmt.Sprintf("zerodha quote request failed (%d)", resp.StatusCode)
		}
		return output, fmt.Errorf("%s", message)
	}

	for key, row := range payload.Data {
		symbolKey := strings.ToUpper(strings.TrimSpace(key))
		if symbolKey == "" {
			continue
		}

		if strings.HasPrefix(symbolKey, "NSE:") {
			symbolKey = strings.TrimPrefix(symbolKey, "NSE:")
		}
		if row.OHLC.Close <= 0 {
			continue
		}
		output[symbolKey] = row.OHLC.Close
	}

	return output, nil
}

func (s *Service) getCachedContributionSeriesWithFreshness(key string) (cachedContributionSeries, bool, bool) {
	s.contributionMu.RLock()
	entry, ok := s.contributionCache[key]
	s.contributionMu.RUnlock()

	if !ok {
		return cachedContributionSeries{}, false, false
	}
	fresh := time.Now().Before(entry.expiresAt)

	return cachedContributionSeries{
		snapshots: cloneContributionSnapshots(entry.snapshots),
		expiresAt: entry.expiresAt,
	}, true, fresh
}

func (s *Service) getCachedContributionSeries(key string) (cachedContributionSeries, bool) {
	entry, ok, fresh := s.getCachedContributionSeriesWithFreshness(key)
	if !ok || !fresh {
		return cachedContributionSeries{}, false
	}
	return entry, true
}

func (s *Service) setCachedContributionSeries(key string, entry cachedContributionSeries) {
	cloned := cachedContributionSeries{
		snapshots: cloneContributionSnapshots(entry.snapshots),
		expiresAt: entry.expiresAt,
	}

	s.contributionMu.Lock()
	s.contributionCache[key] = cloned
	s.contributionMu.Unlock()
}

func cloneContributionSnapshots(input map[int64]map[string]ContributionData) map[int64]map[string]ContributionData {
	output := make(map[int64]map[string]ContributionData, len(input))
	for timestamp, snapshot := range input {
		output[timestamp] = cloneContributionDataMap(snapshot)
	}
	return output
}

func cloneContributionDataMap(input map[string]ContributionData) map[string]ContributionData {
	output := make(map[string]ContributionData, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}

func sortedContributionTimestamps(input map[int64]ContributionData) []int64 {
	output := make([]int64, 0, len(input))
	for timestamp := range input {
		output = append(output, timestamp)
	}
	sort.Slice(output, func(i, j int) bool {
		return output[i] < output[j]
	})
	return output
}

func nearestTimestampFromSorted(sortedTimestamps []int64, targetTimestamp int64, maxForwardGapSeconds int64) (int64, bool) {
	if len(sortedTimestamps) == 0 {
		return 0, false
	}

	// Do not look ahead into future stock candles for an earlier index candle.
	// This is especially important around the session open (e.g. 09:15/09:16),
	// where future-minute leakage can make the first candles incorrect.
	index := sort.Search(len(sortedTimestamps), func(i int) bool {
		return sortedTimestamps[i] > targetTimestamp
	})
	if index <= 0 {
		first := sortedTimestamps[0]
		// Some feeds can label the first intraday bar one interval ahead (e.g. 09:16
		// representing the 09:15-09:16 bar). Allow a bounded fallback only when no
		// earlier candle exists and the gap is within one interval.
		if maxForwardGapSeconds > 0 && first >= targetTimestamp && (first-targetTimestamp) <= maxForwardGapSeconds {
			return first, true
		}
		return 0, false
	}
	return sortedTimestamps[index-1], true
}

func contributionSnapshotAtOrNearest(snapshots map[int64]map[string]ContributionData, targetTimestamp int64) (map[string]ContributionData, bool) {
	if len(snapshots) == 0 {
		return nil, false
	}

	if exact, ok := snapshots[targetTimestamp]; ok && len(exact) > 0 {
		return cloneContributionDataMap(exact), true
	}

	timestamps := make([]int64, 0, len(snapshots))
	for timestamp := range snapshots {
		timestamps = append(timestamps, timestamp)
	}
	sort.Slice(timestamps, func(i, j int) bool {
		return timestamps[i] < timestamps[j]
	})

	// Prefer the latest available snapshot at or before the target to avoid
	// lookahead bias when requesting early timestamps. If none exist, fall back
	// to the first snapshot so callers still get a response.
	index := sort.Search(len(timestamps), func(i int) bool {
		return timestamps[i] > targetTimestamp
	})

	if index <= 0 {
		return cloneContributionDataMap(snapshots[timestamps[0]]), true
	}

	chosen := timestamps[index-1]
	return cloneContributionDataMap(snapshots[chosen]), true
}

func (s *Service) captureLiveOptionSnapshot(ctx context.Context) error {
	fetchInterval := s.optionInterval
	if fetchInterval <= 0 {
		fetchInterval = time.Minute
	}

	s.optionMu.RLock()
	needFetch := len(s.optionHistory) == 0 || time.Since(s.optionLastFetch) >= fetchInterval
	s.optionMu.RUnlock()
	if !needFetch {
		return nil
	}

	snapshot, err := s.buildOptionSnapshotFromQuote(ctx, time.Now().UTC())
	if err != nil {
		return err
	}

	s.storeOptionSnapshot(snapshot)
	return nil
}

func (s *Service) storeOptionSnapshot(snapshot OptionSnapshotResponse) {
	s.optionMu.Lock()
	defer s.optionMu.Unlock()

	s.optionLastFetch = time.Now()
	if len(s.optionHistory) == 0 {
		s.optionHistory = append(s.optionHistory, snapshot)
	} else {
		insertIndex := sort.Search(len(s.optionHistory), func(i int) bool {
			return s.optionHistory[i].Timestamp >= snapshot.Timestamp
		})

		if insertIndex < len(s.optionHistory) && s.optionHistory[insertIndex].Timestamp == snapshot.Timestamp {
			s.optionHistory[insertIndex] = snapshot
		} else if insertIndex >= len(s.optionHistory) {
			s.optionHistory = append(s.optionHistory, snapshot)
		} else {
			s.optionHistory = append(s.optionHistory, OptionSnapshotResponse{})
			copy(s.optionHistory[insertIndex+1:], s.optionHistory[insertIndex:])
			s.optionHistory[insertIndex] = snapshot
		}
	}

	cutoff := time.Now().UTC().Add(-24 * time.Hour).Unix()
	trimIndex := 0
	for trimIndex < len(s.optionHistory) && s.optionHistory[trimIndex].Timestamp < cutoff {
		trimIndex++
	}
	if trimIndex > 0 {
		s.optionHistory = append([]OptionSnapshotResponse{}, s.optionHistory[trimIndex:]...)
	}
	if len(s.optionHistory) > 1440 {
		s.optionHistory = append([]OptionSnapshotResponse{}, s.optionHistory[len(s.optionHistory)-1440:]...)
	}

	if s.db != nil {
		snapshotToPersist := cloneOptionSnapshot(snapshot)
		go func(payload OptionSnapshotResponse) {
			ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
			defer cancel()
			if err := s.persistOptionSnapshotToDB(ctx, payload); err != nil {
				log.Printf("[option_chain_1m] persist_error ts=%d err=%v", payload.Timestamp, err)
			}
		}(snapshotToPersist)
	}
}

func cloneOptionInstrumentSet(input cachedOptionInstrumentSet) cachedOptionInstrumentSet {
	output := input
	if len(input.Pairs) > 0 {
		output.Pairs = make(map[int64]optionInstrumentPair, len(input.Pairs))
		for key, value := range input.Pairs {
			output.Pairs[key] = value
		}
	} else {
		output.Pairs = nil
	}

	if len(input.SortedKeys) > 0 {
		output.SortedKeys = append([]int64{}, input.SortedKeys...)
	} else {
		output.SortedKeys = nil
	}

	return output
}

func parseOptionInstrumentExpiry(raw string, location *time.Location) (time.Time, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return time.Time{}, fmt.Errorf("empty expiry")
	}

	layouts := []string{
		"2006-01-02",
		"02-Jan-2006",
		"02JAN2006",
	}

	for _, layout := range layouts {
		if parsed, err := time.ParseInLocation(layout, value, location); err == nil {
			return time.Date(parsed.Year(), parsed.Month(), parsed.Day(), 15, 30, 0, 0, location), nil
		}
	}

	return time.Time{}, fmt.Errorf("invalid expiry date")
}

func (s *Service) getNearestNiftyOptionInstruments(ctx context.Context, at time.Time) (cachedOptionInstrumentSet, error) {
	targetIST := at.In(s.indiaLocation)
	dayStart := time.Date(targetIST.Year(), targetIST.Month(), targetIST.Day(), 0, 0, 0, 0, s.indiaLocation)

	s.optionInstrumentMu.RLock()
	cached := cloneOptionInstrumentSet(s.optionInstruments)
	s.optionInstrumentMu.RUnlock()
	if len(cached.Pairs) > 0 && !cached.Expiry.Before(dayStart) && time.Since(cached.CachedAt) < 30*time.Minute {
		return cached, nil
	}

	apiKey, accessToken, err := s.getZerodhaAuth()
	if err != nil {
		return cachedOptionInstrumentSet{}, err
	}

	requestURL := fmt.Sprintf("%s/instruments/NFO", s.zerodhaBaseURL)
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return cachedOptionInstrumentSet{}, err
	}

	req.Header.Set("Accept", "text/csv")
	req.Header.Set("X-Kite-Version", "3")
	req.Header.Set("Authorization", fmt.Sprintf("token %s:%s", apiKey, accessToken))
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		if len(cached.Pairs) > 0 {
			return cached, nil
		}
		return cachedOptionInstrumentSet{}, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		if len(cached.Pairs) > 0 {
			return cached, nil
		}
		return cachedOptionInstrumentSet{}, fmt.Errorf("zerodha NFO instruments request failed (%d)", resp.StatusCode)
	}

	reader := csv.NewReader(resp.Body)
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		if len(cached.Pairs) > 0 {
			return cached, nil
		}
		return cachedOptionInstrumentSet{}, err
	}
	if len(rows) <= 1 {
		if len(cached.Pairs) > 0 {
			return cached, nil
		}
		return cachedOptionInstrumentSet{}, fmt.Errorf("zerodha NFO instruments payload is empty")
	}

	header := make(map[string]int, len(rows[0]))
	for index, column := range rows[0] {
		normalized := strings.TrimSpace(strings.TrimPrefix(column, "\ufeff"))
		header[strings.ToLower(normalized)] = index
	}

	tokenIndex, okToken := header["instrument_token"]
	symbolIndex, okSymbol := header["tradingsymbol"]
	expiryIndex, okExpiry := header["expiry"]
	strikeIndex, okStrike := header["strike"]
	instrumentTypeIndex, okInstrumentType := header["instrument_type"]
	lotSizeIndex, okLotSize := header["lot_size"]
	exchangeIndex, okExchange := header["exchange"]
	segmentIndex, okSegment := header["segment"]
	nameIndex, hasName := header["name"]
	if !okToken || !okSymbol || !okExpiry || !okStrike || !okInstrumentType {
		if len(cached.Pairs) > 0 {
			return cached, nil
		}
		return cachedOptionInstrumentSet{}, fmt.Errorf("zerodha NFO instruments payload missing required columns")
	}

	valid := make([]optionInstrument, 0, 4000)
	nearestExpiry := time.Time{}
	for _, row := range rows[1:] {
		if tokenIndex >= len(row) || symbolIndex >= len(row) || expiryIndex >= len(row) || strikeIndex >= len(row) || instrumentTypeIndex >= len(row) {
			continue
		}

		token := strings.TrimSpace(row[tokenIndex])
		symbol := strings.ToUpper(strings.TrimSpace(row[symbolIndex]))
		if token == "" || symbol == "" {
			continue
		}

		instrumentType := strings.ToUpper(strings.TrimSpace(row[instrumentTypeIndex]))
		if instrumentType != "CE" && instrumentType != "PE" {
			continue
		}

		if okExchange && exchangeIndex < len(row) && !strings.EqualFold(strings.TrimSpace(row[exchangeIndex]), "NFO") {
			continue
		}
		if okSegment && segmentIndex < len(row) {
			segment := strings.ToUpper(strings.TrimSpace(row[segmentIndex]))
			if segment != "" && segment != "NFO-OPT" {
				continue
			}
		}

		name := ""
		if hasName && nameIndex < len(row) {
			name = strings.ToUpper(strings.TrimSpace(row[nameIndex]))
		}
		if name != "" && name != "NIFTY" {
			continue
		}
		if !strings.HasPrefix(symbol, "NIFTY") {
			continue
		}

		expiry, expiryErr := parseOptionInstrumentExpiry(row[expiryIndex], s.indiaLocation)
		if expiryErr != nil || expiry.Before(dayStart) {
			continue
		}

		strike, strikeErr := strconv.ParseFloat(strings.TrimSpace(row[strikeIndex]), 64)
		if strikeErr != nil || strike <= 0 {
			continue
		}

		lotSize := int64(defaultOptionLot)
		if okLotSize && lotSizeIndex < len(row) {
			if parsed, parseErr := strconv.ParseFloat(strings.TrimSpace(row[lotSizeIndex]), 64); parseErr == nil && parsed > 0 {
				lotSize = int64(math.Round(parsed))
			}
		}

		valid = append(valid, optionInstrument{
			Token:         token,
			TradingSymbol: symbol,
			Expiry:        expiry,
			Strike:        strike,
			OptionType:    instrumentType,
			LotSize:       lotSize,
		})

		if nearestExpiry.IsZero() || expiry.Before(nearestExpiry) {
			nearestExpiry = expiry
		}
	}

	if len(valid) == 0 || nearestExpiry.IsZero() {
		if len(cached.Pairs) > 0 {
			return cached, nil
		}
		return cachedOptionInstrumentSet{}, ErrNoCandles
	}

	pairs := make(map[int64]optionInstrumentPair)
	for _, instrument := range valid {
		if !instrument.Expiry.Equal(nearestExpiry) {
			continue
		}
		strikeKey := int64(math.Round(instrument.Strike))
		if strikeKey <= 0 {
			continue
		}
		pair := pairs[strikeKey]
		pair.Strike = instrument.Strike
		if instrument.OptionType == "CE" {
			pair.Call = instrument
			pair.HasCall = true
		} else if instrument.OptionType == "PE" {
			pair.Put = instrument
			pair.HasPut = true
		}
		pairs[strikeKey] = pair
	}

	sortedKeys := make([]int64, 0, len(pairs))
	filteredPairs := make(map[int64]optionInstrumentPair, len(pairs))
	for strike, pair := range pairs {
		if !pair.HasCall || !pair.HasPut {
			continue
		}
		filteredPairs[strike] = pair
		sortedKeys = append(sortedKeys, strike)
	}
	if len(filteredPairs) == 0 {
		if len(cached.Pairs) > 0 {
			return cached, nil
		}
		return cachedOptionInstrumentSet{}, ErrNoCandles
	}

	sort.Slice(sortedKeys, func(i, j int) bool {
		return sortedKeys[i] < sortedKeys[j]
	})

	cacheValue := cachedOptionInstrumentSet{
		Expiry:     nearestExpiry,
		ExpiryCode: strings.ToUpper(nearestExpiry.Format("02Jan")),
		Pairs:      filteredPairs,
		SortedKeys: sortedKeys,
		CachedAt:   time.Now(),
	}

	s.optionInstrumentMu.Lock()
	s.optionInstruments = cloneOptionInstrumentSet(cacheValue)
	s.optionInstrumentMu.Unlock()

	return cloneOptionInstrumentSet(cacheValue), nil
}

func floorOptionStrikeKey(sortedKeys []int64, target float64) int64 {
	if len(sortedKeys) == 0 {
		return 0
	}
	if target <= 0 {
		return sortedKeys[len(sortedKeys)/2]
	}

	best := sortedKeys[0]
	bestDistance := math.Abs(float64(best) - target)
	for _, strike := range sortedKeys[1:] {
		distance := math.Abs(float64(strike) - target)
		if distance < bestDistance {
			best = strike
			bestDistance = distance
			continue
		}
		// On equal distance, prefer the higher strike (standard ATM rounding behavior).
		if distance == bestDistance && strike > best {
			best = strike
		}
	}
	return best
}

func selectOptionInstrumentPairsAroundATM(set cachedOptionInstrumentSet, underlying float64, strikesEachSide int) []optionInstrumentPair {
	if len(set.SortedKeys) == 0 || len(set.Pairs) == 0 {
		return nil
	}
	if strikesEachSide < 0 {
		strikesEachSide = 0
	}

	target := underlying
	if target <= 0 {
		target = float64(set.SortedKeys[len(set.SortedKeys)/2])
	}

	atmKey := floorOptionStrikeKey(set.SortedKeys, target)
	atmIndex := 0
	for index, strike := range set.SortedKeys {
		if strike == atmKey {
			atmIndex = index
			break
		}
	}

	windowSize := strikesEachSide*2 + 1
	if windowSize < 1 {
		windowSize = 1
	}
	if windowSize > len(set.SortedKeys) {
		windowSize = len(set.SortedKeys)
	}

	start := atmIndex - strikesEachSide
	end := atmIndex + strikesEachSide
	if start < 0 {
		end += -start
		start = 0
	}
	if end >= len(set.SortedKeys) {
		shiftLeft := end - (len(set.SortedKeys) - 1)
		start -= shiftLeft
		end = len(set.SortedKeys) - 1
		if start < 0 {
			start = 0
		}
	}

	currentSize := end - start + 1
	if currentSize < windowSize {
		missing := windowSize - currentSize
		start -= missing
		if start < 0 {
			start = 0
		}
		end = start + windowSize - 1
		if end >= len(set.SortedKeys) {
			end = len(set.SortedKeys) - 1
			start = end - windowSize + 1
			if start < 0 {
				start = 0
			}
		}
	}

	output := make([]optionInstrumentPair, 0, end-start+1)
	for _, strike := range set.SortedKeys[start : end+1] {
		pair, ok := set.Pairs[strike]
		if !ok || !pair.HasCall || !pair.HasPut {
			continue
		}
		output = append(output, pair)
	}
	return output
}

func (s *Service) getNiftyIndexSpotAt(ctx context.Context, at time.Time) (float64, int64, error) {
	from := at.UTC().Add(-3 * time.Minute)
	to := at.UTC().Add(3 * time.Minute)

	candles, _, err := s.fetchZerodhaCandlesByTokenCached(ctx, s.zerodhaNiftyToken, from, to, "1m")
	if err == nil && len(candles) > 0 {
		target := at.UTC().Unix()
		best := candles[0]
		bestDistance := absInt64(best.Timestamp - target)
		exactFound := best.Timestamp == target

		if !exactFound {
			for _, candle := range candles[1:] {
				distance := absInt64(candle.Timestamp - target)
				if candle.Timestamp == target {
					best = candle
					bestDistance = 0
					exactFound = true
					break
				}

				if distance < bestDistance {
					best = candle
					bestDistance = distance
					continue
				}

				// On equal distance, prefer the earlier candle to avoid future leakage.
				if distance == bestDistance && candle.Timestamp <= target && best.Timestamp > target {
					best = candle
				}
			}
		}

		// For timestamp snapshots, close aligns better with the option candle close used in historical fetches.
		price := best.Close
		if price <= 0 {
			price = best.Open
		}
		if price > 0 {
			return price, best.Timestamp, nil
		}
	}

	quotes, quoteErr := s.fetchZerodhaQuotes(ctx, []string{"NSE:NIFTY 50"})
	if quoteErr != nil {
		if err != nil {
			return 0, 0, err
		}
		return 0, 0, quoteErr
	}

	if quote, ok := quotes["NSE:NIFTY 50"]; ok && quote.LastPrice > 0 {
		resolvedTimestamp := at.UTC().Unix()
		if quote.Timestamp > 0 {
			resolvedTimestamp = quote.Timestamp
		}
		return quote.LastPrice, resolvedTimestamp, nil
	}

	if err != nil {
		return 0, 0, err
	}
	return 0, 0, ErrNoCandles
}

type zerodhaQuoteRow struct {
	LastPrice float64
	OHLCClose float64
	Volume    int64
	OI        int64
	Timestamp int64
}

func (s *Service) fetchZerodhaQuotes(ctx context.Context, instruments []string) (map[string]zerodhaQuoteRow, error) {
	output := make(map[string]zerodhaQuoteRow)
	if len(instruments) == 0 {
		return output, nil
	}

	apiKey, accessToken, err := s.getZerodhaAuth()
	if err != nil {
		return output, err
	}

	values := url.Values{}
	for _, instrument := range instruments {
		trimmed := strings.TrimSpace(instrument)
		if trimmed == "" {
			continue
		}
		values.Add("i", trimmed)
	}
	if len(values["i"]) == 0 {
		return output, nil
	}

	requestURL := fmt.Sprintf("%s/quote?%s", s.zerodhaBaseURL, values.Encode())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return output, err
	}

	req.Header.Set("Accept", "application/json")
	req.Header.Set("X-Kite-Version", "3")
	req.Header.Set("Authorization", fmt.Sprintf("token %s:%s", apiKey, accessToken))
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return output, err
	}
	defer resp.Body.Close()

	var payload struct {
		Status    string `json:"status"`
		ErrorType string `json:"error_type"`
		Message   string `json:"message"`
		Data      map[string]struct {
			LastPrice float64 `json:"last_price"`
			Volume    float64 `json:"volume"`
			OI        float64 `json:"oi"`
			OHLC      struct {
				Close float64 `json:"close"`
			} `json:"ohlc"`
			Timestamp     string `json:"timestamp"`
			LastTradeTime string `json:"last_trade_time"`
		} `json:"data"`
	}

	if decodeErr := json.NewDecoder(resp.Body).Decode(&payload); decodeErr != nil {
		return output, decodeErr
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 || strings.EqualFold(strings.TrimSpace(payload.Status), "error") {
		message := strings.TrimSpace(payload.Message)
		if message == "" {
			message = fmt.Sprintf("zerodha quote request failed (%d)", resp.StatusCode)
		}
		return output, fmt.Errorf("%s", message)
	}

	for key, row := range payload.Data {
		normalizedKey := strings.ToUpper(strings.TrimSpace(key))
		if normalizedKey == "" {
			continue
		}

		timestamp := int64(0)
		for _, rawTimestamp := range []string{row.Timestamp, row.LastTradeTime} {
			if strings.TrimSpace(rawTimestamp) == "" {
				continue
			}
			if parsed, parseErr := parseKiteTimestamp(rawTimestamp); parseErr == nil {
				timestamp = parsed.UTC().Unix()
				break
			}
			if parsed, parseErr := time.ParseInLocation("2006-01-02 15:04:05", rawTimestamp, s.indiaLocation); parseErr == nil {
				timestamp = parsed.UTC().Unix()
				break
			}
		}

		output[normalizedKey] = zerodhaQuoteRow{
			LastPrice: row.LastPrice,
			OHLCClose: row.OHLC.Close,
			Volume:    int64(math.Round(row.Volume)),
			OI:        int64(math.Round(row.OI)),
			Timestamp: timestamp,
		}
	}

	return output, nil
}

func optionDisplayOIValue(rawOI int64, lotSize int64) float64 {
	_ = lotSize
	return roundTo(float64(rawOI)/float64(defaultOptionLot), 1)
}

func optionSnapshotTimestamp(unixTimestamp int64, interval time.Duration) int64 {
	seconds := int64(interval / time.Second)
	if seconds <= 0 {
		seconds = 60
	}
	return (unixTimestamp / seconds) * seconds
}

func (s *Service) buildOptionSnapshotFromQuote(ctx context.Context, at time.Time) (OptionSnapshotResponse, error) {
	instruments, err := s.getNearestNiftyOptionInstruments(ctx, at)
	if err != nil {
		return OptionSnapshotResponse{}, err
	}

	underlying, resolvedTimestamp, spotErr := s.getNiftyIndexSpotAt(ctx, at)
	if spotErr != nil {
		resolvedTimestamp = at.UTC().Unix()
	}
	selectedPairs := selectOptionInstrumentPairsAroundATM(instruments, underlying, optionStrikeDepth)
	if len(selectedPairs) == 0 {
		return OptionSnapshotResponse{}, ErrNoCandles
	}

	quoteKeys := make([]string, 0, len(selectedPairs)*2+1)
	quoteKeys = append(quoteKeys, "NSE:NIFTY 50")
	for _, pair := range selectedPairs {
		quoteKeys = append(quoteKeys, "NFO:"+pair.Call.TradingSymbol)
		quoteKeys = append(quoteKeys, "NFO:"+pair.Put.TradingSymbol)
	}

	quotes, err := s.fetchZerodhaQuotes(ctx, quoteKeys)
	if err != nil {
		return OptionSnapshotResponse{}, err
	}

	if underlying <= 0 {
		if quote, ok := quotes["NSE:NIFTY 50"]; ok && quote.LastPrice > 0 {
			underlying = quote.LastPrice
			if quote.Timestamp > 0 {
				resolvedTimestamp = quote.Timestamp
			}
		}
	}
	if resolvedTimestamp <= 0 {
		resolvedTimestamp = at.UTC().Unix()
	}

	optionData := make(map[string]float64, len(selectedPairs)*2)
	rows := make([]OptionChainRow, 0, len(selectedPairs)*2)
	strikes := make([]OptionStrikeSnapshot, 0, len(selectedPairs))
	expiryDate := instruments.Expiry.In(s.indiaLocation).Format("2006-01-02")
	snapshotTimestamp := optionSnapshotTimestamp(resolvedTimestamp, s.optionInterval)

	for _, pair := range selectedPairs {
		callKey := "NFO:" + pair.Call.TradingSymbol
		putKey := "NFO:" + pair.Put.TradingSymbol
		callQuote := quotes[strings.ToUpper(callKey)]
		putQuote := quotes[strings.ToUpper(putKey)]

		callIV := estimateImpliedVol("CE", callQuote.LastPrice, underlying, pair.Strike, instruments.Expiry, at)
		putIV := estimateImpliedVol("PE", putQuote.LastPrice, underlying, pair.Strike, instruments.Expiry, at)

		callMetrics := OptionLegMetrics{
			OI:     callQuote.OI,
			Volume: callQuote.Volume,
			IV:     callIV,
			LTP:    roundTo(callQuote.LastPrice, 2),
		}
		putMetrics := OptionLegMetrics{
			OI:     putQuote.OI,
			Volume: putQuote.Volume,
			IV:     putIV,
			LTP:    roundTo(putQuote.LastPrice, 2),
		}

		strikes = append(strikes, OptionStrikeSnapshot{
			Strike: pair.Strike,
			Call:   callMetrics,
			Put:    putMetrics,
		})

		rows = append(rows, OptionChainRow{
			Timestamp: snapshotTimestamp,
			Symbol:    "NIFTY",
			Expiry:    expiryDate,
			Strike:    pair.Strike,
			Type:      "CE",
			OI:        callMetrics.OI,
			Volume:    callMetrics.Volume,
			IV:        callMetrics.IV,
			LTP:       callMetrics.LTP,
		})
		rows = append(rows, OptionChainRow{
			Timestamp: snapshotTimestamp,
			Symbol:    "NIFTY",
			Expiry:    expiryDate,
			Strike:    pair.Strike,
			Type:      "PE",
			OI:        putMetrics.OI,
			Volume:    putMetrics.Volume,
			IV:        putMetrics.IV,
			LTP:       putMetrics.LTP,
		})

		optionData[callKey] = optionDisplayOIValue(callMetrics.OI, pair.Call.LotSize)
		optionData[putKey] = optionDisplayOIValue(putMetrics.OI, pair.Put.LotSize)
	}

	if len(strikes) == 0 {
		return OptionSnapshotResponse{}, ErrNoCandles
	}

	sort.Slice(strikes, func(i, j int) bool {
		return strikes[i].Strike < strikes[j].Strike
	})
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Strike == rows[j].Strike {
			return rows[i].Type < rows[j].Type
		}
		return rows[i].Strike < rows[j].Strike
	})

	if underlying <= 0 {
		underlying = inferUnderlyingFromStrikes(strikes)
	}

	return OptionSnapshotResponse{
		Timestamp:  snapshotTimestamp,
		Symbol:     "NIFTY",
		Expiry:     expiryDate,
		Underlying: roundTo(underlying, 2),
		Source:     "zerodha-quote",
		Interval:   s.optionIntervalLabel,
		ExpiryCode: instruments.ExpiryCode,
		Data:       optionData,
		Rows:       rows,
		Strikes:    strikes,
	}, nil
}

type optionHistoricalPoint struct {
	Timestamp int64
	Close     float64
	Volume    int64
	OI        int64
}

func (s *Service) fetchZerodhaOptionPoint(ctx context.Context, instrumentToken string, targetTimestamp int64) (optionHistoricalPoint, error) {
	apiKey, accessToken, err := s.getZerodhaAuth()
	if err != nil {
		return optionHistoricalPoint{}, err
	}

	windowStart := time.Unix(targetTimestamp-180, 0).In(s.indiaLocation)
	windowEnd := time.Unix(targetTimestamp+180, 0).In(s.indiaLocation)
	values := url.Values{}
	values.Set("from", windowStart.Format("2006-01-02 15:04:05"))
	values.Set("to", windowEnd.Format("2006-01-02 15:04:05"))
	values.Set("continuous", "0")
	values.Set("oi", "1")

	requestURL := fmt.Sprintf(
		"%s/instruments/historical/%s/minute?%s",
		s.zerodhaBaseURL,
		url.PathEscape(strings.TrimSpace(instrumentToken)),
		values.Encode(),
	)
	lastErr := error(nil)
	for attempt := 0; attempt < 3; attempt++ {
		req, reqErr := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
		if reqErr != nil {
			return optionHistoricalPoint{}, reqErr
		}

		req.Header.Set("Accept", "application/json")
		req.Header.Set("X-Kite-Version", "3")
		req.Header.Set("Authorization", fmt.Sprintf("token %s:%s", apiKey, accessToken))
		req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")

		resp, doErr := s.httpClient.Do(req)
		if doErr != nil {
			lastErr = doErr
			time.Sleep(time.Duration(attempt+1) * 180 * time.Millisecond)
			continue
		}

		var payload struct {
			Status    string `json:"status"`
			ErrorType string `json:"error_type"`
			Message   string `json:"message"`
			Data      struct {
				Candles [][]any `json:"candles"`
			} `json:"data"`
		}

		decodeErr := json.NewDecoder(resp.Body).Decode(&payload)
		resp.Body.Close()
		if decodeErr != nil {
			lastErr = decodeErr
			time.Sleep(time.Duration(attempt+1) * 180 * time.Millisecond)
			continue
		}

		if resp.StatusCode < 200 || resp.StatusCode >= 300 || strings.EqualFold(strings.TrimSpace(payload.Status), "error") {
			message := strings.TrimSpace(payload.Message)
			if message == "" {
				message = fmt.Sprintf("zerodha historical option request failed (%d)", resp.StatusCode)
			}
			lastErr = fmt.Errorf("%s", message)
			if resp.StatusCode == http.StatusTooManyRequests || strings.Contains(strings.ToLower(message), "too many requests") || strings.Contains(strings.ToLower(message), "rate limit") {
				time.Sleep(time.Duration(attempt+1) * 220 * time.Millisecond)
				continue
			}
			return optionHistoricalPoint{}, lastErr
		}

		best := optionHistoricalPoint{}
		bestDistance := int64(1<<62 - 1)
		for _, row := range payload.Data.Candles {
			if len(row) < 7 {
				continue
			}

			timestamp, parseErr := parseKiteTimestamp(row[0])
			if parseErr != nil {
				continue
			}
			closePrice, okClose := anyToFloat64(row[4])
			volume, okVolume := anyToFloat64(row[5])
			oi, okOI := anyToFloat64(row[6])
			if !okClose || !okVolume || !okOI {
				continue
			}

			unixTimestamp := timestamp.UTC().Unix()
			distance := absInt64(unixTimestamp - targetTimestamp)
			if distance > bestDistance {
				continue
			}
			bestDistance = distance
			best = optionHistoricalPoint{
				Timestamp: unixTimestamp,
				Close:     closePrice,
				Volume:    int64(math.Round(volume)),
				OI:        int64(math.Round(oi)),
			}
		}

		if bestDistance == int64(1<<62-1) {
			return optionHistoricalPoint{}, ErrNoCandles
		}
		return best, nil
	}

	if lastErr != nil {
		return optionHistoricalPoint{}, lastErr
	}
	return optionHistoricalPoint{}, ErrNoCandles
}

func (s *Service) buildOptionSnapshotFromHistorical(ctx context.Context, at time.Time) (OptionSnapshotResponse, error) {
	instruments, err := s.getNearestNiftyOptionInstruments(ctx, at)
	if err != nil {
		return OptionSnapshotResponse{}, err
	}

	underlying, resolvedTimestamp, spotErr := s.getNiftyIndexSpotAt(ctx, at)
	if spotErr != nil {
		underlying = 0
		resolvedTimestamp = at.UTC().Unix()
	}

	selectedPairs := selectOptionInstrumentPairsAroundATM(instruments, underlying, optionStrikeDepth)
	if len(selectedPairs) == 0 {
		return OptionSnapshotResponse{}, ErrNoCandles
	}

	type legResult struct {
		Strike     float64
		OptionType string
		Key        string
		LotSize    int64
		Value      optionHistoricalPoint
		Err        error
	}

	targetTimestamp := at.UTC().Unix()
	tasks := make([]struct {
		Strike     float64
		OptionType string
		Key        string
		Token      string
		LotSize    int64
	}, 0, len(selectedPairs)*2)
	for _, pair := range selectedPairs {
		tasks = append(tasks, struct {
			Strike     float64
			OptionType string
			Key        string
			Token      string
			LotSize    int64
		}{
			Strike:     pair.Strike,
			OptionType: "CE",
			Key:        "NFO:" + pair.Call.TradingSymbol,
			Token:      pair.Call.Token,
			LotSize:    pair.Call.LotSize,
		})
		tasks = append(tasks, struct {
			Strike     float64
			OptionType string
			Key        string
			Token      string
			LotSize    int64
		}{
			Strike:     pair.Strike,
			OptionType: "PE",
			Key:        "NFO:" + pair.Put.TradingSymbol,
			Token:      pair.Put.Token,
			LotSize:    pair.Put.LotSize,
		})
	}

	workers := 2
	if workers > len(tasks) {
		workers = len(tasks)
	}
	if workers < 1 {
		workers = 1
	}

	jobCh := make(chan struct {
		Strike     float64
		OptionType string
		Key        string
		Token      string
		LotSize    int64
	})
	resultCh := make(chan legResult, len(tasks))
	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for task := range jobCh {
				value, fetchErr := s.fetchZerodhaOptionPoint(ctx, task.Token, targetTimestamp)
				resultCh <- legResult{
					Strike:     task.Strike,
					OptionType: task.OptionType,
					Key:        task.Key,
					LotSize:    task.LotSize,
					Value:      value,
					Err:        fetchErr,
				}
			}
		}()
	}

	go func() {
		for _, task := range tasks {
			jobCh <- task
		}
		close(jobCh)
		wg.Wait()
		close(resultCh)
	}()

	type strikeState struct {
		Strike    float64
		CallKey   string
		PutKey    string
		CallLot   int64
		PutLot    int64
		CallValue optionHistoricalPoint
		PutValue  optionHistoricalPoint
		HasCall   bool
		HasPut    bool
	}

	stateByStrike := make(map[int64]*strikeState, len(selectedPairs))
	for _, pair := range selectedPairs {
		strikeKey := int64(math.Round(pair.Strike))
		if strikeKey <= 0 {
			continue
		}
		stateByStrike[strikeKey] = &strikeState{
			Strike:  pair.Strike,
			CallKey: "NFO:" + pair.Call.TradingSymbol,
			PutKey:  "NFO:" + pair.Put.TradingSymbol,
			CallLot: pair.Call.LotSize,
			PutLot:  pair.Put.LotSize,
		}
	}

	for result := range resultCh {
		if result.Err != nil {
			continue
		}

		strikeKey := int64(math.Round(result.Strike))
		state, ok := stateByStrike[strikeKey]
		if !ok {
			continue
		}
		if result.OptionType == "CE" {
			state.CallValue = result.Value
			state.HasCall = true
			continue
		}
		state.PutValue = result.Value
		state.HasPut = true
	}

	expiryDate := instruments.Expiry.In(s.indiaLocation).Format("2006-01-02")

	// Fill missing legs from nearest persisted DB snapshot around the target minute.
	type strikeLeg struct {
		Strike int64
		Type   string
	}
	fallbackLegs := make(map[strikeLeg]OptionLegMetrics, len(selectedPairs)*2)
	if dbSnapshot, ok, dbErr := s.getOptionSnapshotFromDBNearest(ctx, "NIFTY", targetTimestamp, 3600); dbErr == nil && ok {
		for _, row := range dbSnapshot.Rows {
			strikeKey := int64(math.Round(row.Strike))
			if strikeKey <= 0 {
				continue
			}
			optionType := strings.ToUpper(strings.TrimSpace(row.Type))
			if optionType != "CE" && optionType != "PE" {
				continue
			}
			fallbackLegs[strikeLeg{Strike: strikeKey, Type: optionType}] = OptionLegMetrics{
				OI:     row.OI,
				Volume: row.Volume,
				IV:     row.IV,
				LTP:    row.LTP,
			}
		}
	}

	missingQuoteKeys := make([]string, 0, len(selectedPairs)*2)
	for _, pair := range selectedPairs {
		strikeKey := int64(math.Round(pair.Strike))
		state, ok := stateByStrike[strikeKey]
		if !ok || state == nil {
			continue
		}

		if !state.HasCall {
			if metrics, exists := fallbackLegs[strikeLeg{Strike: strikeKey, Type: "CE"}]; exists && (metrics.OI > 0 || metrics.LTP > 0) {
				state.CallValue = optionHistoricalPoint{
					Timestamp: targetTimestamp,
					Close:     metrics.LTP,
					Volume:    metrics.Volume,
					OI:        metrics.OI,
				}
				state.HasCall = true
			}
		}
		if !state.HasPut {
			if metrics, exists := fallbackLegs[strikeLeg{Strike: strikeKey, Type: "PE"}]; exists && (metrics.OI > 0 || metrics.LTP > 0) {
				state.PutValue = optionHistoricalPoint{
					Timestamp: targetTimestamp,
					Close:     metrics.LTP,
					Volume:    metrics.Volume,
					OI:        metrics.OI,
				}
				state.HasPut = true
			}
		}

		if !state.HasCall && strings.TrimSpace(state.CallKey) != "" {
			missingQuoteKeys = append(missingQuoteKeys, state.CallKey)
		}
		if !state.HasPut && strings.TrimSpace(state.PutKey) != "" {
			missingQuoteKeys = append(missingQuoteKeys, state.PutKey)
		}
	}

	// Strike-level DB fallback for any remaining missing CE/PE legs.
	for _, pair := range selectedPairs {
		strikeKey := int64(math.Round(pair.Strike))
		state, ok := stateByStrike[strikeKey]
		if !ok || state == nil {
			continue
		}
		if !state.HasCall {
			if metrics, exists, legErr := s.loadNearestOptionLegFromDB(
				ctx,
				"NIFTY",
				expiryDate,
				pair.Strike,
				"CE",
				targetTimestamp,
				2*60*60,
			); legErr == nil && exists {
				state.CallValue = optionHistoricalPoint{
					Timestamp: targetTimestamp,
					Close:     metrics.LTP,
					Volume:    metrics.Volume,
					OI:        metrics.OI,
				}
				state.HasCall = true
			}
		}
		if !state.HasPut {
			if metrics, exists, legErr := s.loadNearestOptionLegFromDB(
				ctx,
				"NIFTY",
				expiryDate,
				pair.Strike,
				"PE",
				targetTimestamp,
				2*60*60,
			); legErr == nil && exists {
				state.PutValue = optionHistoricalPoint{
					Timestamp: targetTimestamp,
					Close:     metrics.LTP,
					Volume:    metrics.Volume,
					OI:        metrics.OI,
				}
				state.HasPut = true
			}
		}
	}

	if len(missingQuoteKeys) > 0 {
		if quotes, quoteErr := s.fetchZerodhaQuotes(ctx, missingQuoteKeys); quoteErr == nil {
			for _, pair := range selectedPairs {
				strikeKey := int64(math.Round(pair.Strike))
				state, ok := stateByStrike[strikeKey]
				if !ok || state == nil {
					continue
				}

				if !state.HasCall {
					if quote, exists := quotes[strings.ToUpper(strings.TrimSpace(state.CallKey))]; exists && (quote.OI > 0 || quote.LastPrice > 0) {
						state.CallValue = optionHistoricalPoint{
							Timestamp: targetTimestamp,
							Close:     quote.LastPrice,
							Volume:    quote.Volume,
							OI:        quote.OI,
						}
						state.HasCall = true
					}
				}
				if !state.HasPut {
					if quote, exists := quotes[strings.ToUpper(strings.TrimSpace(state.PutKey))]; exists && (quote.OI > 0 || quote.LastPrice > 0) {
						state.PutValue = optionHistoricalPoint{
							Timestamp: targetTimestamp,
							Close:     quote.LastPrice,
							Volume:    quote.Volume,
							OI:        quote.OI,
						}
						state.HasPut = true
					}
				}
			}
		}
	}

	optionData := make(map[string]float64, len(selectedPairs)*2)
	rows := make([]OptionChainRow, 0, len(selectedPairs)*2)
	strikes := make([]OptionStrikeSnapshot, 0, len(selectedPairs))
	snapshotTimestamp := optionSnapshotTimestamp(targetTimestamp, s.optionInterval)
	if snapshotTimestamp <= 0 {
		snapshotTimestamp = optionSnapshotTimestamp(resolvedTimestamp, s.optionInterval)
	}

	for _, pair := range selectedPairs {
		strike := int64(math.Round(pair.Strike))
		state := stateByStrike[strike]
		if state == nil {
			continue
		}
		if !state.HasCall && !state.HasPut {
			continue
		}

		callIV := estimateImpliedVol("CE", state.CallValue.Close, underlying, state.Strike, instruments.Expiry, at)
		putIV := estimateImpliedVol("PE", state.PutValue.Close, underlying, state.Strike, instruments.Expiry, at)

		callMetrics := OptionLegMetrics{
			OI:     state.CallValue.OI,
			Volume: state.CallValue.Volume,
			IV:     callIV,
			LTP:    roundTo(state.CallValue.Close, 2),
		}
		putMetrics := OptionLegMetrics{
			OI:     state.PutValue.OI,
			Volume: state.PutValue.Volume,
			IV:     putIV,
			LTP:    roundTo(state.PutValue.Close, 2),
		}

		strikes = append(strikes, OptionStrikeSnapshot{
			Strike: state.Strike,
			Call:   callMetrics,
			Put:    putMetrics,
		})

		rows = append(rows, OptionChainRow{
			Timestamp: snapshotTimestamp,
			Symbol:    "NIFTY",
			Expiry:    expiryDate,
			Strike:    state.Strike,
			Type:      "CE",
			OI:        callMetrics.OI,
			Volume:    callMetrics.Volume,
			IV:        callMetrics.IV,
			LTP:       callMetrics.LTP,
		})
		rows = append(rows, OptionChainRow{
			Timestamp: snapshotTimestamp,
			Symbol:    "NIFTY",
			Expiry:    expiryDate,
			Strike:    state.Strike,
			Type:      "PE",
			OI:        putMetrics.OI,
			Volume:    putMetrics.Volume,
			IV:        putMetrics.IV,
			LTP:       putMetrics.LTP,
		})

		optionData[state.CallKey] = optionDisplayOIValue(callMetrics.OI, state.CallLot)
		optionData[state.PutKey] = optionDisplayOIValue(putMetrics.OI, state.PutLot)
	}

	if len(strikes) == 0 {
		return OptionSnapshotResponse{}, ErrNoCandles
	}

	sort.Slice(strikes, func(i, j int) bool {
		return strikes[i].Strike < strikes[j].Strike
	})
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].Strike == rows[j].Strike {
			return rows[i].Type < rows[j].Type
		}
		return rows[i].Strike < rows[j].Strike
	})

	if underlying <= 0 {
		underlying = inferUnderlyingFromStrikes(strikes)
	}

	return OptionSnapshotResponse{
		Timestamp:  snapshotTimestamp,
		Symbol:     "NIFTY",
		Expiry:     expiryDate,
		Underlying: roundTo(underlying, 2),
		Source:     "zerodha-historical",
		Interval:   s.optionIntervalLabel,
		ExpiryCode: instruments.ExpiryCode,
		Data:       optionData,
		Rows:       rows,
		Strikes:    strikes,
	}, nil
}

func cloneOptionSnapshot(input OptionSnapshotResponse) OptionSnapshotResponse {
	output := input

	if len(input.Strikes) > 0 {
		output.Strikes = append([]OptionStrikeSnapshot{}, input.Strikes...)
	} else {
		output.Strikes = nil
	}

	if len(input.Rows) > 0 {
		output.Rows = append([]OptionChainRow{}, input.Rows...)
	} else {
		output.Rows = nil
	}

	if len(input.Data) > 0 {
		output.Data = make(map[string]float64, len(input.Data))
		for key, value := range input.Data {
			output.Data[key] = value
		}
	} else {
		output.Data = nil
	}

	return output
}

func snapshotTotals(snapshot OptionSnapshotResponse) (int64, int64, int64) {
	var callOI int64
	var putOI int64
	for _, strike := range snapshot.Strikes {
		callOI += strike.Call.OI
		putOI += strike.Put.OI
	}
	return callOI, putOI, callOI + putOI
}

func sumSnapshotTotals(snapshots []OptionSnapshotResponse) (int64, int64, int64) {
	var callOI int64
	var putOI int64
	for _, snapshot := range snapshots {
		call, put, _ := snapshotTotals(snapshot)
		callOI += call
		putOI += put
	}
	return callOI, putOI, callOI + putOI
}

func highestOiInSnapshots(snapshots []OptionSnapshotResponse) (float64, int64, int64, float64, int64, int64) {
	var highestCallStrike float64
	var highestCallOI int64
	var highestCallTimestamp int64
	var highestPutStrike float64
	var highestPutOI int64
	var highestPutTimestamp int64

	for _, snapshot := range snapshots {
		for _, strike := range snapshot.Strikes {
			if strike.Call.OI > highestCallOI {
				highestCallOI = strike.Call.OI
				highestCallStrike = strike.Strike
				highestCallTimestamp = snapshot.Timestamp
			}
			if strike.Put.OI > highestPutOI {
				highestPutOI = strike.Put.OI
				highestPutStrike = strike.Strike
				highestPutTimestamp = snapshot.Timestamp
			}
		}
	}

	return highestCallStrike, highestCallOI, highestCallTimestamp, highestPutStrike, highestPutOI, highestPutTimestamp
}

func parseStrikeFromOptionSymbol(symbol string) (int64, bool) {
	text := strings.ToUpper(strings.TrimSpace(symbol))
	if text == "" {
		return 0, false
	}

	if !(strings.HasSuffix(text, "CE") || strings.HasSuffix(text, "PE")) {
		return 0, false
	}

	withoutType := text[:len(text)-2]
	index := len(withoutType) - 1
	for index >= 0 {
		char := withoutType[index]
		if char < '0' || char > '9' {
			break
		}
		index--
	}
	if index == len(withoutType)-1 {
		return 0, false
	}

	strikeRaw := withoutType[index+1:]
	strike, err := strconv.ParseInt(strikeRaw, 10, 64)
	if err != nil || strike <= 0 {
		return 0, false
	}

	return strike, true
}

func atmStrikeIndex(strikes []OptionStrikeSnapshot, underlying float64) int {
	if len(strikes) == 0 {
		return -1
	}
	if underlying <= 0 {
		return len(strikes) / 2
	}

	bestIndex := 0
	bestDistance := math.Abs(strikes[0].Strike - underlying)
	for index := 1; index < len(strikes); index++ {
		distance := math.Abs(strikes[index].Strike - underlying)
		if distance < bestDistance {
			bestIndex = index
			bestDistance = distance
			continue
		}
		// On equal distance, prefer the higher strike.
		if distance == bestDistance && strikes[index].Strike > strikes[bestIndex].Strike {
			bestIndex = index
		}
	}
	return bestIndex
}

func trimOptionSnapshotAroundATM(snapshot OptionSnapshotResponse, strikesEachSide int) OptionSnapshotResponse {
	trimmed := cloneOptionSnapshot(snapshot)
	if len(trimmed.Strikes) == 0 {
		return trimmed
	}

	if strikesEachSide < 0 {
		strikesEachSide = 0
	}

	atmIndex := atmStrikeIndex(trimmed.Strikes, trimmed.Underlying)
	if atmIndex < 0 {
		return trimmed
	}

	start := atmIndex - strikesEachSide
	if start < 0 {
		start = 0
	}
	end := atmIndex + strikesEachSide
	if end >= len(trimmed.Strikes) {
		end = len(trimmed.Strikes) - 1
	}

	limitedStrikes := append([]OptionStrikeSnapshot{}, trimmed.Strikes[start:end+1]...)
	allowedStrikes := make(map[int64]struct{}, len(limitedStrikes))
	for _, strike := range limitedStrikes {
		value := int64(math.Round(strike.Strike))
		if value > 0 {
			allowedStrikes[value] = struct{}{}
		}
	}

	filterRows := make([]OptionChainRow, 0, len(trimmed.Rows))
	for _, row := range trimmed.Rows {
		strike := int64(math.Round(row.Strike))
		if _, ok := allowedStrikes[strike]; ok {
			filterRows = append(filterRows, row)
		}
	}

	filterData := make(map[string]float64)
	for key, value := range trimmed.Data {
		strike, ok := parseStrikeFromOptionSymbol(key)
		if !ok {
			continue
		}
		if _, exists := allowedStrikes[strike]; !exists {
			continue
		}
		filterData[key] = value
	}

	trimmed.Strikes = limitedStrikes
	trimmed.Rows = filterRows
	trimmed.Data = filterData
	return trimmed
}

func snapshotDataMap(snapshot OptionSnapshotResponse) map[string]float64 {
	if len(snapshot.Data) > 0 {
		out := make(map[string]float64, len(snapshot.Data))
		for key, value := range snapshot.Data {
			out[key] = value
		}
		return out
	}

	out := make(map[string]float64, len(snapshot.Strikes)*2)
	expiryCode := strings.ToUpper(strings.TrimSpace(snapshot.ExpiryCode))
	for _, strike := range snapshot.Strikes {
		strikeValue := int64(math.Round(strike.Strike))
		if strikeValue <= 0 {
			continue
		}
		callKey := fmt.Sprintf("NFO:NIFTY%s%dCE", expiryCode, strikeValue)
		putKey := fmt.Sprintf("NFO:NIFTY%s%dPE", expiryCode, strikeValue)
		out[callKey] = float64(strike.Call.OI)
		out[putKey] = float64(strike.Put.OI)
	}
	return out
}

func intersectOptionKeysAcrossMaps(dataMaps []map[string]float64) map[string]struct{} {
	if len(dataMaps) == 0 {
		return map[string]struct{}{}
	}

	intersection := make(map[string]struct{}, len(dataMaps[0]))
	for key := range dataMaps[0] {
		intersection[key] = struct{}{}
	}

	for index := 1; index < len(dataMaps); index++ {
		current := dataMaps[index]
		for key := range intersection {
			if _, exists := current[key]; !exists {
				delete(intersection, key)
			}
		}
		if len(intersection) == 0 {
			return intersection
		}
	}

	return intersection
}

func filterOptionDataByKeys(input map[string]float64, allowed map[string]struct{}) map[string]float64 {
	if len(input) == 0 || len(allowed) == 0 {
		return map[string]float64{}
	}

	output := make(map[string]float64, len(input))
	for key, value := range input {
		if _, exists := allowed[key]; !exists {
			continue
		}
		output[key] = value
	}

	return output
}

func filterByCommonStrikes(
	ts1 OptionSnapshotResponse,
	ts2 OptionSnapshotResponse,
	ts1Data map[string]float64,
	ts2Data map[string]float64,
) (map[string]float64, map[string]float64, int) {
	ts1StrikeSet := make(map[int64]struct{})
	ts2StrikeSet := make(map[int64]struct{})

	for _, strike := range ts1.Strikes {
		value := int64(math.Round(strike.Strike))
		if value > 0 {
			ts1StrikeSet[value] = struct{}{}
		}
	}
	for _, strike := range ts2.Strikes {
		value := int64(math.Round(strike.Strike))
		if value > 0 {
			ts2StrikeSet[value] = struct{}{}
		}
	}

	commonStrikes := make(map[int64]struct{})
	for strike := range ts1StrikeSet {
		if _, ok := ts2StrikeSet[strike]; ok {
			commonStrikes[strike] = struct{}{}
		}
	}

	filter := func(input map[string]float64) map[string]float64 {
		output := make(map[string]float64)
		for key, value := range input {
			strike, ok := parseStrikeFromOptionSymbol(key)
			if !ok {
				continue
			}
			if _, exists := commonStrikes[strike]; !exists {
				continue
			}
			output[key] = value
		}
		return output
	}

	return filter(ts1Data), filter(ts2Data), len(commonStrikes)
}

func estimateImpliedVol(optionType string, optionPrice, spot, strike float64, expiry, at time.Time) float64 {
	if optionPrice <= 0 || spot <= 0 || strike <= 0 {
		return 0
	}

	timeToExpiryYears := expiry.Sub(at).Hours() / (24 * 365)
	if timeToExpiryYears <= 0 {
		return 0
	}
	if timeToExpiryYears < 1.0/(24.0*365.0) {
		timeToExpiryYears = 1.0 / (24.0 * 365.0)
	}

	isCall := strings.EqualFold(optionType, "call") || strings.EqualFold(optionType, "ce")
	intrinsic := math.Max(spot-strike, 0)
	if !isCall {
		intrinsic = math.Max(strike-spot, 0)
	}
	if optionPrice <= intrinsic {
		return 0
	}

	low := 0.0001
	high := 5.0
	for i := 0; i < 70; i++ {
		mid := (low + high) / 2
		price := blackScholesPrice(isCall, spot, strike, timeToExpiryYears, riskFreeRate, mid)
		if price > optionPrice {
			high = mid
		} else {
			low = mid
		}
	}

	return roundTo(((low+high)/2)*100.0, 2)
}

func blackScholesPrice(isCall bool, spot, strike, yearsToExpiry, rate, sigma float64) float64 {
	if sigma <= 0 || yearsToExpiry <= 0 || spot <= 0 || strike <= 0 {
		return 0
	}

	sqrtT := math.Sqrt(yearsToExpiry)
	d1 := (math.Log(spot/strike) + (rate+0.5*sigma*sigma)*yearsToExpiry) / (sigma * sqrtT)
	d2 := d1 - sigma*sqrtT

	if isCall {
		return spot*normalCDF(d1) - strike*math.Exp(-rate*yearsToExpiry)*normalCDF(d2)
	}
	return strike*math.Exp(-rate*yearsToExpiry)*normalCDF(-d2) - spot*normalCDF(-d1)
}

func normalCDF(value float64) float64 {
	return 0.5 * (1 + math.Erf(value/math.Sqrt2))
}

func inferUnderlyingFromStrikes(strikes []OptionStrikeSnapshot) float64 {
	if len(strikes) == 0 {
		return 0
	}
	mid := len(strikes) / 2
	return strikes[mid].Strike
}

func (s *Service) getLatestOptionSnapshot() (OptionSnapshotResponse, bool) {
	s.optionMu.RLock()
	defer s.optionMu.RUnlock()

	if len(s.optionHistory) == 0 {
		return OptionSnapshotResponse{}, false
	}
	return cloneOptionSnapshot(s.optionHistory[len(s.optionHistory)-1]), true
}

func (s *Service) closestOptionSnapshot(targetUnix int64) (OptionSnapshotResponse, bool) {
	s.optionMu.RLock()
	defer s.optionMu.RUnlock()

	if len(s.optionHistory) == 0 {
		return OptionSnapshotResponse{}, false
	}

	first := cloneOptionSnapshot(s.optionHistory[0])
	last := cloneOptionSnapshot(s.optionHistory[len(s.optionHistory)-1])
	if targetUnix <= first.Timestamp {
		return first, true
	}
	if targetUnix >= last.Timestamp {
		return last, true
	}

	index := sort.Search(len(s.optionHistory), func(i int) bool {
		return s.optionHistory[i].Timestamp >= targetUnix
	})
	if index <= 0 {
		return first, true
	}
	if index >= len(s.optionHistory) {
		return last, true
	}

	previous := cloneOptionSnapshot(s.optionHistory[index-1])
	next := cloneOptionSnapshot(s.optionHistory[index])
	if absInt64(previous.Timestamp-targetUnix) <= absInt64(next.Timestamp-targetUnix) {
		return previous, true
	}
	return next, true
}

func (s *Service) optionSnapshotsBetween(ctx context.Context, symbol string, startUnix, endUnix int64) []OptionSnapshotResponse {
	if endUnix < startUnix {
		startUnix, endUnix = endUnix, startUnix
	}

	s.optionMu.RLock()
	defer s.optionMu.RUnlock()

	output := make([]OptionSnapshotResponse, 0, len(s.optionHistory))
	for _, snapshot := range s.optionHistory {
		if snapshot.Timestamp < startUnix || snapshot.Timestamp > endUnix {
			continue
		}
		output = append(output, cloneOptionSnapshot(snapshot))
	}
	if len(output) > 0 {
		return output
	}

	dbSnapshots, dbErr := s.optionSnapshotsBetweenFromDB(ctx, symbol, startUnix, endUnix)
	if dbErr != nil {
		log.Printf("[option_chain_1m] range_lookup_error symbol=%s start=%d end=%d err=%v", strings.ToUpper(strings.TrimSpace(symbol)), startUnix, endUnix, dbErr)
	}
	if len(dbSnapshots) > 0 {
		return dbSnapshots
	}
	return output
}

func (s *Service) computeMover(
	ctx context.Context,
	constituent indexConstituentWeight,
	instrumentToken string,
	indexTS1Value float64,
	indexTS2Value float64,
	lookbackStartUTC time.Time,
	sessionStartUTC time.Time,
	sessionEndUTC time.Time,
	from time.Time,
	to time.Time,
	interval string,
) (Mover, error) {
	var candles []Candle
	var err error
	for attempt := 0; attempt < 3; attempt++ {
		candles, _, err = s.fetchZerodhaCandlesByTokenCached(ctx, instrumentToken, lookbackStartUTC, sessionEndUTC, interval)
		if err == nil {
			break
		}

		message := strings.ToLower(err.Error())
		retryable := strings.Contains(message, "rate") || strings.Contains(message, "too many") || strings.Contains(message, "429")
		if !retryable || attempt == 2 {
			return Mover{}, err
		}

		wait := time.Duration(attempt+1) * 350 * time.Millisecond
		select {
		case <-ctx.Done():
			return Mover{}, ctx.Err()
		case <-time.After(wait):
		}
	}

	if len(candles) == 0 {
		return Mover{}, ErrNoCandles
	}

	startCandle, ok := candleAtOrBeforeOrAfter(candles, from.Unix())
	if !ok {
		return Mover{}, ErrNoCandles
	}

	endCandle, ok := candleAtOrBeforeOrAfter(candles, to.Unix())
	if !ok {
		return Mover{}, ErrNoCandles
	}

	startPrice := startCandle.Close
	endPrice := endCandle.Close
	if startPrice == 0 || endPrice == 0 {
		return Mover{}, ErrNoCandles
	}

	previousClose := 0.0
	if previousCandle, previousOK := candleAtOrBefore(candles, sessionStartUTC.Unix()-1); previousOK && previousCandle.Close > 0 {
		previousClose = previousCandle.Close
	}
	if previousClose <= 0 {
		return Mover{}, ErrNoCandles
	}

	if indexTS1Value <= 0 || indexTS2Value <= 0 {
		return Mover{}, ErrNoCandles
	}

	pointChange := endPrice - startPrice
	ts1PerChange := ((startPrice - previousClose) / previousClose) * 100.0
	ts2PerChange := ((endPrice - previousClose) / previousClose) * 100.0
	ts1PerToIndex := ts1PerChange * (constituent.Weight / 100.0)
	ts2PerToIndex := ts2PerChange * (constituent.Weight / 100.0)
	ts1PointToIndex := (ts1PerToIndex / 100.0) * indexTS1Value
	ts2PointToIndex := (ts2PerToIndex / 100.0) * indexTS2Value
	chgPer := ts2PerChange - ts1PerChange
	perToIndex := ts2PerToIndex - ts1PerToIndex
	pointToIndex := ts2PointToIndex - ts1PointToIndex

	direction := "flat"
	if chgPer > 0 {
		direction = "up"
	} else if chgPer < 0 {
		direction = "down"
	}

	return Mover{
		Symbol:                constituent.Symbol,
		Name:                  constituent.Name,
		Weight:                roundTo(constituent.Weight, 4),
		StartPrice:            roundTo(startPrice, 2),
		EndPrice:              roundTo(endPrice, 2),
		PointChange:           roundTo(pointChange, 2),
		PerChange:             roundTo(chgPer, 4),
		PercentChange:         roundTo(chgPer, 4),
		TS1PerChange:          roundTo(ts1PerChange, 4),
		TS2PerChange:          roundTo(ts2PerChange, 4),
		PerToIndex:            roundTo(perToIndex, 6),
		TS1PerToIndex:         roundTo(ts1PerToIndex, 6),
		TS2PerToIndex:         roundTo(ts2PerToIndex, 6),
		PointToIndex:          roundTo(pointToIndex, 4),
		TS1PointToIndex:       roundTo(ts1PointToIndex, 4),
		TS2PointToIndex:       roundTo(ts2PointToIndex, 4),
		AbsolutePercentChange: roundTo(math.Abs(chgPer), 4),
		Direction:             direction,
		StartTimestamp:        startCandle.Timestamp,
		EndTimestamp:          endCandle.Timestamp,
	}, nil
}

func (s *Service) fetchYahooCandles(ctx context.Context, yahooSymbol string, from, to time.Time) ([]Candle, string, error) {
	fromUnix := from.UTC().Unix()
	toUnix := to.UTC().Unix()

	if toUnix <= fromUnix {
		return nil, "", fmt.Errorf("invalid time range")
	}

	cacheKey := strings.Join([]string{yahooSymbol, strconv.FormatInt(fromUnix, 10), strconv.FormatInt(toUnix, 10)}, "|")
	if cached, ok := s.getCachedCandles(cacheKey); ok {
		return cached.candles, cached.sourceName, nil
	}

	values := url.Values{}
	values.Set("period1", strconv.FormatInt(fromUnix, 10))
	values.Set("period2", strconv.FormatInt(toUnix, 10))
	values.Set("interval", "1m")
	values.Set("includePrePost", "false")
	values.Set("events", "div,splits")

	requestURL := yahooChartBaseURL + url.PathEscape(yahooSymbol) + "?" + values.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")

	resp, err := s.httpClient.Do(req)
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("upstream market data failed: %s", resp.Status)
	}

	var payload struct {
		Chart struct {
			Result []struct {
				Timestamp  []int64 `json:"timestamp"`
				Indicators struct {
					Quote []struct {
						Open   []*float64 `json:"open"`
						High   []*float64 `json:"high"`
						Low    []*float64 `json:"low"`
						Close  []*float64 `json:"close"`
						Volume []*float64 `json:"volume"`
					} `json:"quote"`
				} `json:"indicators"`
			} `json:"result"`
			Error *struct {
				Code        string `json:"code"`
				Description string `json:"description"`
			} `json:"error"`
		} `json:"chart"`
	}

	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		return nil, "", err
	}

	if payload.Chart.Error != nil {
		return nil, "", fmt.Errorf("market source error: %s", payload.Chart.Error.Description)
	}
	if len(payload.Chart.Result) == 0 {
		return nil, "", ErrNoCandles
	}

	result := payload.Chart.Result[0]
	if len(result.Indicators.Quote) == 0 {
		return nil, "", ErrNoCandles
	}
	quote := result.Indicators.Quote[0]

	candles := make([]Candle, 0, len(result.Timestamp))
	for idx, ts := range result.Timestamp {
		if idx >= len(quote.Open) || idx >= len(quote.High) || idx >= len(quote.Low) || idx >= len(quote.Close) {
			continue
		}
		if quote.Open[idx] == nil || quote.High[idx] == nil || quote.Low[idx] == nil || quote.Close[idx] == nil {
			continue
		}

		open := *quote.Open[idx]
		high := *quote.High[idx]
		low := *quote.Low[idx]
		closePrice := *quote.Close[idx]

		if open <= 0 || high <= 0 || low <= 0 || closePrice <= 0 {
			continue
		}

		volume := int64(0)
		if idx < len(quote.Volume) && quote.Volume[idx] != nil {
			volume = int64(math.Round(*quote.Volume[idx]))
		}

		candles = append(candles, Candle{
			Timestamp: ts,
			Open:      open,
			High:      high,
			Low:       low,
			Close:     closePrice,
			Volume:    volume,
		})
	}

	if len(candles) == 0 {
		return nil, "", ErrNoCandles
	}

	sort.Slice(candles, func(i, j int) bool {
		return candles[i].Timestamp < candles[j].Timestamp
	})

	s.setCachedCandles(cacheKey, cachedCandles{
		candles:    candles,
		expiresAt:  time.Now().Add(45 * time.Second),
		sourceName: "yahoo",
	})

	return candles, "yahoo", nil
}

func (s *Service) getCachedCandles(key string) (cachedCandles, bool) {
	s.cacheMu.RLock()
	entry, ok := s.chartCache[key]
	s.cacheMu.RUnlock()

	if !ok {
		return cachedCandles{}, false
	}
	if time.Now().After(entry.expiresAt) {
		s.cacheMu.Lock()
		delete(s.chartCache, key)
		s.cacheMu.Unlock()
		return cachedCandles{}, false
	}

	return entry, true
}

func (s *Service) setCachedCandles(key string, entry cachedCandles) {
	s.cacheMu.Lock()
	s.chartCache[key] = entry
	s.cacheMu.Unlock()
}

func normalizeInterval(raw string) (string, int64, error) {
	value := strings.ToLower(strings.TrimSpace(raw))
	switch value {
	case "", "1", "1m":
		return "1m", 60, nil
	case "3", "3m":
		return "3m", 180, nil
	case "5", "5m":
		return "5m", 300, nil
	case "15", "15m":
		return "15m", 900, nil
	case "60", "60m", "1h", "1hr", "hour":
		return "1h", 3600, nil
	default:
		return "", 0, fmt.Errorf("unsupported interval: %s", raw)
	}
}

func aggregateCandles(candles []Candle, intervalSeconds int64) []Candle {
	if len(candles) == 0 {
		return nil
	}
	if intervalSeconds <= 60 {
		output := make([]Candle, len(candles))
		copy(output, candles)
		return output
	}

	aggregated := make([]Candle, 0, len(candles))
	currentBucket := int64(-1)
	var current Candle

	for _, candle := range candles {
		bucket := (candle.Timestamp / intervalSeconds) * intervalSeconds
		if bucket != currentBucket {
			if currentBucket != -1 {
				aggregated = append(aggregated, current)
			}

			currentBucket = bucket
			current = Candle{
				Timestamp: bucket,
				Open:      candle.Open,
				High:      candle.High,
				Low:       candle.Low,
				Close:     candle.Close,
				Volume:    candle.Volume,
			}
			continue
		}

		if candle.High > current.High {
			current.High = candle.High
		}
		if candle.Low < current.Low {
			current.Low = candle.Low
		}
		current.Close = candle.Close
		current.Volume += candle.Volume
	}

	if currentBucket != -1 {
		aggregated = append(aggregated, current)
	}

	return aggregated
}

func filterCandles(candles []Candle, fromUnix, toUnix int64) []Candle {
	if len(candles) == 0 {
		return nil
	}

	filtered := make([]Candle, 0, len(candles))
	for _, candle := range candles {
		if candle.Timestamp < fromUnix || candle.Timestamp > toUnix {
			continue
		}
		filtered = append(filtered, candle)
	}

	return filtered
}

func closestCandle(candles []Candle, targetUnix int64) (Candle, bool) {
	if len(candles) == 0 {
		return Candle{}, false
	}

	best := candles[0]
	bestDistance := absInt64(candles[0].Timestamp - targetUnix)

	for _, candle := range candles[1:] {
		distance := absInt64(candle.Timestamp - targetUnix)
		if distance < bestDistance {
			best = candle
			bestDistance = distance
		}
	}

	return best, true
}

func candleByExactTimestamp(candles []Candle, targetUnix int64) (Candle, bool) {
	if len(candles) == 0 {
		return Candle{}, false
	}

	index := sort.Search(len(candles), func(i int) bool {
		return candles[i].Timestamp >= targetUnix
	})
	if index >= len(candles) {
		return Candle{}, false
	}
	if candles[index].Timestamp != targetUnix {
		return Candle{}, false
	}

	return candles[index], true
}

func candleAtOrBeforeOrAfter(candles []Candle, targetUnix int64) (Candle, bool) {
	if candle, ok := candleByExactTimestamp(candles, targetUnix); ok {
		return candle, true
	}
	if candle, ok := candleAtOrBefore(candles, targetUnix); ok {
		return candle, true
	}
	return candleAtOrAfter(candles, targetUnix)
}

func candleAtOrAfter(candles []Candle, targetUnix int64) (Candle, bool) {
	if len(candles) == 0 {
		return Candle{}, false
	}

	index := sort.Search(len(candles), func(i int) bool {
		return candles[i].Timestamp >= targetUnix
	})
	if index >= len(candles) {
		return Candle{}, false
	}
	return candles[index], true
}

func candleAtOrBefore(candles []Candle, targetUnix int64) (Candle, bool) {
	if len(candles) == 0 {
		return Candle{}, false
	}

	index := sort.Search(len(candles), func(i int) bool {
		return candles[i].Timestamp > targetUnix
	})
	if index <= 0 {
		return Candle{}, false
	}
	return candles[index-1], true
}

func previousTradingSessionOpenPrice(candles []Candle, sessionStartUTC time.Time, location *time.Location) (float64, bool) {
	if len(candles) == 0 {
		return 0, false
	}

	if location == nil {
		location = time.UTC
	}

	previousSessionCandle, previousSessionOK := candleAtOrBefore(candles, sessionStartUTC.Unix()-1)
	if !previousSessionOK {
		return 0, false
	}

	previousSessionLocal := time.Unix(previousSessionCandle.Timestamp, 0).In(location)
	year, month, day := previousSessionLocal.Date()
	previousSessionStartUTC := time.Date(year, month, day, 9, 15, 0, 0, location).UTC()
	previousSessionEndUTC := time.Date(year, month, day, 15, 30, 0, 0, location).UTC()

	firstPreviousSessionCandle, firstPreviousSessionOK := candleAtOrAfter(candles, previousSessionStartUTC.Unix())
	if !firstPreviousSessionOK {
		return 0, false
	}
	if firstPreviousSessionCandle.Timestamp > previousSessionEndUTC.Unix() {
		return 0, false
	}
	if firstPreviousSessionCandle.Open <= 0 {
		return 0, false
	}

	return firstPreviousSessionCandle.Open, true
}

func clamp(value, lower, upper float64) float64 {
	if value < lower {
		return lower
	}
	if value > upper {
		return upper
	}
	return value
}

func roundTo(value float64, places int) float64 {
	multiplier := math.Pow(10, float64(places))
	return math.Round(value*multiplier) / multiplier
}

func absInt64(value int64) int64 {
	if value < 0 {
		return -value
	}
	return value
}
