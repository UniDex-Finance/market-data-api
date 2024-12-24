import { Pool } from 'pg';

export async function setupDatabase(pool: Pool) {
  const client = await pool.connect();
  try {
    // Start transaction
    await client.query('BEGIN');

    // Create market_data table
    await client.query(`
      CREATE TABLE IF NOT EXISTS market_data (
        id SERIAL PRIMARY KEY,
        timestamp BIGINT NOT NULL,
        usdm_price DECIMAL(20, 8) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT unique_timestamp UNIQUE (timestamp)
      );

      -- Index for timestamp queries
      CREATE INDEX IF NOT EXISTS idx_market_data_timestamp 
      ON market_data(timestamp DESC);

      -- Index for latest data queries
      CREATE INDEX IF NOT EXISTS idx_market_data_created_at 
      ON market_data(created_at DESC);
    `);

    // Create funding_rates table
    await client.query(`
      CREATE TABLE IF NOT EXISTS funding_rates (
        id SERIAL PRIMARY KEY,
        market_data_id INTEGER NOT NULL,
        market_id INTEGER NOT NULL,
        rate DECIMAL(20, 8) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT fk_market_data
          FOREIGN KEY(market_data_id) 
          REFERENCES market_data(id)
          ON DELETE CASCADE,
        CONSTRAINT unique_market_rate
          UNIQUE (market_data_id, market_id)
      );

      -- Index for market_id queries
      CREATE INDEX IF NOT EXISTS idx_funding_rates_market_id 
      ON funding_rates(market_id);

      -- Index for join queries
      CREATE INDEX IF NOT EXISTS idx_funding_rates_market_data_id 
      ON funding_rates(market_data_id);
    `);

    // Create a view for latest rates
    await client.query(`
      CREATE OR REPLACE VIEW latest_market_data AS
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
      WHERE md.id = (
        SELECT id FROM market_data 
        ORDER BY timestamp DESC 
        LIMIT 1
      )
      GROUP BY md.id, md.timestamp, md.usdm_price;
    `);

    await client.query('COMMIT');
    console.log('Database schema created successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error setting up database:', error);
    throw error;
  } finally {
    client.release();
  }
} 