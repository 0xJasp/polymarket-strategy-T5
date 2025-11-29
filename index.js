import fetch from 'node-fetch';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

async function getTopFiveWallets() {
    try {
        const marketsUrl = 'https://gamma-api.polymarket.com/markets?limit=10&active=true&closed=false';
        const marketsResponse = await fetch(marketsUrl, {
            headers: { 'Accept': 'application/json' }
        });
        
        if (!marketsResponse.ok) {
            throw new Error(`Markets HTTP error! status: ${marketsResponse.status}`);
        }
        
        const markets = await marketsResponse.json();
        
        if (!Array.isArray(markets) || markets.length === 0) {
            throw new Error('No active markets found');
        }
        
        const sortedMarkets = markets
            .filter(m => m.volumeNum && m.volumeNum > 0)
            .sort((a, b) => (b.volumeNum || 0) - (a.volumeNum || 0));
        
        const topMarket = sortedMarkets[0];
        
        if (!topMarket || !topMarket.conditionId) {
            throw new Error('No valid market found');
        }
        
        console.log(`Using top market: ${topMarket.question || topMarket.slug}`);
        console.log(`Market volume: $${topMarket.volumeNum?.toLocaleString()}`);
        console.log();
        
        const holdersUrl = `https://data-api.polymarket.com/holders?market=${topMarket.conditionId}&limit=5`;
        const holdersResponse = await fetch(holdersUrl, {
            headers: { 'Accept': 'application/json' }
        });
        
        if (!holdersResponse.ok) {
            throw new Error(`Holders HTTP error! status: ${holdersResponse.status}`);
        }
        
        const holdersData = await holdersResponse.json();
        
        let allHolders = [];
        if (Array.isArray(holdersData)) {
            for (const tokenData of holdersData) {
                if (tokenData.holders && Array.isArray(tokenData.holders)) {
                    allHolders = allHolders.concat(tokenData.holders);
                }
            }
        }
        
        const uniqueWallets = new Map();
        for (const holder of allHolders) {
            const wallet = holder.proxyWallet;
            if (wallet && !uniqueWallets.has(wallet)) {
                uniqueWallets.set(wallet, {
                    walletAddress: wallet,
                    name: holder.name || holder.pseudonym || 'Anonymous',
                    profit: holder.amount || 0
                });
            }
        }
        
        const wallets = Array.from(uniqueWallets.values())
            .sort((a, b) => b.profit - a.profit)
            .slice(0, 5)
            .map((w, index) => ({ ...w, rank: index + 1 }));
        
        return wallets;
    } catch (error) {
        console.error('Error fetching top wallets:', error.message);
        return [];
    }
}

async function getRawTrades(walletAddress) {
    const sevenDaysAgo = Math.floor((Date.now() - (7 * 24 * 60 * 60 * 1000)) / 1000);
    const url = `https://data-api.polymarket.com/trades?user=${walletAddress}&limit=100`;
    
    const headers = {
        'Accept': 'application/json'
    };
    
    try {
        const response = await fetch(url, { headers });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        const trades = Array.isArray(data) ? data : (data.trades || data.data || []);
        
        const cleanTrades = trades
            .filter(trade => {
                const tradeTime = trade.timestamp || 0;
                return tradeTime >= sevenDaysAgo;
            })
            .map(trade => ({
                market: trade.title || trade.slug || trade.conditionId || 'Unknown Market',
                action: trade.side || 'Unknown',
                price: parseFloat(trade.price) || 0,
                size: parseFloat(trade.size) || 0,
                timestamp: trade.timestamp
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
            contents: [{ role: 'user', parts: [{ text: prompt }] }]
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
    
    console.log('Finding top holders from high-volume markets...\n');
    const topWallets = await getTopFiveWallets();
    
    if (topWallets.length === 0) {
        console.log('No wallet data available. Please check API connection.');
        return;
    }
    
    console.log(`Found ${topWallets.length} top holders to analyze.\n`);
    
    for (let i = 0; i < topWallets.length; i++) {
        const wallet = topWallets[i];
        console.log('-'.repeat(60));
        console.log(`WALLET #${wallet.rank}`);
        console.log(`Name: ${wallet.name || 'Anonymous'}`);
        console.log(`Address: ${wallet.walletAddress}`);
        console.log(`Position Size: $${typeof wallet.profit === 'number' ? wallet.profit.toLocaleString() : wallet.profit}`);
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
