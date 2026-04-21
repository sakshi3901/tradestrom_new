package ws

import (
	"context"
	"sync"
	"time"

	kitemodels "github.com/zerodha/gokiteconnect/v4/models"
	kiteticker "github.com/zerodha/gokiteconnect/v4/ticker"
)

type Tick struct {
	InstrumentToken uint32
	LastPrice       float64
	Timestamp       time.Time
}

type TickHandler func(tick Tick)

type KiteClient struct {
	mu       sync.Mutex
	location *time.Location
	tokens   []uint32
	onTick   TickHandler
	ticker   *kiteticker.Ticker
	running  bool
}

func NewKiteClient(apiKey, accessToken string, tokens []uint32, location *time.Location, onTick TickHandler) *KiteClient {
	if location == nil {
		location = time.UTC
	}

	unique := uniqueTokens(tokens)
	ticker := kiteticker.New(apiKey, accessToken)
	ticker.SetAutoReconnect(true)
	ticker.SetReconnectMaxRetries(3000)

	client := &KiteClient{
		location: location,
		tokens:   unique,
		onTick:   onTick,
		ticker:   ticker,
		running:  false,
	}

	client.bindCallbacks()
	return client
}

func (c *KiteClient) bindCallbacks() {
	c.ticker.OnConnect(func() {
		if len(c.tokens) == 0 {
			return
		}
		_ = c.ticker.Subscribe(c.tokens)
		_ = c.ticker.SetMode(kiteticker.ModeFull, c.tokens)
	})

	c.ticker.OnTick(func(tick kitemodels.Tick) {
		if c.onTick == nil {
			return
		}
		if tick.InstrumentToken == 0 || tick.LastPrice <= 0 {
			return
		}

		tickTime := tick.Timestamp.Time
		if tickTime.IsZero() {
			tickTime = tick.LastTradeTime.Time
		}
		if tickTime.IsZero() {
			tickTime = time.Now().In(c.location)
		}

		c.onTick(Tick{
			InstrumentToken: tick.InstrumentToken,
			LastPrice:       tick.LastPrice,
			Timestamp:       tickTime,
		})
	})
}

func (c *KiteClient) Start(ctx context.Context) {
	c.mu.Lock()
	if c.running {
		c.mu.Unlock()
		return
	}
	c.running = true
	c.mu.Unlock()

	go func() {
		c.ticker.ServeWithContext(ctx)
		c.mu.Lock()
		c.running = false
		c.mu.Unlock()
	}()
}

func (c *KiteClient) Stop() {
	c.ticker.Stop()
}

func uniqueTokens(tokens []uint32) []uint32 {
	if len(tokens) == 0 {
		return nil
	}

	seen := make(map[uint32]struct{}, len(tokens))
	out := make([]uint32, 0, len(tokens))
	for _, token := range tokens {
		if token == 0 {
			continue
		}
		if _, ok := seen[token]; ok {
			continue
		}
		seen[token] = struct{}{}
		out = append(out, token)
	}
	return out
}
