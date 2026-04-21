package candle

import (
	"sync"
	"time"
)

type Candle struct {
	Open  float64
	High  float64
	Low   float64
	Close float64
}

type Persister interface {
	UpsertCandle1m(instrumentToken uint32, tsMinute int64, price float64) error
}

type Aggregator struct {
	mu       sync.RWMutex
	location *time.Location
	candles  map[int64]map[uint32]Candle

	persister Persister
}

func NewAggregator(persister Persister, location *time.Location) *Aggregator {
	if location == nil {
		location = time.UTC
	}

	return &Aggregator{
		location:  location,
		candles:   make(map[int64]map[uint32]Candle),
		persister: persister,
	}
}

func (a *Aggregator) AddTick(instrumentToken uint32, price float64, tickTime time.Time) (int64, error) {
	if instrumentToken == 0 || price <= 0 {
		return 0, nil
	}

	tsMinute := tickTime.In(a.location).Truncate(time.Minute).Unix()

	a.mu.Lock()
	byToken := a.candles[tsMinute]
	if byToken == nil {
		byToken = make(map[uint32]Candle)
		a.candles[tsMinute] = byToken
	}

	existing, ok := byToken[instrumentToken]
	if !ok {
		byToken[instrumentToken] = Candle{
			Open:  price,
			High:  price,
			Low:   price,
			Close: price,
		}
	} else {
		if price > existing.High {
			existing.High = price
		}
		if price < existing.Low {
			existing.Low = price
		}
		existing.Close = price
		byToken[instrumentToken] = existing
	}
	a.mu.Unlock()

	if a.persister != nil {
		if err := a.persister.UpsertCandle1m(instrumentToken, tsMinute, price); err != nil {
			return tsMinute, err
		}
	}

	return tsMinute, nil
}

func (a *Aggregator) GetCandle(instrumentToken uint32, tsMinute int64) (Candle, bool) {
	a.mu.RLock()
	defer a.mu.RUnlock()

	byToken, ok := a.candles[tsMinute]
	if !ok {
		return Candle{}, false
	}

	candle, ok := byToken[instrumentToken]
	return candle, ok
}
