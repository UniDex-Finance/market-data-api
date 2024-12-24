import 'dotenv/config';
import express from 'express';
import { fetchMarketData } from './services/dataFetcher';
import { TRADING_PAIRS } from './constants';
import { FundingRate, MarketDataResponse, EnhancedFundingRate } from './types';
import { 
  initializeDatabase, 
  storeMarketData, 
  getLatestMarketData, 
  getHistoricalData,
  getAverageRatesByMarket,
  getUSDMPriceStats,
  getHistoricalRatesForMarket
} from './db';

const app = express();
const port = process.env.PORT || 3001;

app.use(express.json());

function parseDuration(duration: string): number {
  const value = parseInt(duration);
  const unit = duration.slice(-1).toLowerCase();
  const now = Date.now();

  switch (unit) {
    case 'd': // days
      return now - (value * 24 * 60 * 60 * 1000);
    case 'h': // hours
      return now - (value * 60 * 60 * 1000);
    case 'w': // weeks
      return now - (value * 7 * 24 * 60 * 60 * 1000);
    case 'm': // months (approximate)
      return now - (value * 30 * 24 * 60 * 60 * 1000);
    default:
      throw new Error('Invalid duration format. Use format: 30d, 24h, 4w, or 2m');
  }
}

// Start data collection
async function collectData() {
  try {
    const data = await fetchMarketData();
    await storeMarketData(data);
    console.log(`Data collected at: ${new Date().toISOString()}`);
    
    // Log any missing markets
    const missingMarkets = Array.from({length: 57}, (_, i) => i + 1)
      .filter(id => !data.fundingRates.find(rate => rate.marketId === id));
    
    if (missingMarkets.length > 0) {
      console.warn('Missing markets:', missingMarkets);
    }
  } catch (error) {
    console.error('Error collecting data:', error);
  }
}

// Initialize everything
async function initialize() {
  try {
    // First initialize the database
    await initializeDatabase();
    console.log('Database initialized successfully');

    // Start collecting data
    await collectData(); // Initial collection
    setInterval(collectData, 60000); // Then collect every minute

    // Start the server
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (error) {
    console.error('Failed to initialize:', error);
    process.exit(1);
  }
}

// API Endpoints
app.get('/api/latest', async (req, res) => {
  try {
    const data = await getLatestMarketData();
    res.json(data);
  } catch (error) {
    console.error('Error fetching latest data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/historical', async (req, res) => {
  try {
    const startTime = Number(req.query.startTime);
    const endTime = Number(req.query.endTime);

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Invalid startTime or endTime' });
    }

    const data = await getHistoricalData(startTime, endTime);
    res.json(data);
  } catch (error) {
    console.error('Error fetching historical data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/analytics/rates', async (req, res) => {
  try {
    const startTime = Number(req.query.startTime);
    const endTime = Number(req.query.endTime);

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Invalid startTime or endTime' });
    }

    const data = await getAverageRatesByMarket(startTime, endTime);
    res.json(data);
  } catch (error) {
    console.error('Error fetching rate analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/analytics/usdm', async (req, res) => {
  try {
    const startTime = Number(req.query.startTime);
    const endTime = Number(req.query.endTime);

    if (isNaN(startTime) || isNaN(endTime)) {
      return res.status(400).json({ error: 'Invalid startTime or endTime' });
    }

    const data = await getUSDMPriceStats(startTime, endTime);
    res.json(data);
  } catch (error) {
    console.error('Error fetching USDM price analytics:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/debug/latest-full', async (req, res) => {
  try {
    const data = await getLatestMarketData() as MarketDataResponse;
    if (!data) {
      return res.status(404).json({ error: 'No data found' });
    }

    // Add market count information
    const response = {
      timestamp: data.timestamp,
      usdm_price: data.usdm_price,
      total_markets: data.funding_rates.length,
      funding_rates: data.funding_rates
        .sort((a: FundingRate, b: FundingRate) => a.marketId - b.marketId)
        .map((rate: FundingRate): EnhancedFundingRate => ({
          ...rate,
          pair: TRADING_PAIRS[rate.marketId.toString()]
        }))
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching debug data:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

interface HistoricalDataPoint {
  timestamp: number;
  rate: number;
  usdm_price: number;
}

app.get('/api/market/:marketId/history', async (req, res) => {
  try {
    const marketId = Number(req.params.marketId);
    const startTime = Number(req.query.startTime);
    const endTime = Number(req.query.endTime) || Date.now();
    const granularity = req.query.granularity as '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '8h' | '24h' | undefined;

    if (isNaN(marketId) || isNaN(startTime)) {
      return res.status(400).json({ 
        error: 'Invalid parameters. Required: marketId (1-57), startTime (unix timestamp in ms)' 
      });
    }

    if (marketId < 1 || marketId > 57) {
      return res.status(400).json({ 
        error: 'Market ID must be between 1 and 57' 
      });
    }

    if (granularity && !['1m', '5m', '15m', '30m', '1h', '4h', '8h', '24h'].includes(granularity)) {
      return res.status(400).json({
        error: 'Invalid granularity. Supported values: 1m, 5m, 15m, 30m, 1h, 4h, 8h, 24h'
      });
    }

    const data = await getHistoricalRatesForMarket(marketId, startTime, endTime, granularity);
    
    // Enhance the response with market information
    const response = {
      market: {
        id: marketId,
        pair: TRADING_PAIRS[marketId.toString()]
      },
      timeRange: {
        start: new Date(startTime).toISOString(),
        end: new Date(endTime).toISOString()
      },
      granularity: granularity || '1m',
      dataPoints: data.length,
      history: data.map((point: HistoricalDataPoint & { sample_count?: number }) => ({
        timestamp: point.timestamp,
        rate: point.rate,
        usdm_price: point.usdm_price,
        ...(point.sample_count ? { samples: point.sample_count } : {})
      }))
    };

    res.json(response);
  } catch (error) {
    console.error('Error fetching market history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/market/:marketId/history/duration/:duration', async (req, res) => {
  try {
    const marketId = Number(req.params.marketId);
    const duration = req.params.duration;
    const granularity = req.query.granularity as '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '8h' | '24h' | undefined;

    if (isNaN(marketId) || marketId < 1 || marketId > 57) {
      return res.status(400).json({ 
        error: 'Market ID must be between 1 and 57' 
      });
    }

    if (granularity && !['1m', '5m', '15m', '30m', '1h', '4h', '8h', '24h'].includes(granularity)) {
      return res.status(400).json({
        error: 'Invalid granularity. Supported values: 1m, 5m, 15m, 30m, 1h, 4h, 8h, 24h'
      });
    }

    try {
      const startTime = parseDuration(duration);
      const endTime = Date.now();

      const data = await getHistoricalRatesForMarket(marketId, startTime, endTime, granularity);
      
      // Enhance the response with market information
      const response = {
        market: {
          id: marketId,
          pair: TRADING_PAIRS[marketId.toString()]
        },
        duration: duration,
        granularity: granularity || '1m',
        timeRange: {
          start: new Date(startTime).toISOString(),
          end: new Date(endTime).toISOString()
        },
        dataPoints: data.length,
        history: data.map((point: HistoricalDataPoint & { sample_count?: number }) => ({
          timestamp: point.timestamp,
          rate: point.rate,
          usdm_price: point.usdm_price,
          ...(point.sample_count ? { samples: point.sample_count } : {})
        }))
      };

      res.json(response);
    } catch (error) {
      return res.status(400).json({ 
        error: 'Invalid duration format. Use format: 30d, 24h, 4w, or 2m' 
      });
    }
  } catch (error) {
    console.error('Error fetching market history:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Start the application
initialize(); 