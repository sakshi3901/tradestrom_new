package movers

import (
	"context"
	"database/sql"
	"fmt"
	"math"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	"tradestrom-api/internal/candle"
	"tradestrom-api/internal/ws"
)

type rankedSymbol struct {
	Symbol  string
	Metrics Metrics
}

type indexRuntime struct {
	Key           string
	Name          string
	IndexToken    uint32
	Symbols       []string
	SymbolToToken map[string]uint32
}

type Service struct {
	repo       *Repository
	httpClient *http.Client
	location   *time.Location

	mu           sync.RWMutex
	started      bool
	startErr     error
	startedAtUTC time.Time

	tokenToSymbol       map[uint32]string
	indexWeights        map[string]map[string]float64
	indices             map[string]indexRuntime
	aggregator          *candle.Aggregator
	wsClient            *ws.KiteClient
	runCancel           context.CancelFunc
	processorDone       chan struct{}
	lastProcessedMinute int64
}

func NewService(db *sql.DB) *Service {
	location, err := time.LoadLocation("Asia/Kolkata")
	if err != nil {
		location = time.FixedZone("IST", 5*60*60+30*60)
	}

	return &Service{
		repo:       NewRepository(db),
		httpClient: &http.Client{Timeout: 20 * time.Second},
		location:   location,
	}
}

func (s *Service) Reset() {
	s.mu.Lock()
	runCancel := s.runCancel
	wsClient := s.wsClient
	processorDone := s.processorDone

	s.started = false
	s.startErr = nil
	s.startedAtUTC = time.Time{}
	s.tokenToSymbol = nil
	s.indexWeights = nil
	s.indices = nil
	s.aggregator = nil
	s.wsClient = nil
	s.runCancel = nil
	s.processorDone = nil
	s.lastProcessedMinute = 0
	s.mu.Unlock()

	if runCancel != nil {
		runCancel()
	}
	if wsClient != nil {
		wsClient.Stop()
	}
	if processorDone != nil {
		select {
		case <-processorDone:
		case <-time.After(2 * time.Second):
		}
	}
}

func (s *Service) GetTopMovers915(ctx context.Context) (Response915, error) {
	result, err := s.GetTopMoversSnapshot(ctx, indexKeyNifty50, s.today915Unix(), 20)
	if err != nil {
		return Response915{}, err
	}

	output := make(map[string]Metrics, len(result.Rows))
	for _, row := range result.Rows {
		output[row.Symbol] = row.Metrics
	}

	return Response915{
		TS1: map[int64]map[string]Metrics{
			result.Timestamp: output,
		},
	}, nil
}

func (s *Service) GetTopMoversSnapshot(ctx context.Context, indexKey string, ts int64, limit int) (SnapshotResponse, error) {
	return s.getTopMoversSnapshot(ctx, indexKey, ts, limit, false)
}

func (s *Service) GetTopMoversSnapshotDBOnly(ctx context.Context, indexKey string, ts int64, limit int) (SnapshotResponse, error) {
	return s.getTopMoversSnapshot(ctx, indexKey, ts, limit, true)
}

func (s *Service) getTopMoversSnapshot(ctx context.Context, indexKey string, ts int64, limit int, dbOnly bool) (SnapshotResponse, error) {
	normalizedIndexKey := normalizeIndexKey(indexKey)
	if normalizedIndexKey == "" {
		normalizedIndexKey = indexKeyNifty50
	}

	tsMinute, err := s.normalizeToMinute(ts)
	if err != nil {
		return SnapshotResponse{}, err
	}

	if dbOnly {
		if limit <= 0 {
			limit = 50
		}

		resolvedMinute := tsMinute
		rows, err := s.repo.GetIndexMoverSnapshot(ctx, normalizedIndexKey, resolvedMinute, limit)
		if err != nil {
			return SnapshotResponse{}, err
		}

		// If the exact minute is missing, search nearby DB snapshots (backward first, then
		// forward) to avoid slow non-DB fallback during UI Execute. This handles service
		// restarts/backfill gaps while staying DB-only.
		const maxNearbySearchMinutes = 45
		for offset := 1; len(rows) == 0 && offset <= maxNearbySearchMinutes; offset++ {
			candidateMinutes := []int64{
				resolvedMinute - int64(offset*60),
				resolvedMinute + int64(offset*60),
			}
			for _, candidateMinute := range candidateMinutes {
				if candidateMinute <= 0 {
					continue
				}
				candidateRows, candidateErr := s.repo.GetIndexMoverSnapshot(ctx, normalizedIndexKey, candidateMinute, limit)
				if candidateErr != nil {
					return SnapshotResponse{}, candidateErr
				}
				if len(candidateRows) == 0 {
					continue
				}
				rows = candidateRows
				resolvedMinute = candidateMinute
				break
			}
		}

		if len(rows) == 0 {
			return SnapshotResponse{}, fmt.Errorf("no movers snapshot found for %s at %d", normalizedIndexKey, tsMinute)
		}
		if limit > 0 && len(rows) > limit {
			rows = rows[:limit]
		}

		return SnapshotResponse{
			IndexKey:   normalizedIndexKey,
			IndexName:  displayIndexName(normalizedIndexKey),
			Timestamp:  resolvedMinute,
			Source:     "db:index_movers_1m",
			RowCount:   len(rows),
			Rows:       rows,
			FromDB:     true,
			MarketOpen: s.isMarketOpen(time.Now().In(s.location)),
		}, nil
	}

	if err := s.ensureStarted(ctx); err != nil {
		return SnapshotResponse{}, err
	}

	idxCfg, ok := s.indexConfig(normalizedIndexKey)
	if !ok {
		return SnapshotResponse{}, fmt.Errorf("unsupported index key: %s", normalizedIndexKey)
	}

	rows, err := s.repo.GetIndexMoverSnapshot(ctx, normalizedIndexKey, tsMinute, limit)
	if err != nil {
		return SnapshotResponse{}, err
	}
	if len(rows) == 0 && !dbOnly {
		if s.isMarketSessionMinuteUnix(tsMinute) {
			if buildErr := s.computeAndStoreMinuteForIndex(ctx, idxCfg, tsMinute); buildErr == nil {
				rows, err = s.repo.GetIndexMoverSnapshot(ctx, normalizedIndexKey, tsMinute, limit)
				if err != nil {
					return SnapshotResponse{}, err
				}
			}
		}
	}
	if len(rows) == 0 {
		return SnapshotResponse{}, fmt.Errorf("no movers snapshot found for %s at %d", normalizedIndexKey, tsMinute)
	}

	if limit > 0 && len(rows) > limit {
		rows = rows[:limit]
	}

	return SnapshotResponse{
		IndexKey:   normalizedIndexKey,
		IndexName:  idxCfg.Name,
		Timestamp:  tsMinute,
		Source:     "db:index_movers_1m",
		RowCount:   len(rows),
		Rows:       rows,
		FromDB:     true,
		MarketOpen: s.isMarketOpen(time.Now().In(s.location)),
	}, nil
}

func displayIndexName(indexKey string) string {
	switch normalizeIndexKey(indexKey) {
	case indexKeyNiftyBank:
		return indexNameNiftyBank
	case indexKeyFNO:
		return indexNameFNO
	default:
		return indexNameNifty50
	}
}

func (s *Service) ensureStarted(ctx context.Context) error {
	s.mu.RLock()
	if s.started {
		s.mu.RUnlock()
		return nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.started {
		return nil
	}

	credentials, err := s.repo.LoadZerodhaCredentials(ctx)
	if err != nil {
		s.startErr = err
		return err
	}

	nifty50Symbols, _, err := fetchConstituentSymbolsForIndex(ctx, s.httpClient, indexKeyNifty50)
	if err != nil {
		s.startErr = err
		return err
	}
	bankSymbols, _, err := fetchConstituentSymbolsForIndex(ctx, s.httpClient, indexKeyNiftyBank)
	if err != nil {
		s.startErr = err
		return err
	}
	fnoSymbols, _, err := fetchConstituentSymbolsForIndex(ctx, s.httpClient, indexKeyFNO)
	if err != nil {
		s.startErr = err
		return err
	}

	allowedSymbols := make([]string, 0, len(nifty50Symbols)+len(bankSymbols)+len(fnoSymbols)+3)
	allowedSymbols = append(allowedSymbols, nifty50Symbols...)
	allowedSymbols = append(allowedSymbols, bankSymbols...)
	allowedSymbols = append(allowedSymbols, fnoSymbols...)
	allowedSymbols = append(allowedSymbols, indexNameNifty50, indexNameNiftyBank, indexNameFNO)

	symbolToTokenAll, tokenToSymbolAll, err := fetchKiteNSEInstrumentMappings(ctx, s.httpClient, credentials, allowedSymbols)
	if err != nil {
		s.startErr = err
		return err
	}
	if err := s.repo.UpsertNSEInstruments(ctx, tokenToSymbolAll); err != nil {
		s.startErr = err
		return err
	}

	weights := buildStaticIndexWeightMaps(nifty50Symbols, bankSymbols, fnoSymbols)

	buildIndexRuntime := func(key, name string, symbols []string) (indexRuntime, error) {
		sortedSymbols := uniqueUpperSymbols(symbols)
		sort.Strings(sortedSymbols)
		symbolToToken := make(map[string]uint32, len(sortedSymbols))
		for _, symbol := range sortedSymbols {
			if token := symbolToTokenAll[symbol]; token > 0 {
				symbolToToken[symbol] = token
			}
		}
		if len(symbolToToken) == 0 {
			return indexRuntime{}, fmt.Errorf("no mapped symbols found for %s", key)
		}
		indexToken := symbolToTokenAll[strings.ToUpper(strings.TrimSpace(name))]
		if indexToken == 0 {
			indexToken = parseIndexTokenFromEnvForIndex(key)
		}
		if indexToken == 0 {
			return indexRuntime{}, fmt.Errorf("index token missing for %s", key)
		}
		return indexRuntime{
			Key:           key,
			Name:          name,
			IndexToken:    indexToken,
			Symbols:       sortedSymbols,
			SymbolToToken: symbolToToken,
		}, nil
	}

	nifty50Runtime, err := buildIndexRuntime(indexKeyNifty50, indexNameNifty50, nifty50Symbols)
	if err != nil {
		s.startErr = err
		return err
	}
	bankRuntime, err := buildIndexRuntime(indexKeyNiftyBank, indexNameNiftyBank, bankSymbols)
	if err != nil {
		s.startErr = err
		return err
	}
	fnoRuntime, err := buildIndexRuntime(indexKeyFNO, indexNameFNO, fnoSymbols)
	if err != nil {
		s.startErr = err
		return err
	}

	indices := map[string]indexRuntime{
		indexKeyNifty50:   nifty50Runtime,
		indexKeyNiftyBank: bankRuntime,
		indexKeyFNO:       fnoRuntime,
	}

	subscriptionTokens := make([]uint32, 0, len(tokenToSymbolAll)+3)
	seenTokens := make(map[uint32]struct{}, len(tokenToSymbolAll)+3)
	for _, cfg := range indices {
		if cfg.IndexToken > 0 {
			if _, ok := seenTokens[cfg.IndexToken]; !ok {
				seenTokens[cfg.IndexToken] = struct{}{}
				subscriptionTokens = append(subscriptionTokens, cfg.IndexToken)
			}
		}
		for _, token := range cfg.SymbolToToken {
			if token == 0 {
				continue
			}
			if _, ok := seenTokens[token]; ok {
				continue
			}
			seenTokens[token] = struct{}{}
			subscriptionTokens = append(subscriptionTokens, token)
		}
	}

	aggregator := candle.NewAggregator(s.repo, s.location)
	runCtx, cancel := context.WithCancel(context.Background())
	client := ws.NewKiteClient(credentials.APIKey, credentials.AccessToken, subscriptionTokens, s.location, func(tick ws.Tick) {
		if !s.isMarketSessionTick(tick.Timestamp) {
			return
		}
		_, _ = aggregator.AddTick(tick.InstrumentToken, tick.LastPrice, tick.Timestamp)
	})
	client.Start(runCtx)

	processorDone := make(chan struct{})
	go s.minuteProcessor(runCtx, processorDone)

	s.started = true
	s.startErr = nil
	s.startedAtUTC = time.Now().UTC()
	s.tokenToSymbol = cloneTokenSymbolMap(tokenToSymbolAll)
	s.indexWeights = cloneNestedWeightMap(weights)
	s.indices = cloneIndexRuntimeMap(indices)
	s.aggregator = aggregator
	s.wsClient = client
	s.runCancel = cancel
	s.processorDone = processorDone
	s.lastProcessedMinute = 0

	return nil
}

func (s *Service) minuteProcessor(ctx context.Context, done chan struct{}) {
	defer close(done)

	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		s.processClosedMarketMinutes(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) processClosedMarketMinutes(ctx context.Context) {
	now := time.Now().In(s.location)
	targetMinute, ok := s.latestClosedMarketMinute(now)
	if !ok {
		return
	}

	s.mu.Lock()
	lastProcessed := s.lastProcessedMinute
	if lastProcessed == 0 || !s.sameTradingDayUnix(lastProcessed, targetMinute) {
		// Start from the current closed minute and continue minute-by-minute from there.
		s.lastProcessedMinute = targetMinute - 60
		lastProcessed = s.lastProcessedMinute
	}
	s.mu.Unlock()

	if targetMinute <= lastProcessed {
		return
	}

	for tsMinute := lastProcessed + 60; tsMinute <= targetMinute; tsMinute += 60 {
		if !s.isMarketSessionMinuteUnix(tsMinute) {
			s.mu.Lock()
			if tsMinute > s.lastProcessedMinute {
				s.lastProcessedMinute = tsMinute
			}
			s.mu.Unlock()
			continue
		}
		_, _ = s.computeAndStoreMinuteAllIndices(ctx, tsMinute)
		s.mu.Lock()
		if tsMinute > s.lastProcessedMinute {
			s.lastProcessedMinute = tsMinute
		}
		s.mu.Unlock()
	}
}

func (s *Service) computeAndStoreMinuteAllIndices(ctx context.Context, tsMinute int64) (int, error) {
	indices, err := s.indexConfigs()
	if err != nil {
		return 0, err
	}
	processed := 0
	var firstErr error
	for _, cfg := range indices {
		if err := s.computeAndStoreMinuteForIndex(ctx, cfg, tsMinute); err != nil {
			if firstErr == nil {
				firstErr = err
			}
			continue
		}
		processed++
	}
	if processed == 0 && firstErr != nil {
		return 0, firstErr
	}
	return processed, firstErr
}

func (s *Service) computeAndStoreMinuteForIndex(ctx context.Context, cfg indexRuntime, tsMinute int64) error {
	if cfg.IndexToken == 0 || tsMinute <= 0 {
		return fmt.Errorf("invalid compute request")
	}

	indexCandle, ok, err := s.candleAt(ctx, cfg.IndexToken, tsMinute)
	if err != nil {
		return err
	}
	if !ok || indexCandle.Open <= 0 {
		return fmt.Errorf("index candle not available for %s at %d", cfg.Key, tsMinute)
	}

	s.mu.RLock()
	indexWeights := s.indexWeights
	s.mu.RUnlock()

	idxRet := 0.0
	if indexCandle.Open > 0 {
		idxRet = ((indexCandle.Close - indexCandle.Open) / indexCandle.Open) * 100.0
	}
	idxPts := indexCandle.Close - indexCandle.Open

	ranked := make([]rankedSymbol, 0, len(cfg.SymbolToToken))
	for _, symbol := range cfg.Symbols {
		token := cfg.SymbolToToken[symbol]
		if token == 0 {
			continue
		}
		stockCandle, hasStock, stockErr := s.candleAt(ctx, token, tsMinute)
		if stockErr != nil {
			continue
		}
		if !hasStock || stockCandle.Open <= 0 {
			continue
		}

		perChange := ((stockCandle.Close - stockCandle.Open) / stockCandle.Open) * 100.0
		metrics := Metrics{PerChange: roundTo(perChange, 4)}

		if weightPct, hasWeight := lookupStaticWeightPct(indexWeights, cfg.Name, symbol); hasWeight && indexCandle.Open > 0 {
			perToIndex := roundTo(perChange*(weightPct/100.0), 6)
			pointToIndex := roundTo((perToIndex/100.0)*indexCandle.Open, 4)
			metrics.PerToIndex = &perToIndex
			metrics.PointToIndex = &pointToIndex
		} else if math.Abs(idxRet) >= 0.0001 {
			perToIndex := roundTo(perChange/idxRet, 6)
			pointToIndex := roundTo(perToIndex*idxPts, 4)
			metrics.PerToIndex = &perToIndex
			metrics.PointToIndex = &pointToIndex
		}

		ranked = append(ranked, rankedSymbol{Symbol: symbol, Metrics: metrics})
	}

	sort.Slice(ranked, func(i, j int) bool {
		left := rankingScore(ranked[i].Metrics)
		right := rankingScore(ranked[j].Metrics)
		if left == right {
			return ranked[i].Symbol < ranked[j].Symbol
		}
		return left > right
	})

	rows := make([]ImpactRow, 0, len(ranked))
	for i, row := range ranked {
		rows = append(rows, ImpactRow{
			Rank:    i + 1,
			Symbol:  row.Symbol,
			Metrics: row.Metrics,
		})
	}

	return s.repo.ReplaceIndexMoverSnapshot(ctx, cfg.Key, tsMinute, rows)
}

func (s *Service) candleAt(ctx context.Context, instrumentToken uint32, tsMinute int64) (candle.Candle, bool, error) {
	s.mu.RLock()
	aggregator := s.aggregator
	s.mu.RUnlock()

	if aggregator != nil {
		if inMemory, ok := aggregator.GetCandle(instrumentToken, tsMinute); ok {
			return inMemory, true, nil
		}
	}

	return s.repo.GetCandle1m(ctx, instrumentToken, tsMinute)
}

func (s *Service) indexConfig(indexKey string) (indexRuntime, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.indices) == 0 {
		return indexRuntime{}, false
	}
	cfg, ok := s.indices[normalizeIndexKey(indexKey)]
	if !ok {
		return indexRuntime{}, false
	}
	return cloneIndexRuntime(cfg), true
}

func (s *Service) indexConfigs() ([]indexRuntime, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if len(s.indices) == 0 {
		return nil, fmt.Errorf("indices not initialized")
	}
	keys := make([]string, 0, len(s.indices))
	for key := range s.indices {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	out := make([]indexRuntime, 0, len(keys))
	for _, key := range keys {
		out = append(out, cloneIndexRuntime(s.indices[key]))
	}
	return out, nil
}

func (s *Service) today915Unix() int64 {
	nowIST := time.Now().In(s.location)
	year, month, day := nowIST.Date()
	return time.Date(year, month, day, 9, 15, 0, 0, s.location).Unix()
}

func (s *Service) normalizeToMinute(ts int64) (int64, error) {
	if ts <= 0 {
		return 0, fmt.Errorf("timestamp is required")
	}
	if ts > 1_000_000_000_000 {
		ts = ts / 1000
	}
	return time.Unix(ts, 0).In(s.location).Truncate(time.Minute).Unix(), nil
}

func (s *Service) isMarketSessionTick(ts time.Time) bool {
	return s.isMarketOpen(ts.In(s.location))
}

func (s *Service) isMarketOpen(local time.Time) bool {
	if !isTradingDay(local) {
		return false
	}
	minuteOfDay := local.Hour()*60 + local.Minute()
	return minuteOfDay >= (9*60+15) && minuteOfDay < (15*60+30)
}

func (s *Service) isMarketSessionMinuteUnix(tsMinute int64) bool {
	local := time.Unix(tsMinute, 0).In(s.location)
	if !isTradingDay(local) {
		return false
	}
	minuteOfDay := local.Hour()*60 + local.Minute()
	return minuteOfDay >= (9*60+15) && minuteOfDay <= (15*60+29)
}

func (s *Service) latestClosedMarketMinute(now time.Time) (int64, bool) {
	local := now.In(s.location)
	if !isTradingDay(local) {
		return 0, false
	}
	y, m, d := local.Date()
	sessionOpen := time.Date(y, m, d, 9, 15, 0, 0, s.location)
	sessionClose := time.Date(y, m, d, 15, 30, 0, 0, s.location)
	if local.Before(sessionOpen.Add(time.Minute)) {
		return 0, false
	}
	candidate := local.Truncate(time.Minute).Add(-time.Minute)
	if candidate.Before(sessionOpen) {
		return 0, false
	}
	lastMinute := sessionClose.Add(-time.Minute)
	if candidate.After(lastMinute) {
		candidate = lastMinute
	}
	return candidate.Unix(), true
}

func (s *Service) sameTradingDayUnix(a, b int64) bool {
	if a <= 0 || b <= 0 {
		return false
	}
	ta := time.Unix(a, 0).In(s.location)
	tb := time.Unix(b, 0).In(s.location)
	y1, m1, d1 := ta.Date()
	y2, m2, d2 := tb.Date()
	return y1 == y2 && m1 == m2 && d1 == d2
}

func isTradingDay(t time.Time) bool {
	switch t.Weekday() {
	case time.Saturday, time.Sunday:
		return false
	default:
		return true
	}
}

func rankingScore(metrics Metrics) float64 {
	if metrics.PointToIndex != nil {
		v := *metrics.PointToIndex
		if v < 0 {
			return -v
		}
		return v
	}
	if metrics.PerToIndex != nil {
		v := *metrics.PerToIndex
		if v < 0 {
			return -v
		}
		return v
	}
	if metrics.PerChange < 0 {
		return -metrics.PerChange
	}
	return metrics.PerChange
}

func roundTo(value float64, places int) float64 {
	multiplier := math.Pow(10, float64(places))
	return math.Round(value*multiplier) / multiplier
}

func normalizeIndexKey(value string) string {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "", indexKeyNifty50, "NIFTY 50":
		return indexKeyNifty50
	case indexKeyNiftyBank, "NIFTY BANK", "NIFTYBANK", "BANK NIFTY":
		return indexKeyNiftyBank
	case indexKeyFNO, "FNO", "NIFTY 200":
		return indexKeyFNO
	default:
		return strings.ToUpper(strings.TrimSpace(value))
	}
}

func cloneSymbolTokenMap(input map[string]uint32) map[string]uint32 {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]uint32, len(input))
	for symbol, token := range input {
		key := strings.ToUpper(strings.TrimSpace(symbol))
		if key == "" || token == 0 {
			continue
		}
		out[key] = token
	}
	return out
}

func cloneTokenSymbolMap(input map[uint32]string) map[uint32]string {
	if len(input) == 0 {
		return nil
	}
	out := make(map[uint32]string, len(input))
	for token, symbol := range input {
		if token == 0 {
			continue
		}
		key := strings.ToUpper(strings.TrimSpace(symbol))
		if key == "" {
			continue
		}
		out[token] = key
	}
	return out
}

func cloneIndexRuntime(input indexRuntime) indexRuntime {
	return indexRuntime{
		Key:           strings.ToUpper(strings.TrimSpace(input.Key)),
		Name:          strings.TrimSpace(input.Name),
		IndexToken:    input.IndexToken,
		Symbols:       append([]string(nil), input.Symbols...),
		SymbolToToken: cloneSymbolTokenMap(input.SymbolToToken),
	}
}

func cloneIndexRuntimeMap(input map[string]indexRuntime) map[string]indexRuntime {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]indexRuntime, len(input))
	for key, cfg := range input {
		out[normalizeIndexKey(key)] = cloneIndexRuntime(cfg)
	}
	return out
}
