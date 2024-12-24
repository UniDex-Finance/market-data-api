import { createPublicClient, http, Address } from 'viem';
import { arbitrum } from 'viem/chains';
import { vaultAbi, fundingRateAbi } from '../contracts/abis';

const VAULT_ADDRESS = '0x5f19704F393F983d5932b4453C6C87E85D22095E' as const;
const FUNDING_RATE_ADDRESS = '0x6f43f5ebfd5219d1c57d40a44e7d4524367253a0' as const;

const client = createPublicClient({
  chain: arbitrum,
  transport: http()
});

export interface MarketData {
  timestamp: number;
  usdmPrice: number;
  fundingRates: { marketId: number; rate: number }[];
}

export async function fetchMarketData(): Promise<MarketData> {
  // Prepare multicall for funding rates (1-57)
  const fundingRateCalls = Array.from({ length: 57 }, (_, i) => ({
    address: FUNDING_RATE_ADDRESS as Address,
    abi: fundingRateAbi,
    functionName: 'getFundingRate',
    args: [BigInt(i + 1)]
  }));

  // Add USDM price call
  const calls = [
    {
      address: VAULT_ADDRESS as Address,
      abi: vaultAbi,
      functionName: 'getUSDMPrice'
    },
    ...fundingRateCalls
  ];

  try {
    const results = await client.multicall({ contracts: calls });
    
    if (!results[0].status || results[0].result === undefined) {
      throw new Error('Failed to fetch USDM price');
    }

    const usdmPrice = Number(results[0].result) / 100000;
    const fundingRates = results.slice(1).map((result, index) => {
      if (!result.status || result.result === undefined) {
        return { marketId: index + 1, rate: 0 };
      }
      return {
        marketId: index + 1,
        rate: Number(result.result) / 10000000000000
      };
    });

    return {
      timestamp: Date.now(),
      usdmPrice,
      fundingRates
    };
  } catch (error) {
    console.error('Error fetching market data:', error);
    throw error;
  }
} 