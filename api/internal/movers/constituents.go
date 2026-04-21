package movers

import (
	"context"
	"encoding/csv"
	"fmt"
	"net/http"
	"sort"
	"strings"
)

const (
	nifty50ConstituentURL  = "https://niftyindices.com/IndexConstituent/ind_nifty50list.csv"
	nifty200ConstituentURL = "https://niftyindices.com/IndexConstituent/ind_nifty200list.csv"
)

const (
	indexKeyNifty50   = "NIFTY50"
	indexKeyNiftyBank = "BANKNIFTY"
	indexKeyFNO       = "NIFTY200"

	indexNameNifty50   = "NIFTY 50"
	indexNameNiftyBank = "NIFTY BANK"
	indexNameFNO       = "NIFTY 200"
)

var bankNiftySymbols = []string{
	"AUBANK",
	"AXISBANK",
	"BANDHANBNK",
	"BANKBARODA",
	"CANBK",
	"FEDERALBNK",
	"HDFCBANK",
	"ICICIBANK",
	"IDFCFIRSTB",
	"INDUSINDBK",
	"KOTAKBANK",
	"PNB",
	"SBIN",
}

func fetchNifty50Symbols(ctx context.Context, client *http.Client) ([]string, error) {
	return fetchConstituentSymbolsCSV(ctx, client, nifty50ConstituentURL, "nifty 50")
}

func fetchNifty200Symbols(ctx context.Context, client *http.Client) ([]string, error) {
	return fetchConstituentSymbolsCSV(ctx, client, nifty200ConstituentURL, "nifty 200")
}

func bankNiftyConstituents() []string {
	out := uniqueUpperSymbols(bankNiftySymbols)
	sort.Strings(out)
	return out
}

func fetchConstituentSymbolsForIndex(ctx context.Context, client *http.Client, indexKey string) ([]string, string, error) {
	switch strings.ToUpper(strings.TrimSpace(indexKey)) {
	case "", indexKeyNifty50:
		symbols, err := fetchNifty50Symbols(ctx, client)
		return symbols, indexNameNifty50, err
	case indexKeyFNO:
		symbols, err := fetchNifty200Symbols(ctx, client)
		return symbols, indexNameFNO, err
	case indexKeyNiftyBank:
		return bankNiftyConstituents(), indexNameNiftyBank, nil
	default:
		return nil, "", fmt.Errorf("unsupported index key: %s", indexKey)
	}
}

func fetchConstituentSymbolsCSV(ctx context.Context, client *http.Client, csvURL, label string) ([]string, error) {
	if client == nil {
		client = http.DefaultClient
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, csvURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept", "text/csv,*/*")
	req.Header.Set("User-Agent", "Tradestrom/1.0")

	resp, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("failed to fetch %s constituents: status %d", label, resp.StatusCode)
	}

	reader := csv.NewReader(resp.Body)
	reader.FieldsPerRecord = -1
	rows, err := reader.ReadAll()
	if err != nil {
		return nil, err
	}
	if len(rows) < 2 {
		return nil, fmt.Errorf("empty %s constituent csv", label)
	}

	symbolCol := -1
	for idx, column := range rows[0] {
		normalized := strings.ToLower(strings.TrimSpace(column))
		if normalized == "symbol" || normalized == "symbol " {
			symbolCol = idx
			break
		}
	}
	if symbolCol == -1 {
		return nil, fmt.Errorf("symbol column not found in constituent csv")
	}

	output := make([]string, 0, len(rows)-1)
	seen := make(map[string]struct{}, len(rows)-1)
	for _, row := range rows[1:] {
		if symbolCol >= len(row) {
			continue
		}
		symbol := strings.ToUpper(strings.TrimSpace(row[symbolCol]))
		if symbol == "" {
			continue
		}
		if _, ok := seen[symbol]; ok {
			continue
		}
		seen[symbol] = struct{}{}
		output = append(output, symbol)
	}

	if len(output) == 0 {
		return nil, fmt.Errorf("no symbols parsed from constituent csv")
	}

	sort.Strings(output)
	return output, nil
}
