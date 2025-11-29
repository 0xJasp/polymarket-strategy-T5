import express from 'express';
import fetch from 'node-fetch';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = 5000;

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

let lastResults = null;
let isRunning = false;
let lastRunTime = null;

async function getRecentActiveTraders() {
    const marketsUrl = 'https://gamma-api.polymarket.com/markets?limit=20&active=true&closed=false';
    const marketsResponse = await fetch(marketsUrl, {
        headers: { 'Accept': 'application/json' }
    });
    
    if (!marketsResponse.ok) {
        throw new Error(`Markets HTTP error! status: ${marketsResponse.status}`);
    }
    
    const markets = await marketsResponse.json();
    const sortedMarkets = markets
        .filter(m => m.volumeNum && m.volumeNum > 100000)
        .sort((a, b) => (b.volumeNum || 0) - (a.volumeNum || 0))
        .slice(0, 5);
    
    const allTraders = new Map();
    
    for (const market of sortedMarkets) {
        const holdersUrl = `https://data-api.polymarket.com/holders?market=${market.conditionId}&limit=20`;
        const holdersResponse = await fetch(holdersUrl, {
            headers: { 'Accept': 'application/json' }
        });
        
        if (holdersResponse.ok) {
            const holdersData = await holdersResponse.json();
            if (Array.isArray(holdersData)) {
                for (const tokenData of holdersData) {
                    if (tokenData.holders && Array.isArray(tokenData.holders)) {
                        for (const holder of tokenData.holders) {
                            const wallet = holder.proxyWallet;
                            if (wallet && !allTraders.has(wallet)) {
                                allTraders.set(wallet, {
                                    walletAddress: wallet,
                                    name: holder.name || holder.pseudonym || 'Anonymous'
                                });
                            }
                        }
                    }
                }
            }
        }
    }
    
    return Array.from(allTraders.values()).slice(0, 50);
}

async function calculateWeeklyProfit(walletAddress) {
    const sevenDaysAgo = Math.floor((Date.now() - (7 * 24 * 60 * 60 * 1000)) / 1000);
    const url = `https://data-api.polymarket.com/trades?user=${walletAddress}&limit=500`;
    
    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
            return { profit: 0, trades: [], tradeCount: 0 };
        }
        
        const data = await response.json();
        const trades = Array.isArray(data) ? data : (data.trades || data.data || []);
        
        const recentTrades = trades.filter(trade => {
            const tradeTime = trade.timestamp || 0;
            return tradeTime >= sevenDaysAgo;
        });
        
        let totalProfit = 0;
        const cleanTrades = [];
        
        for (const trade of recentTrades) {
            const price = parseFloat(trade.price) || 0;
            const size = parseFloat(trade.size) || 0;
            const side = trade.side || '';
            const tradeValue = price * size;
            
            if (side === 'SELL') {
                totalProfit += tradeValue;
            } else if (side === 'BUY') {
                totalProfit -= tradeValue;
            }
            
            cleanTrades.push({
                market: trade.title || trade.slug || 'Unknown Market',
                action: side,
                price: price,
                size: size,
                value: tradeValue,
                timestamp: trade.timestamp
            });
        }
        
        return {
            profit: totalProfit,
            trades: cleanTrades,
            tradeCount: recentTrades.length
        };
    } catch (error) {
        return { profit: 0, trades: [], tradeCount: 0 };
    }
}

async function explainStrategy(rawTradeData, weeklyProfit) {
    if (!rawTradeData || rawTradeData.length === 0) {
        return 'No trade data available to analyze.';
    }
    
    const tradesSummary = JSON.stringify(rawTradeData.slice(0, 50), null, 2);
    const profitStatus = weeklyProfit >= 0 ? `profit of $${weeklyProfit.toFixed(2)}` : `loss of $${Math.abs(weeklyProfit).toFixed(2)}`;
    
    const prompt = `You are an expert prediction market analyst. Analyze the following raw trade data from a top-performing Polymarket trader who made a weekly ${profitStatus}.

Trade Data (last 7 days):
${tradesSummary}

Based on this trade history, provide a one-paragraph strategy explanation suitable for a novice trader. Focus on:
- What types of markets they trade
- Their entry/exit patterns (buy low, sell high?)
- Risk management approach
- Why this strategy might be profitable

Return ONLY the strategy explanation paragraph, nothing else.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
        });
        
        return response.text || 'Unable to generate strategy explanation.';
    } catch (error) {
        return 'Error analyzing trade data with AI.';
    }
}

async function runAnalysis() {
    if (isRunning) {
        return { error: 'Analysis already in progress' };
    }
    
    isRunning = true;
    const results = [];
    
    try {
        const activeTraders = await getRecentActiveTraders();
        
        if (activeTraders.length === 0) {
            isRunning = false;
            return { error: 'No active traders found' };
        }
        
        const tradersWithProfits = [];
        
        for (const trader of activeTraders) {
            const { profit, trades, tradeCount } = await calculateWeeklyProfit(trader.walletAddress);
            
            if (tradeCount > 0) {
                tradersWithProfits.push({
                    ...trader,
                    weeklyProfit: profit,
                    trades: trades,
                    tradeCount: tradeCount
                });
            }
        }
        
        const topTraders = tradersWithProfits
            .sort((a, b) => b.weeklyProfit - a.weeklyProfit)
            .slice(0, 5);
        
        for (let i = 0; i < topTraders.length; i++) {
            const trader = topTraders[i];
            const strategy = await explainStrategy(trader.trades, trader.weeklyProfit);
            
            results.push({
                rank: i + 1,
                name: trader.name,
                walletAddress: trader.walletAddress,
                weeklyProfit: trader.weeklyProfit,
                tradeCount: trader.tradeCount,
                strategy: strategy
            });
        }
        
        lastResults = results;
        lastRunTime = new Date().toISOString();
        isRunning = false;
        
        return { success: true, results };
    } catch (error) {
        isRunning = false;
        return { error: error.message };
    }
}

const htmlTemplate = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Polymarket Strategy Analyzer</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
            min-height: 100vh;
            color: #e4e4e4;
            padding: 20px;
        }
        .container { max-width: 900px; margin: 0 auto; }
        header {
            text-align: center;
            padding: 40px 20px;
            background: rgba(255,255,255,0.05);
            border-radius: 16px;
            margin-bottom: 30px;
        }
        h1 {
            font-size: 2.2em;
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
            margin-bottom: 10px;
        }
        .subtitle { color: #888; font-size: 1.1em; }
        .controls {
            display: flex;
            gap: 15px;
            justify-content: center;
            margin-bottom: 30px;
            flex-wrap: wrap;
        }
        button {
            padding: 14px 32px;
            font-size: 1em;
            border: none;
            border-radius: 8px;
            cursor: pointer;
            font-weight: 600;
            transition: all 0.3s;
        }
        .btn-primary {
            background: linear-gradient(90deg, #00d9ff, #00ff88);
            color: #1a1a2e;
        }
        .btn-primary:hover { transform: translateY(-2px); box-shadow: 0 5px 20px rgba(0,217,255,0.3); }
        .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; transform: none; }
        .status {
            text-align: center;
            padding: 15px;
            background: rgba(255,255,255,0.05);
            border-radius: 8px;
            margin-bottom: 20px;
        }
        .loading {
            display: none;
            text-align: center;
            padding: 40px;
        }
        .loading.active { display: block; }
        .spinner {
            width: 50px;
            height: 50px;
            border: 4px solid rgba(0,217,255,0.2);
            border-top-color: #00d9ff;
            border-radius: 50%;
            animation: spin 1s linear infinite;
            margin: 0 auto 20px;
        }
        @keyframes spin { to { transform: rotate(360deg); } }
        .results { display: none; }
        .results.active { display: block; }
        .trader-card {
            background: rgba(255,255,255,0.05);
            border-radius: 12px;
            padding: 25px;
            margin-bottom: 20px;
            border-left: 4px solid #00d9ff;
        }
        .trader-header {
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            margin-bottom: 15px;
            flex-wrap: wrap;
            gap: 10px;
        }
        .rank {
            font-size: 1.5em;
            font-weight: bold;
            color: #00d9ff;
        }
        .profit {
            font-size: 1.3em;
            font-weight: bold;
            color: #00ff88;
        }
        .profit.negative { color: #ff6b6b; }
        .trader-info { margin-bottom: 15px; }
        .trader-name { font-size: 1.2em; font-weight: 600; }
        .wallet {
            font-family: monospace;
            font-size: 0.85em;
            color: #888;
            word-break: break-all;
        }
        .trades-count { color: #888; margin-top: 5px; }
        .strategy {
            background: rgba(0,0,0,0.2);
            padding: 15px;
            border-radius: 8px;
            line-height: 1.6;
        }
        .strategy-label {
            font-weight: 600;
            color: #00d9ff;
            margin-bottom: 8px;
        }
        .no-results {
            text-align: center;
            padding: 40px;
            color: #888;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>Polymarket Strategy Analyzer</h1>
            <p class="subtitle">AI-powered analysis of top weekly profit traders</p>
        </header>
        
        <div class="controls">
            <button class="btn-primary" id="runBtn" onclick="runAnalysis()">
                Run Analysis
            </button>
        </div>
        
        <div class="status" id="status">
            <span id="statusText">Click "Run Analysis" to find top weekly profit traders</span>
        </div>
        
        <div class="loading" id="loading">
            <div class="spinner"></div>
            <p>Analyzing traders... This may take 1-2 minutes</p>
            <p style="color: #888; margin-top: 10px;">Scanning markets, calculating profits, generating AI insights</p>
        </div>
        
        <div class="results" id="results"></div>
    </div>
    
    <script>
        async function runAnalysis() {
            const btn = document.getElementById('runBtn');
            const loading = document.getElementById('loading');
            const results = document.getElementById('results');
            const status = document.getElementById('status');
            const statusText = document.getElementById('statusText');
            
            btn.disabled = true;
            loading.classList.add('active');
            results.classList.remove('active');
            status.style.display = 'none';
            
            try {
                const response = await fetch('/api/run');
                const data = await response.json();
                
                loading.classList.remove('active');
                btn.disabled = false;
                status.style.display = 'block';
                
                if (data.error) {
                    statusText.textContent = 'Error: ' + data.error;
                    return;
                }
                
                if (data.results && data.results.length > 0) {
                    statusText.textContent = 'Last run: ' + new Date().toLocaleString();
                    renderResults(data.results);
                } else {
                    statusText.textContent = 'No traders with activity found';
                }
            } catch (err) {
                loading.classList.remove('active');
                btn.disabled = false;
                status.style.display = 'block';
                statusText.textContent = 'Error: ' + err.message;
            }
        }
        
        function renderResults(traders) {
            const container = document.getElementById('results');
            container.innerHTML = traders.map(trader => \`
                <div class="trader-card">
                    <div class="trader-header">
                        <span class="rank">#\${trader.rank}</span>
                        <span class="profit \${trader.weeklyProfit < 0 ? 'negative' : ''}">
                            \${trader.weeklyProfit >= 0 ? '+' : ''}\$\${trader.weeklyProfit.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2})}
                        </span>
                    </div>
                    <div class="trader-info">
                        <div class="trader-name">\${trader.name}</div>
                        <div class="wallet">\${trader.walletAddress}</div>
                        <div class="trades-count">\${trader.tradeCount} trades in last 7 days</div>
                    </div>
                    <div class="strategy">
                        <div class="strategy-label">AI Strategy Analysis</div>
                        <p>\${trader.strategy}</p>
                    </div>
                </div>
            \`).join('');
            container.classList.add('active');
        }
        
        // Load last results on page load
        fetch('/api/results')
            .then(r => r.json())
            .then(data => {
                if (data.results && data.results.length > 0) {
                    document.getElementById('statusText').textContent = 'Last run: ' + new Date(data.lastRunTime).toLocaleString();
                    renderResults(data.results);
                }
            })
            .catch(() => {});
    </script>
</body>
</html>
`;

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(htmlTemplate);
});

app.get('/api/run', async (req, res) => {
    const result = await runAnalysis();
    res.json(result);
});

app.get('/api/results', (req, res) => {
    res.json({
        results: lastResults,
        lastRunTime: lastRunTime,
        isRunning: isRunning
    });
});

app.get('/api/status', (req, res) => {
    res.json({
        isRunning: isRunning,
        hasResults: lastResults !== null,
        lastRunTime: lastRunTime
    });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Polymarket Strategy Analyzer running at http://0.0.0.0:${PORT}`);
});
