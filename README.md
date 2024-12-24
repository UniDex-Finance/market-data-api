# Market Data API

This API fetches and stores market data from Arbitrum chain contracts, including USDM price and funding rates for multiple assets.

## Features

- Fetches USDM price from vault contract
- Fetches funding rates for 57 different markets
- Stores historical data in PostgreSQL database
- Provides REST API endpoints for data access
- Updates data every minute

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create a `.env` file with the following variables:
```
DATABASE_URL=postgresql://user:password@localhost:5432/market_data
PORT=3000
```

3. Build the project:
```bash
npm run build
```

## Running the API

Start the server:
```bash
npm start
```

For development with hot reload:
```bash
npm run dev
```

## API Endpoints

### Get Latest Data
```
GET /api/latest
```
Returns the most recent market data including USDM price and funding rates.

### Get Historical Data
```
GET /api/historical?startTime=1234567890000&endTime=1234567890000
```
Returns historical market data between the specified timestamps (in milliseconds).

## Database Schema

### market_data
- id: SERIAL PRIMARY KEY
- timestamp: BIGINT
- usdm_price: DECIMAL(20,8)
- created_at: TIMESTAMP

### funding_rates
- id: SERIAL PRIMARY KEY
- market_data_id: INTEGER (foreign key)
- market_id: INTEGER
- rate: DECIMAL(20,8) 