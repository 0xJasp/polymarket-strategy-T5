# Polymarket Strategy Analyzer

## Overview
A Node.js hackathon application that identifies the top 5 weekly profit traders from Polymarket, retrieves their trade history from the last 7 days, and uses Google Gemini AI (gemini-2.5-flash model) to generate strategy explanations suitable for novice traders.

## Project Structure
```
.
├── index.js           # Main application code
├── package.json       # Node.js dependencies (ES modules)
└── replit.md          # Project documentation
```

## Dependencies
- `node-fetch` - HTTP client for making API requests
- `@google/genai` - Google Gemini AI SDK for strategy analysis

## Environment Variables
- `GEMINI_API_KEY` - Google Gemini API key for AI-powered analysis

## How It Works

### 1. Find Active Traders (`getRecentActiveTraders`)
- Fetches 20 active markets from the Gamma API
- Filters to the top 5 by trading volume
- Retrieves holders from each market via the Data API
- Collects up to 50 unique active traders

### 2. Calculate Weekly Profits (`calculateWeeklyProfit`)
- For each trader, fetches their last 500 trades
- Filters to trades from the last 7 days
- Calculates profit: SELL trades add value, BUY trades subtract value
- Returns profit, trade count, and trade details

### 3. Rank Top Traders (`getTopFiveWeeklyProfitTraders`)
- Calculates weekly profit for all active traders
- Sorts by profit descending
- Returns the top 5 profit makers

### 4. AI Strategy Analysis (`explainStrategy`)
- Uses Gemini 2.5 Flash model
- Analyzes trade patterns and weekly profit context
- Generates one-paragraph strategy explanations focusing on:
  - Market types they trade
  - Entry/exit patterns
  - Risk management approach
  - Why the strategy is profitable

## API Endpoints Used
- Gamma API: `https://gamma-api.polymarket.com/markets` - Market listings
- Data API: `https://data-api.polymarket.com/holders` - Market holders
- Data API: `https://data-api.polymarket.com/trades` - Trade history

## Running the Application
```bash
node index.js
```

## Output Format
```
============================================================
POLYMARKET TOP WEEKLY PROFIT TRADER ANALYZER
============================================================

RANK #1 - TOP WEEKLY PROFIT TRADER
Name: trader_name
Address: 0x...
Weekly Profit: $XX,XXX.XX
Trades (7 days): XX

STRATEGY ANALYSIS:
[AI-generated strategy explanation paragraph]
```

## Recent Changes
- November 29, 2025: Implemented weekly profit calculation from actual trade data
- Traders are now ranked by their calculated weekly profit, not just position size
- AI analysis includes profit context for more relevant explanations
