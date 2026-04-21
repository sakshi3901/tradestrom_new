package market

type Candle struct {
	Timestamp int64   `json:"timestamp"`
	Open      float64 `json:"open"`
	High      float64 `json:"high"`
	Low       float64 `json:"low"`
	Close     float64 `json:"close"`
	Volume    int64   `json:"volume"`
}

type OHLCResponse struct {
	Symbol   string   `json:"symbol"`
	Interval string   `json:"interval"`
	Source   string   `json:"source"`
	Candles  []Candle `json:"candles"`
}

type Mover struct {
	Symbol                string  `json:"symbol"`
	Name                  string  `json:"name"`
	Weight                float64 `json:"weight"`
	StartPrice            float64 `json:"start_price"`
	EndPrice              float64 `json:"end_price"`
	PointChange           float64 `json:"point_change"`
	PerChange             float64 `json:"per_change"`
	PercentChange         float64 `json:"percent_change"`
	TS1PerChange          float64 `json:"ts1_per_change"`
	TS2PerChange          float64 `json:"ts2_per_change"`
	PerToIndex            float64 `json:"per_to_index"`
	TS1PerToIndex         float64 `json:"ts1_per_to_index"`
	TS2PerToIndex         float64 `json:"ts2_per_to_index"`
	PointToIndex          float64 `json:"point_to_index"`
	TS1PointToIndex       float64 `json:"ts1_point_to_index"`
	TS2PointToIndex       float64 `json:"ts2_point_to_index"`
	AbsolutePercentChange float64 `json:"absolute_percent_change"`
	Direction             string  `json:"direction"`
	StartTimestamp        int64   `json:"start_timestamp"`
	EndTimestamp          int64   `json:"end_timestamp"`
}

type MoversResponse struct {
	TS1 map[int64]map[string]ContributionData `json:"ts1,omitempty"`
	TS2 map[int64]map[string]ContributionData `json:"ts2,omitempty"`
}

type ContributionData struct {
	PerChange        float64 `json:"per_change"`
	PerToIndex       float64 `json:"per_to_index"`
	PointToIndex     float64 `json:"point_to_index"`
	Open             float64 `json:"open,omitempty"`
	Close            float64 `json:"close,omitempty"`
	SessionPrevClose float64 `json:"session_prev_close,omitempty"`
	Weight           float64 `json:"weight,omitempty"`
	SourceTimestamp  int64   `json:"source_timestamp,omitempty"`
	Exact            bool    `json:"exact,omitempty"`
}

type ContributionSeriesConstituent struct {
	Symbol           string  `json:"symbol"`
	Name             string  `json:"name"`
	Weight           float64 `json:"weight"`
	LTP              float64 `json:"ltp,omitempty"`
	PreviousDayClose float64 `json:"previous_day_close,omitempty"`
}

type ContributionSeriesResponse struct {
	Symbol                string                                `json:"symbol"`
	Interval              string                                `json:"interval"`
	Source                string                                `json:"source"`
	GeneratedAt           int64                                 `json:"generated_at"`
	SessionStartTimestamp int64                                 `json:"session_start_timestamp"`
	SessionEndTimestamp   int64                                 `json:"session_end_timestamp"`
	WeightSum             float64                               `json:"weight_sum"`
	Constituents          []ContributionSeriesConstituent       `json:"constituents"`
	IndexCandles          []Candle                              `json:"index_candles"`
	Snapshots             map[int64]map[string]ContributionData `json:"snapshots"`
}

type OptionLegMetrics struct {
	OI     int64   `json:"oi"`
	Volume int64   `json:"volume"`
	IV     float64 `json:"iv"`
	LTP    float64 `json:"ltp,omitempty"`
}

type OptionStrikeSnapshot struct {
	Strike float64          `json:"strike"`
	Call   OptionLegMetrics `json:"call"`
	Put    OptionLegMetrics `json:"put"`
}

type OptionChainRow struct {
	Timestamp int64   `json:"timestamp"`
	Symbol    string  `json:"symbol"`
	Expiry    string  `json:"expiry"`
	Strike    float64 `json:"strike"`
	Type      string  `json:"type"`
	OI        int64   `json:"oi"`
	Volume    int64   `json:"volume,omitempty"`
	IV        float64 `json:"iv,omitempty"`
	LTP       float64 `json:"ltp,omitempty"`
}

type OptionSnapshotResponse struct {
	Timestamp  int64                  `json:"timestamp"`
	Symbol     string                 `json:"symbol,omitempty"`
	Expiry     string                 `json:"expiry,omitempty"`
	Underlying float64                `json:"underlying"`
	Source     string                 `json:"source"`
	Interval   string                 `json:"interval,omitempty"`
	ExpiryCode string                 `json:"expiry_code,omitempty"`
	Data       map[string]float64     `json:"data,omitempty"`
	Rows       []OptionChainRow       `json:"rows,omitempty"`
	Strikes    []OptionStrikeSnapshot `json:"strikes"`
}

type OptionStrikeDiff struct {
	Strike            float64 `json:"strike"`
	CallChangeOI      int64   `json:"call_change_oi"`
	PutChangeOI       int64   `json:"put_change_oi"`
	TotalChangeOI     int64   `json:"total_change_oi"`
	CallChangeVolume  int64   `json:"call_change_volume"`
	PutChangeVolume   int64   `json:"put_change_volume"`
	TotalChangeVolume int64   `json:"total_change_volume"`
	CallChangeIV      float64 `json:"call_change_iv"`
	PutChangeIV       float64 `json:"put_change_iv"`
	TotalChangeIV     float64 `json:"total_change_iv"`
	OIBuildDirection  string  `json:"oi_build_direction"`
}

type OptionDiffResponse struct {
	FromTimestamp         int64                  `json:"from_timestamp"`
	ToTimestamp           int64                  `json:"to_timestamp"`
	Source                string                 `json:"source"`
	UnderlyingFrom        float64                `json:"underlying_from"`
	UnderlyingTo          float64                `json:"underlying_to"`
	UnderlyingPointChange float64                `json:"underlying_point_change"`
	UnderlyingPctChange   float64                `json:"underlying_pct_change"`
	FromSnapshot          OptionSnapshotResponse `json:"from_snapshot"`
	ToSnapshot            OptionSnapshotResponse `json:"to_snapshot"`
	TopStrikes            []OptionStrikeDiff     `json:"top_strikes"`
}

type OptionSnapshotPoint struct {
	RequestTimestamp  int64                   `json:"requestTimestamp"`
	ResolvedTimestamp int64                   `json:"resolvedTimestamp"`
	ExactMatch        bool                    `json:"exactMatch"`
	Snapshot          *OptionSnapshotResponse `json:"snapshot,omitempty"`
}

type OptionRangeStats struct {
	SnapshotCount          int     `json:"snapshotCount"`
	CallOiTotal            int64   `json:"callOiTotal"`
	PutOiTotal             int64   `json:"putOiTotal"`
	TotalOi                int64   `json:"totalOi"`
	Pcr                    float64 `json:"pcr"`
	SessionStartTimestamp  int64   `json:"sessionStartTimestamp,omitempty"`
	SessionLatestTimestamp int64   `json:"sessionLatestTimestamp,omitempty"`
}

type OptionRangeNetOiChange struct {
	TotalTs1 float64 `json:"totalTs1"`
	TotalTs2 float64 `json:"totalTs2"`
	Net      float64 `json:"net"`
	Pct      float64 `json:"pct"`
}

type OptionRangeHighestOI struct {
	CallStrike    float64 `json:"callStrike"`
	CallOI        float64 `json:"callOI"`
	CallTimestamp int64   `json:"callTimestamp,omitempty"`
	PutStrike     float64 `json:"putStrike"`
	PutOI         float64 `json:"putOI"`
	PutTimestamp  int64   `json:"putTimestamp,omitempty"`
}

type OptionRangeCoverage struct {
	Requested         int `json:"requested"`
	Resolved          int `json:"resolved"`
	SelectedRequested int `json:"selectedRequested"`
	SelectedResolved  int `json:"selectedResolved"`
	CommonStrikeCount int `json:"commonStrikeCount"`
}

type OptionRangeResponse struct {
	Symbol         string                            `json:"symbol"`
	Source         string                            `json:"source"`
	Interval       string                            `json:"interval"`
	StartTimestamp int64                             `json:"startTimestamp"`
	EndTimestamp   int64                             `json:"endTimestamp"`
	TS1            OptionSnapshotPoint               `json:"ts1"`
	TS2            OptionSnapshotPoint               `json:"ts2"`
	Selected       OptionRangeStats                  `json:"selected"`
	Session        OptionRangeStats                  `json:"session"`
	NetOiChange    OptionRangeNetOiChange            `json:"netOiChange"`
	HighestOI      OptionRangeHighestOI              `json:"highestOI"`
	Coverage       OptionRangeCoverage               `json:"coverage"`
	Data           map[string]map[string]float64     `json:"data,omitempty"`
	Snapshots      map[string]OptionSnapshotResponse `json:"snapshots,omitempty"`
	StartSnapshot  *OptionSnapshotResponse           `json:"startSnapshot,omitempty"`
	EndSnapshot    *OptionSnapshotResponse           `json:"endSnapshot,omitempty"`
	LatestSnapshot *OptionSnapshotResponse           `json:"latestSnapshot,omitempty"`
}
