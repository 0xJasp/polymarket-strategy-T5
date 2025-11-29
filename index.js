import fetch from 'node-fetch';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

async function getRecentActiveTraders() {
    try {
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
        
        console.log(`Scanning ${sortedMarkets.length} high-volume markets for active traders...`);
        
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
    } catch (error) {
        console.error('Error fetching active traders:', error.message);
        return [];
    }
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

async function getTopFiveWeeklyProfitTraders() {
    console.log('Fetching active traders from high-volume markets...');
    const activeTraders = await getRecentActiveTraders();
    
    if (activeTraders.length === 0) {
        console.log('No active traders found.');
        return [];
    }
    
    console.log(`Found ${activeTraders.length} active traders. Calculating weekly profits...`);
    console.log('(This may take a moment as we analyze each trader\'s history)\n');
    
    const tradersWithProfits = [];
    
    for (let i = 0; i < activeTraders.length; i++) {
        const trader = activeTraders[i];
        const { profit, trades, tradeCount } = await calculateWeeklyProfit(trader.walletAddress);
        
        if (tradeCount > 0) {
            tradersWithProfits.push({
                ...trader,
                weeklyProfit: profit,
                trades: trades,
                tradeCount: tradeCount
            });
            process.stdout.write(`\rAnalyzed ${i + 1}/${activeTraders.length} traders... Found ${tradersWithProfits.length} with activity`);
        }
    }
    
    console.log('\n');
    
    const topTraders = tradersWithProfits
        .sort((a, b) => b.weeklyProfit - a.weeklyProfit)
        .slice(0, 5)
        .map((trader, index) => ({
            ...trader,
            rank: index + 1
        }));
    
    return topTraders;
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
- Any notable patterns in timing or pricing
- Why this strategy might be profitable

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
    console.log('POLYMARKET TOP WEEKLY PROFIT TRADER ANALYZER');
    console.log('='.repeat(60));
    console.log();
    
    const topTraders = await getTopFiveWeeklyProfitTraders();
    
    if (topTraders.length === 0) {
        console.log('No traders with recent activity found. Please check API connection.');
        return;
    }
    
    console.log(`Found ${topTraders.length} top profit traders from the last 7 days.\n`);
    
    for (const trader of topTraders) {
        console.log('-'.repeat(60));
        console.log(`RANK #${trader.rank} - TOP WEEKLY PROFIT TRADER`);
        console.log(`Name: ${trader.name}`);
        console.log(`Address: ${trader.walletAddress}`);
        console.log(`Weekly Profit: $${trader.weeklyProfit.toFixed(2)}`);
        console.log(`Trades (7 days): ${trader.tradeCount}`);
        console.log();
        
        console.log('Analyzing trading strategy with AI...\n');
        
        const strategy = await explainStrategy(trader.trades, trader.weeklyProfit);
        
        console.log('STRATEGY ANALYSIS:');
        console.log(strategy);
        console.log();
    }
    
    console.log('='.repeat(60));
    console.log('Analysis complete!');
    console.log('='.repeat(60));
}

main();
