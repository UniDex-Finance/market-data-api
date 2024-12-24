export interface FundingRate {
  marketId: number;
  rate: number;
}

export interface MarketDataResponse {
  timestamp: number;
  usdm_price: number;
  funding_rates: FundingRate[];
}

export interface EnhancedFundingRate extends FundingRate {
  pair: string;
} 