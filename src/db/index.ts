import { Pool } from 'pg';
import { MarketData } from '../services/dataFetcher';
import { setupDatabase } from './schema';

// Log the connection string (remove sensitive parts)
const connectionString = process.env.DATABASE_URL;
console.log('Attempting to connect to database with URL structure:', 
  connectionString ? connectionString.split('@')[1] : 'undefined');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: {
    rejectUnauthorized: false
  }
});

// Test the connection
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Test connection immediately
pool.connect((err, client, done) => {
  if (err) {
    console.error('Error connecting to the database:', err.message);
  } else {
    console.log('Successfully connected to database');
    done();
  }
});

export async function initializeDatabase() {
  try {
    await setupDatabase(pool);
  } catch (error) {
    console.error('Failed to initialize database:', error);
    throw error;
  }
}

export async function storeMarketData(data: MarketData) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const marketDataResult = await client.query(
      'INSERT INTO market_data (timestamp, usdm_price) VALUES ($1, $2) RETURNING id',
      [data.timestamp, data.usdmPrice]
    );

    const marketDataId = marketDataResult.rows[0].id;

    // Batch insert funding rates
    const values = data.fundingRates.map((rate, index) => 
      `($1, ${rate.marketId}, ${rate.rate})${index === data.fundingRates.length - 1 ? '' : ','}`
    ).join('\n');

    await client.query(`
      INSERT INTO funding_rates (market_data_id, market_id, rate)
      VALUES ${values}
    `, [marketDataId]);

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error storing market data:', error);
    throw error;
  } finally {
    client.release();
  }
}

export async function getLatestMarketData() {
  const result = await pool.query('SELECT * FROM latest_market_data');
  return result.rows[0];
}

export async function getHistoricalData(startTime: number, endTime: number) {
  const result = await pool.query(`
    SELECT 
      md.timestamp,
      md.usdm_price,
      json_agg(
        json_build_object(
          'marketId', fr.market_id, 
          'rate', fr.rate
        ) ORDER BY fr.market_id
      ) as funding_rates
    FROM market_data md
    JOIN funding_rates fr ON fr.market_data_id = md.id
    WHERE md.timestamp BETWEEN $1 AND $2
    GROUP BY md.id, md.timestamp, md.usdm_price
    ORDER BY md.timestamp DESC
  `, [startTime, endTime]);

  return result.rows;
}

// New utility functions for analytics

export async function getAverageRatesByMarket(startTime: number, endTime: number) {
  const result = await pool.query(`
    SELECT 
      fr.market_id,
      AVG(fr.rate) as avg_rate,
      MIN(fr.rate) as min_rate,
      MAX(fr.rate) as max_rate,
      COUNT(*) as data_points
    FROM funding_rates fr
    JOIN market_data md ON md.id = fr.market_data_id
    WHERE md.timestamp BETWEEN $1 AND $2
    GROUP BY fr.market_id
    ORDER BY fr.market_id
  `, [startTime, endTime]);

  return result.rows;
}

export async function getUSDMPriceStats(startTime: number, endTime: number) {
  const result = await pool.query(`
    SELECT 
      AVG(usdm_price) as avg_price,
      MIN(usdm_price) as min_price,
      MAX(usdm_price) as max_price,
      COUNT(*) as data_points
    FROM market_data
    WHERE timestamp BETWEEN $1 AND $2
  `, [startTime, endTime]);

  return result.rows[0];
}

// Add this type and function before the existing functions
type Granularity = '1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '8h' | '24h';

function getIntervalQuery(granularity: Granularity): string {
  const intervals = {
    '1m': '1 minute',
    '5m': '5 minutes',
    '15m': '15 minutes',
    '30m': '30 minutes',
    '1h': '1 hour',
    '4h': '4 hours',
    '8h': '8 hours',
    '24h': '24 hours'
  };

  return `
    WITH grouped_data AS (
      SELECT 
        (EXTRACT(EPOCH FROM date_trunc('${intervals[granularity].split(' ')[1]}', 
          to_timestamp(md.timestamp / 1000)
        )) * 1000)::bigint as bucket,
        AVG(fr.rate::numeric) as avg_rate,
        AVG(md.usdm_price::numeric) as avg_usdm_price,
        COUNT(*) as sample_count
      FROM market_data md
      JOIN funding_rates fr ON fr.market_data_id = md.id
      WHERE 
        md.timestamp BETWEEN $1 AND $2
        AND fr.market_id = $3
      GROUP BY bucket
      ORDER BY bucket ASC
    )
    SELECT 
      bucket as timestamp,
      avg_rate::text as rate,
      avg_usdm_price::text as usdm_price,
      sample_count
    FROM grouped_data
  `;
}

export async function getHistoricalRatesForMarket(
  marketId: number, 
  startTime: number, 
  endTime: number,
  granularity?: Granularity
) {
  const query = granularity 
    ? getIntervalQuery(granularity)
    : `
      SELECT 
        md.timestamp,
        fr.rate,
        md.usdm_price
      FROM market_data md
      JOIN funding_rates fr ON fr.market_data_id = md.id
      WHERE 
        md.timestamp BETWEEN $1 AND $2
        AND fr.market_id = $3
      ORDER BY md.timestamp ASC
    `;

  const result = await pool.query(query, [startTime, endTime, marketId]);
  return result.rows;
} 