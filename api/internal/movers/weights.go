package movers

import "strings"

// Populate per-stock values here when you want fixed index weights.
// Shape is intentionally:
// { "STOCK_NAME": weight_percentage, "INDEX_NAME": 100 }
var nifty50StaticWeightOverrides = map[string]float64{}
var niftyBankStaticWeightOverrides = map[string]float64{}
var fnoStaticWeightOverrides = map[string]float64{}

func buildStaticIndexWeightMaps(nifty50Symbols, niftyBankSymbols, fnoSymbols []string) map[string]map[string]float64 {
	return map[string]map[string]float64{
		strings.ToUpper(indexNameNifty50):   buildStaticWeightMapForIndex(nifty50Symbols, indexNameNifty50, nifty50StaticWeightOverrides),
		strings.ToUpper(indexNameNiftyBank): buildStaticWeightMapForIndex(niftyBankSymbols, indexNameNiftyBank, niftyBankStaticWeightOverrides),
		strings.ToUpper(indexNameFNO):       buildStaticWeightMapForIndex(fnoSymbols, indexNameFNO, fnoStaticWeightOverrides),
	}
}

func buildStaticWeightMapForIndex(symbols []string, indexName string, overrides map[string]float64) map[string]float64 {
	unique := uniqueUpperSymbols(symbols)
	out := make(map[string]float64, len(unique)+1)
	for _, symbol := range unique {
		// Keep keys present for all constituents; values can be filled explicitly later.
		out[symbol] = 0
	}
	for symbol, weight := range overrides {
		key := strings.ToUpper(strings.TrimSpace(symbol))
		if key == "" {
			continue
		}
		out[key] = weight
	}
	out[strings.ToUpper(strings.TrimSpace(indexName))] = 100
	return out
}

func cloneNestedWeightMap(input map[string]map[string]float64) map[string]map[string]float64 {
	if len(input) == 0 {
		return nil
	}
	out := make(map[string]map[string]float64, len(input))
	for indexName, weights := range input {
		weightsCopy := make(map[string]float64, len(weights))
		for symbol, value := range weights {
			weightsCopy[strings.ToUpper(strings.TrimSpace(symbol))] = value
		}
		out[strings.ToUpper(strings.TrimSpace(indexName))] = weightsCopy
	}
	return out
}

func lookupStaticWeightPct(weightMaps map[string]map[string]float64, indexName, symbol string) (float64, bool) {
	if len(weightMaps) == 0 {
		return 0, false
	}
	indexKey := strings.ToUpper(strings.TrimSpace(indexName))
	symbolKey := strings.ToUpper(strings.TrimSpace(symbol))
	if indexKey == "" || symbolKey == "" {
		return 0, false
	}
	weights, ok := weightMaps[indexKey]
	if !ok || len(weights) == 0 {
		return 0, false
	}
	value, ok := weights[symbolKey]
	if !ok || value <= 0 {
		return 0, false
	}
	return value, true
}
