# Polymarket Strategy Analyzer

## Overview
A Node.js application that analyzes trading strategies of top Polymarket holders using AI. The app fetches data from Polymarket's public APIs, identifies top traders from high-volume markets, retrieves their trade histories, and uses Google Gemini AI to generate strategy explanations suitable for novice traders.

## Project Structure
```
.
├── index.js           # Main application code
├── package.json       # Node.js dependencies and configuration
├── replit.md          # Project documentation
└── README.md          # Original repository readme
```

## Dependencies
- `node-fetch` - HTTP client for making API requests
- `@google/genai` - Google Gemini AI SDK for strategy analysis

## Environment Variables
- `GEMINI_API_KEY` - Google Gemini API key for AI-powered analysis
- `POLYLAPIS_API_KEY` - Polymarket API key (optional, for enhanced access)

## How It Works

### 1. Data Collection (`getTopFiveWallets`)
- Fetches active markets from the Gamma API
- Identifies highest-volume market
- Retrieves top 5 holders from that market via the Data API

### 2. Trade History (`getRawTrades`)
- Fetches trade history for each wallet address
- Filters trades from the last 7 days
- Returns clean, structured trade data (market, action, price, timestamp)

### 3. AI Analysis (`explainStrategy`)
- Uses Gemini 2.5 Flash model
- Analyzes trade patterns and generates a one-paragraph strategy explanation
- Focuses on market types, entry/exit patterns, risk management, and timing

## API Endpoints Used
- Gamma API: `https://gamma-api.polymarket.com/markets` - Market data
- Data API: `https://data-api.polymarket.com/holders` - Top holders
- Data API: `https://data-api.polymarket.com/trades` - Trade history

## Running the Application
The application runs as a console-based Node.js workflow:
```bash
node index.js
```

## Output Format
The application outputs:
- Top market being analyzed (name and volume)
- For each top holder:
  - Wallet name and address
  - Position size
  - Number of trades found
  - AI-generated strategy analysis

## Recent Changes
- November 29, 2025: Initial setup and configuration for Replit environment
- Implemented ES module syntax for Node.js 20 compatibility
- Integrated Gemini AI for strategy analysis
- Added proper parsing for Polymarket API response structures
