package market

import (
	"fmt"
	"strings"
)

type SymbolInfo struct {
	Symbol string
	Name   string
	Yahoo  string
}

var niftyIndex = SymbolInfo{
	Symbol: "NIFTY50",
	Name:   "NIFTY 50",
	Yahoo:  "^NSEI",
}

var nifty50Constituents = []SymbolInfo{
	{Symbol: "ADANIENT", Name: "Adani Enterprises", Yahoo: "ADANIENT.NS"},
	{Symbol: "ADANIPORTS", Name: "Adani Ports", Yahoo: "ADANIPORTS.NS"},
	{Symbol: "APOLLOHOSP", Name: "Apollo Hospitals", Yahoo: "APOLLOHOSP.NS"},
	{Symbol: "ASIANPAINT", Name: "Asian Paints", Yahoo: "ASIANPAINT.NS"},
	{Symbol: "AXISBANK", Name: "Axis Bank", Yahoo: "AXISBANK.NS"},
	{Symbol: "BAJAJ-AUTO", Name: "Bajaj Auto", Yahoo: "BAJAJ-AUTO.NS"},
	{Symbol: "BAJAJFINSV", Name: "Bajaj Finserv", Yahoo: "BAJAJFINSV.NS"},
	{Symbol: "BAJFINANCE", Name: "Bajaj Finance", Yahoo: "BAJFINANCE.NS"},
	{Symbol: "BEL", Name: "Bharat Electronics", Yahoo: "BEL.NS"},
	{Symbol: "BPCL", Name: "BPCL", Yahoo: "BPCL.NS"},
	{Symbol: "BHARTIARTL", Name: "Bharti Airtel", Yahoo: "BHARTIARTL.NS"},
	{Symbol: "BRITANNIA", Name: "Britannia", Yahoo: "BRITANNIA.NS"},
	{Symbol: "CIPLA", Name: "Cipla", Yahoo: "CIPLA.NS"},
	{Symbol: "COALINDIA", Name: "Coal India", Yahoo: "COALINDIA.NS"},
	{Symbol: "DRREDDY", Name: "Dr Reddy's", Yahoo: "DRREDDY.NS"},
	{Symbol: "EICHERMOT", Name: "Eicher Motors", Yahoo: "EICHERMOT.NS"},
	{Symbol: "GRASIM", Name: "Grasim", Yahoo: "GRASIM.NS"},
	{Symbol: "HCLTECH", Name: "HCL Tech", Yahoo: "HCLTECH.NS"},
	{Symbol: "HDFCBANK", Name: "HDFC Bank", Yahoo: "HDFCBANK.NS"},
	{Symbol: "HDFCLIFE", Name: "HDFC Life", Yahoo: "HDFCLIFE.NS"},
	{Symbol: "HEROMOTOCO", Name: "Hero MotoCorp", Yahoo: "HEROMOTOCO.NS"},
	{Symbol: "HINDALCO", Name: "Hindalco", Yahoo: "HINDALCO.NS"},
	{Symbol: "HINDUNILVR", Name: "Hindustan Unilever", Yahoo: "HINDUNILVR.NS"},
	{Symbol: "ICICIBANK", Name: "ICICI Bank", Yahoo: "ICICIBANK.NS"},
	{Symbol: "INDUSINDBK", Name: "IndusInd Bank", Yahoo: "INDUSINDBK.NS"},
	{Symbol: "INFY", Name: "Infosys", Yahoo: "INFY.NS"},
	{Symbol: "ITC", Name: "ITC", Yahoo: "ITC.NS"},
	{Symbol: "JSWSTEEL", Name: "JSW Steel", Yahoo: "JSWSTEEL.NS"},
	{Symbol: "KOTAKBANK", Name: "Kotak Bank", Yahoo: "KOTAKBANK.NS"},
	{Symbol: "LT", Name: "Larsen & Toubro", Yahoo: "LT.NS"},
	{Symbol: "M&M", Name: "Mahindra & Mahindra", Yahoo: "M&M.NS"},
	{Symbol: "MARUTI", Name: "Maruti", Yahoo: "MARUTI.NS"},
	{Symbol: "NESTLEIND", Name: "Nestle India", Yahoo: "NESTLEIND.NS"},
	{Symbol: "NTPC", Name: "NTPC", Yahoo: "NTPC.NS"},
	{Symbol: "ONGC", Name: "ONGC", Yahoo: "ONGC.NS"},
	{Symbol: "POWERGRID", Name: "Power Grid", Yahoo: "POWERGRID.NS"},
	{Symbol: "RELIANCE", Name: "Reliance", Yahoo: "RELIANCE.NS"},
	{Symbol: "SBILIFE", Name: "SBI Life", Yahoo: "SBILIFE.NS"},
	{Symbol: "SBIN", Name: "SBI", Yahoo: "SBIN.NS"},
	{Symbol: "SHRIRAMFIN", Name: "Shriram Finance", Yahoo: "SHRIRAMFIN.NS"},
	{Symbol: "SUNPHARMA", Name: "Sun Pharma", Yahoo: "SUNPHARMA.NS"},
	{Symbol: "TATACONSUM", Name: "Tata Consumer", Yahoo: "TATACONSUM.NS"},
	{Symbol: "TATAMOTORS", Name: "Tata Motors", Yahoo: "TATAMOTORS.NS"},
	{Symbol: "TATASTEEL", Name: "Tata Steel", Yahoo: "TATASTEEL.NS"},
	{Symbol: "TCS", Name: "TCS", Yahoo: "TCS.NS"},
	{Symbol: "TECHM", Name: "Tech Mahindra", Yahoo: "TECHM.NS"},
	{Symbol: "TITAN", Name: "Titan", Yahoo: "TITAN.NS"},
	{Symbol: "TRENT", Name: "Trent", Yahoo: "TRENT.NS"},
	{Symbol: "ULTRACEMCO", Name: "UltraTech Cement", Yahoo: "ULTRACEMCO.NS"},
	{Symbol: "WIPRO", Name: "Wipro", Yahoo: "WIPRO.NS"},
}

var symbolLookup = buildSymbolLookup()

func buildSymbolLookup() map[string]SymbolInfo {
	lookup := map[string]SymbolInfo{
		niftyIndex.Symbol: niftyIndex,
		"NIFTY":           niftyIndex,
		niftyIndex.Yahoo:  niftyIndex,
	}

	for _, info := range nifty50Constituents {
		lookup[info.Symbol] = info
		lookup[info.Yahoo] = info
	}

	return lookup
}

func ResolveSymbol(raw string) (SymbolInfo, error) {
	key := strings.ToUpper(strings.TrimSpace(raw))
	if key == "" {
		return niftyIndex, nil
	}

	if info, ok := symbolLookup[key]; ok {
		return info, nil
	}

	return SymbolInfo{}, fmt.Errorf("unsupported symbol: %s", raw)
}

func Constituents() []SymbolInfo {
	copyList := make([]SymbolInfo, len(nifty50Constituents))
	copy(copyList, nifty50Constituents)
	return copyList
}
