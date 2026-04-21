package movers

type Metrics struct {
	PerChange    float64  `json:"per_change"`
	PerToIndex   *float64 `json:"per_to_index"`
	PointToIndex *float64 `json:"point_to_index"`
}

type ImpactRow struct {
	Rank    int     `json:"rank"`
	Symbol  string  `json:"symbol"`
	Metrics Metrics `json:"metrics"`
}

type Response915 struct {
	TS1 map[int64]map[string]Metrics `json:"ts1"`
}

type SnapshotResponse struct {
	IndexKey   string      `json:"index_key"`
	IndexName  string      `json:"index_name"`
	Timestamp  int64       `json:"timestamp"`
	Source     string      `json:"source"`
	RowCount   int         `json:"row_count"`
	Rows       []ImpactRow `json:"rows"`
	FromDB     bool        `json:"from_db"`
	MarketOpen bool        `json:"market_open"`
}
