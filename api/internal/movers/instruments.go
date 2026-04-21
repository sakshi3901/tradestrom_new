package movers

import (
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"strconv"
	"strings"
)

const kiteNSEInstrumentsURL = "https://api.kite.trade/instruments/NSE"

func fetchKiteNSEInstrumentMappings(
	ctx context.Context,
	client *http.Client,
	credentials ZerodhaCredentials,
	allowedSymbols []string,
) (map[string]uint32, map[uint32]string, error) {
	if client == nil {
		client = http.DefaultClient
	}

	apiKey := strings.TrimSpace(credentials.APIKey)
	accessToken := strings.TrimSpace(credentials.AccessToken)
	if apiKey == "" {
		return nil, nil, fmt.Errorf("zerodha api key is missing")
	}
	if accessToken == "" {
		return nil, nil, fmt.Errorf("zerodha access token is missing")
	}

	allowed := make(map[string]struct{}, len(allowedSymbols))
	for _, symbol := range uniqueUpperSymbols(allowedSymbols) {
		allowed[symbol] = struct{}{}
	}
	if len(allowed) == 0 {
		return map[string]uint32{}, map[uint32]string{}, nil
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, kiteNSEInstrumentsURL, nil)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Accept", "text/csv")
	req.Header.Set("X-Kite-Version", "3")
	req.Header.Set("Authorization", fmt.Sprintf("token %s:%s", apiKey, accessToken))
	req.Header.Set("User-Agent", "Mozilla/5.0 Tradestrom/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, nil, fmt.Errorf("zerodha instruments request failed (%d)", resp.StatusCode)
	}

	reader := csv.NewReader(resp.Body)
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, nil, err
	}
	if len(rows) <= 1 {
		return nil, nil, fmt.Errorf("zerodha instruments payload is empty")
	}

	header := make(map[string]int, len(rows[0]))
	for idx, column := range rows[0] {
		normalized := strings.TrimSpace(strings.TrimPrefix(column, "\ufeff"))
		header[strings.ToLower(normalized)] = idx
	}

	tokenIndex, okToken := header["instrument_token"]
	symbolIndex, okSymbol := header["tradingsymbol"]
	exchangeIndex, okExchange := header["exchange"]
	segmentIndex, okSegment := header["segment"]
	if !okToken || !okSymbol {
		return nil, nil, fmt.Errorf("zerodha instruments payload missing required columns")
	}

	symbolToToken := make(map[string]uint32, len(allowed))
	tokenToSymbol := make(map[uint32]string, len(allowed))
	for _, row := range rows[1:] {
		if tokenIndex >= len(row) || symbolIndex >= len(row) {
			continue
		}

		if okExchange && exchangeIndex < len(row) && !strings.EqualFold(strings.TrimSpace(row[exchangeIndex]), "NSE") {
			continue
		}
		if okSegment && segmentIndex < len(row) {
			segment := strings.TrimSpace(row[segmentIndex])
			if segment != "" && !strings.EqualFold(segment, "NSE") && !strings.EqualFold(segment, "INDICES") {
				continue
			}
		}

		symbol := strings.ToUpper(strings.TrimSpace(row[symbolIndex]))
		if symbol == "" {
			continue
		}
		if _, ok := allowed[symbol]; !ok {
			continue
		}

		tokenRaw := strings.TrimSpace(row[tokenIndex])
		if tokenRaw == "" {
			continue
		}
		token64, parseErr := strconv.ParseUint(tokenRaw, 10, 32)
		if parseErr != nil || token64 == 0 {
			continue
		}
		token := uint32(token64)

		symbolToToken[symbol] = token
		tokenToSymbol[token] = symbol
	}

	if len(symbolToToken) == 0 {
		return nil, nil, fmt.Errorf("no NSE instrument tokens found in Kite instruments list for provided symbols")
	}

	return symbolToToken, tokenToSymbol, nil
}
