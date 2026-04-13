// mcp-server.ts

// @ts-nocheck
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCache } from "./cache";

const BINANCE_API = process.env.BINANCE_API_BASE ?? "https://api.binance.com/api/v3";
const EXCHANGE_INFO_TTL = 5 * 60 * 1000; // 5 minutes

const server = new McpServer({
    name: "binance-mcp",
    version: "2.0.0",
});

async function binanceFetch(path: string, params?: Record<string, any>) {
    const url = new URL(`${BINANCE_API}${path}`);

    if (params) {
        Object.entries(params).forEach(([key, value]) => {
            if (value !== undefined) {
                if (Array.isArray(value)) {
                    url.searchParams.append(key, JSON.stringify(value));
                } else {
                    url.searchParams.append(key, String(value));
                }
            }
        });
    }

    const res = await fetch(url.toString());

    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Binance API error: ${res.status} ${res.statusText} — ${body}`);
    }

    return res.json();
}

function success(data: any) {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
}

function failure(error: any) {
    console.log({error})
    return {
        content: [{ type: "text" as const, text: String(error) }],
        isError: true,
    };
}

// Exchange Info
server.registerTool(
    "get_exchange_info",
    {
        description: "Get exchange trading rules and symbol info",
        inputSchema: {
            symbol: z.string().optional(),
            symbols: z.array(z.string()).optional(),
            permissions: z.union([z.string(), z.array(z.string())]).optional(),
            showPermissionSets: z.boolean().optional(),
            symbolStatus: z.enum(["TRADING", "HALT", "BREAK"]).optional(),
        },
    },
    async (params) => {
        try {
            const cacheKey = `exchangeInfo:${JSON.stringify(params || {})}`;
            const cached = getCache(cacheKey);
            if (cached) {
                return {
                    content: [
                        {
                            type: "text" as const,
                            text: JSON.stringify(
                                {
                                    ...cached,
                                    _cached: true,
                                },
                                null,
                                2,
                            ),
                        },
                    ],
                };
            }

            const data = await binanceFetch("/exchangeInfo", params);
            setCache(cacheKey, data, EXCHANGE_INFO_TTL);

            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

// Order Book
server.registerTool(
    "get_order_book",
    {
        description:
            "Get bid/ask order book depth. Use only when the user is specifically asking about liquidity, support/resistance levels, or wants to see the order book.",
        inputSchema: {
            symbol: z.string(),
            limit: z.number().optional().default(10),
        },
    },
    async ({ symbol, limit }) => {
        try {
            const data = await binanceFetch("/depth", { symbol, limit });
            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

// Historical Trades
server.registerTool(
    "get_historical_trades",
    {
        description: "Get historical trades (requires API key in real usage)",
        inputSchema: {
            symbol: z.string(),
            limit: z.number().optional(),
            fromId: z.number().optional(),
        },
    },
    async ({ symbol, limit, fromId }) => {
        try {
            const data = await binanceFetch("/historicalTrades", {
                symbol,
                limit,
                fromId,
            });
            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

// Aggregate Trades
server.registerTool(
    "get_agg_trades",
    {
        description: "Get compressed aggregate trades",
        inputSchema: {
            symbol: z.string(),
            fromId: z.number().optional(),
            startTime: z.number().optional(),
            endTime: z.number().optional(),
            limit: z.number().optional(),
        },
    },
    async (params) => {
        try {
            const data = await binanceFetch("/aggTrades", params);
            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

// Klines (FIXED: Spot API)
// server.registerTool(
//     "get_klines",
//     {
//         description: "Get candlestick data (OHLCV)",
//         inputSchema: {
//             symbol: z.string(),
//             interval: z.enum([
//                 "1m",
//                 "3m",
//                 "5m",
//                 "15m",
//                 "30m",
//                 "1h",
//                 "2h",
//                 "4h",
//                 "6h",
//                 "8h",
//                 "12h",
//                 "1d",
//                 "3d",
//                 "1w",
//                 "1M",
//             ]),
//             limit: z.number().max(1000).optional(),
//             startTime: z.number().optional(),
//             endTime: z.number().optional(),
//         },
//     },
//     async ({ symbol, interval, limit, startTime, endTime }) => {
//         try {
//             const raw = await binanceFetch("/klines", {
//                 symbol,
//                 interval,
//                 limit,
//                 startTime,
//                 endTime,
//             });

//             const formatted = raw.map((c: any[]) => ({
//                 openTime: c[0],
//                 open: c[1],
//                 high: c[2],
//                 low: c[3],
//                 close: c[4],
//                 volume: c[5],
//                 closeTime: c[6],
//             }));

//             return success(formatted);
//         } catch (e) {
//             return failure(e);
//         }
//     },
// );

server.registerTool(
    "analyze_price_action",
    {
        description:
            "Candlestick data and trend summary for a symbol. Use for chart or technical analysis questions.",
        inputSchema: {
            symbol: z.string(),
            interval: z.enum(["1m", "5m", "15m", "1h", "4h", "1d"]),
            limit: z.number().max(100).default(50),
        },
    },
    async ({ symbol, interval, limit }) => {
        try {
            const raw = await binanceFetch("/klines", { symbol, interval, limit });

            const candles = raw.map((c: any[]) => ({
                openTime: c[0],
                open: Number(c[1]),
                high: Number(c[2]),
                low: Number(c[3]),
                close: Number(c[4]),
                volume: Number(c[5]),
            }));

            const first = candles[0].close;
            const last = candles[candles.length - 1].close;
            const trend = last > first ? "uptrend" : last < first ? "downtrend" : "sideways";
            const high = Math.max(...candles.map((c: any) => c.high));
            const low = Math.min(...candles.map((c: any) => c.low));
            const avgVolume = candles.reduce((s: number, c: any) => s + c.volume, 0) / candles.length;

            return success({
                symbol,
                interval,
                trend,
                rangeHigh: high,
                rangeLow: low,
                avgVolume: avgVolume.toFixed(2),
                candleCount: candles.length,
                _chartCandles: candles, // picked up by index.ts for chart rendering
            });
        } catch (e) {
            return failure(e);
        }
    },
);

server.registerTool(
    "get_market_overview",
    {
        description:
            "Get a complete market snapshot for a symbol — current price, 24h change, volume, and best bid/ask. Use whenever the user asks about price, performance, or market status.",
        inputSchema: {
            symbol: z.string(),
        },
    },
    async ({ symbol }) => {
        try {
            const [ticker, avgPrice, bookTicker] = await Promise.all([
                binanceFetch("/ticker/24hr", { symbol }),
                binanceFetch("/avgPrice", { symbol }),
                binanceFetch("/ticker/bookTicker", { symbol }),
            ]);

            return success({
                symbol,
                currentPrice: ticker.lastPrice,
                avgPrice: avgPrice.price,
                change24h: ticker.priceChangePercent + "%",
                high24h: ticker.highPrice,
                low24h: ticker.lowPrice,
                volume24h: ticker.volume,
                bestBid: bookTicker.bidPrice,
                bestAsk: bookTicker.askPrice,
            });
        } catch (e) {
            return failure(e);
        }
    },
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("✅ Binance MCP Server running");
}

main().catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
});
