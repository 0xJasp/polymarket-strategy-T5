const fetch = require('node-fetch');
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

async function getTopFiveWallets() {
    const url = 'https://clob.polymarket.com/v1/user/rankings?sort=pnl&timeframe=7d&limit=5';
    
    const headers = {
        'Accept': 'application/json'
    };
    
    if (process.env.POLYLAPIS_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.POLYLAPIS_API_KEY}`;
    }
    
    try {
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        const wallets = data.map(user => ({
            walletAddress: user.userAddress || user.wallet || user.address,
            profit: user.pnl || user.profit || user.weeklyPnl
        }));
        
        return wallets;
    } catch (error) {
        console.error('Error fetching top wallets:', error.message);
        return [];
    }
}

async function getRawTrades(walletAddress) {
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const url = `https://clob.polymarket.com/v1/trades?maker_address=${walletAddress}`;
    
    const headers = {
        'Accept': 'application/json'
    };
    
    if (process.env.POLYLAPIS_API_KEY) {
        headers['Authorization'] = `Bearer ${process.env.POLYLAPIS_API_KEY}`;
    }
    
    try {
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const trades = Array.isArray(data) ? data : (data.trades || data.data || []);
        
        const cleanTrades = trades
            .filter(trade => {
                const tradeTime = new Date(trade.timestamp || trade.createdAt || trade.created_at).getTime();
                return tradeTime >= sevenDaysAgo;
            })
            .map(trade => ({
                market: trade.market || trade.marketSlug || trade.condition_id || 'Unknown Market',
                action: trade.side || trade.type || trade.action || 'Unknown',
                price: parseFloat(trade.price) || 0,
                timestamp: trade.timestamp || trade.createdAt || trade.created_at
            }));
        
        return cleanTrades;
    } catch (error) {
        console.error(`Error fetching trades for ${walletAddress}:`, error.message);
        return [];
    }
}

async function explainStrategy(rawTradeData) {
    if (!rawTradeData || rawTradeData.length === 0) {
        return 'No trade data available to analyze.';
    }
    
    const tradesSummary = JSON.stringify(rawTradeData, null, 2);
    
    const prompt = `You are an expert prediction market analyst. Analyze the following raw trade data from a top-performing Polymarket trader and deduce their trading strategy.

Trade Data:
${tradesSummary}

Based on this trade history, provide a one-paragraph strategy explanation suitable for a novice trader. Focus on:
- What types of markets they trade
- Their entry/exit patterns
- Risk management approach
- Any notable patterns in timing or pricing

Return ONLY the strategy explanation paragraph, nothing else.`;

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: prompt
        });
        
        return response.text || 'Unable to generate strategy explanation.';
    } catch (error) {
        console.error('Error generating strategy explanation:', error.message);
        return 'Error analyzing trade data with AI.';
    }
}

async function main() {
    console.log('='.repeat(60));
    console.log('POLYMARKET TOP TRADER STRATEGY ANALYZER');
    console.log('='.repeat(60));
    console.log();
    
    console.log('Fetching top 5 weekly profit wallets...\n');
    const topWallets = await getTopFiveWallets();
    
    if (topWallets.length === 0) {
        console.log('No wallet data available. Please check API connection.');
        return;
    }
    
    for (let i = 0; i < topWallets.length; i++) {
        const wallet = topWallets[i];
        console.log('-'.repeat(60));
        console.log(`WALLET #${i + 1}`);
        console.log(`Address: ${wallet.walletAddress}`);
        console.log(`Weekly Profit: $${typeof wallet.profit === 'number' ? wallet.profit.toLocaleString() : wallet.profit}`);
        console.log();
        
        console.log('Fetching trade history...');
        const trades = await getRawTrades(wallet.walletAddress);
        
        if (trades.length === 0) {
            console.log('No recent trades found for this wallet.\n');
            continue;
        }
        
        console.log(`Found ${trades.length} trades in the last 7 days.`);
        console.log('Analyzing trading strategy with AI...\n');
        
        const strategy = await explainStrategy(trades);
        
        console.log('STRATEGY ANALYSIS:');
        console.log(strategy);
        console.log();
    }
    
    console.log('='.repeat(60));
    console.log('Analysis complete!');
    console.log('='.repeat(60));
}

main();
