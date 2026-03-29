// @ts-nocheck
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { getCache } from "./cache";

const BINANCE_API = "https://api.binance.com/api/v3";
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
        throw new Error(`Binance API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
}

function success(data: any) {
    return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    };
}

function failure(error: any) {
    return {
        content: [{ type: "text" as const, text: String(error) }],
        isError: true,
    };
}

// Ping
server.registerTool(
    "ping",
    {
        description: "Test Binance API connectivity",
        inputSchema: {},
    },
    async () => {
        try {
            const data = await binanceFetch("/ping");
            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

// Server Time
server.registerTool(
    "get_server_time",
    {
        description: "Get Binance server time",
        inputSchema: {},
    },
    async () => {
        try {
            const data = await binanceFetch("/time");
            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

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
        description: "Get order book depth",
        inputSchema: {
            symbol: z.string(),
            limit: z.number().optional(),
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

// Recent Trades
server.registerTool(
    "get_recent_trades",
    {
        description: "Get recent trades",
        inputSchema: {
            symbol: z.string(),
            limit: z.number().optional(),
        },
    },
    async ({ symbol, limit }) => {
        try {
            const data = await binanceFetch("/trades", { symbol, limit });
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
server.registerTool(
    "get_klines",
    {
        description: "Get candlestick data (OHLCV)",
        inputSchema: {
            symbol: z.string(),
            interval: z.enum([
                "1m",
                "3m",
                "5m",
                "15m",
                "30m",
                "1h",
                "2h",
                "4h",
                "6h",
                "8h",
                "12h",
                "1d",
                "3d",
                "1w",
                "1M",
            ]),
            limit: z.number().max(1000).optional(),
            startTime: z.number().optional(),
            endTime: z.number().optional(),
        },
    },
    async ({ symbol, interval, limit, startTime, endTime }) => {
        try {
            const raw = await binanceFetch("/klines", {
                symbol,
                interval,
                limit,
                startTime,
                endTime,
            });

            const formatted = raw.map((c: any[]) => ({
                openTime: c[0],
                open: c[1],
                high: c[2],
                low: c[3],
                close: c[4],
                volume: c[5],
                closeTime: c[6],
            }));

            return success(formatted);
        } catch (e) {
            return failure(e);
        }
    },
);

// Average Price
server.registerTool(
    "get_avg_price",
    {
        description: "Get current average price",
        inputSchema: {
            symbol: z.string(),
        },
    },
    async ({ symbol }) => {
        try {
            const data = await binanceFetch("/avgPrice", { symbol });
            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

// 24h Ticker
server.registerTool(
    "get_24hr_ticker",
    {
        description: "24hr price change stats",
        inputSchema: {
            symbol: z.string().optional(),
        },
    },
    async ({ symbol }) => {
        try {
            const data = await binanceFetch("/ticker/24hr", { symbol });
            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

// Price
server.registerTool(
    "get_symbol_price",
    {
        description: "Latest price",
        inputSchema: {
            symbol: z.string().optional(),
        },
    },
    async ({ symbol }) => {
        try {
            const data = await binanceFetch("/ticker/price", { symbol });
            return success(data);
        } catch (e) {
            return failure(e);
        }
    },
);

// Book Ticker
server.registerTool(
    "get_book_ticker",
    {
        description: "Best bid/ask price",
        inputSchema: {
            symbol: z.string().optional(),
        },
    },
    async ({ symbol }) => {
        try {
            const data = await binanceFetch("/ticker/bookTicker", { symbol });
            return success(data);
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

// // @ts-nocheck
// import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
// import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
// import { z } from "zod";

// const BINANCE_API = "https://api.binance.com/api/v3";

// const server = new McpServer({
//     name: "binance-mcp",
//     version: "1.0.0",
// });

// server.registerTool(
//     "get_exchange_info",
//     {
//         description:
//             "Get current exchange trading rules and symbol information from Binance. Returns timezone, server time, rate limits, exchange filters, and symbol details including trading status, asset precision, order types, and permissions.",
//         inputSchema: {
//             symbol: z
//                 .string()
//                 .optional()
//                 .describe("Single trading pair symbol (e.g., BNBBTC). Cannot be used with symbolStatus."),
//             symbols: z
//                 .array(z.string())
//                 .optional()
//                 .describe(
//                     'Array of trading pair symbols (e.g., ["BNBBTC", "BTCUSDT"]). Cannot be used with symbolStatus.',
//                 ),
//             permissions: z
//                 .union([z.string(), z.array(z.string())])
//                 .optional()
//                 .describe(
//                     "Filter by permission type. Single value (e.g., 'SPOT') or array (e.g., ['MARGIN', 'LEVERAGED']). Cannot be used with symbol or symbols.",
//                 ),
//             showPermissionSets: z
//                 .boolean()
//                 .optional()
//                 .describe("Controls whether the permissionSets field is populated. Defaults to true."),
//             symbolStatus: z
//                 .enum(["TRADING", "HALT", "BREAK"])
//                 .optional()
//                 .describe("Filter symbols by trading status. Cannot be used with symbol or symbols."),
//         },
//     },
//     async ({ symbol, symbols, permissions, showPermissionSets, symbolStatus }) => {
//         try {
//             const baseUrl = `${BINANCE_API}/exchangeInfo`;
//             const params = new URLSearchParams();

//             if (symbol) {
//                 params.append("symbol", symbol);
//             }
//             if (symbols && symbols.length > 0) {
//                 params.append("symbols", JSON.stringify(symbols));
//             }
//             if (permissions) {
//                 if (Array.isArray(permissions)) {
//                     params.append("permissions", JSON.stringify(permissions));
//                 } else {
//                     params.append("permissions", permissions);
//                 }
//             }
//             if (showPermissionSets !== undefined) {
//                 params.append("showPermissionSets", String(showPermissionSets));
//             }
//             if (symbolStatus) {
//                 params.append("symbolStatus", symbolStatus);
//             }

//             const url = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
//             const response = await fetch(url);

//             if (!response.ok) {
//                 throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
//             }

//             const data = await response.json();

//             return {
//                 content: [
//                     {
//                         type: "text" as const,
//                         text: JSON.stringify(data, null, 2),
//                     },
//                 ],
//             };
//         } catch (error) {
//             const errorMessage = error instanceof Error ? error.message : String(error);
//             return {
//                 content: [{ type: "text" as const, text: `Failed to get exchange info: ${errorMessage}` }],
//                 isError: true,
//             };
//         }
//     },
// );

// server.registerTool(
//     "get_klines",
//     {
//         description:
//             "Get candlestick (kline) data from Binance Futures. Returns OHLCV data for a given symbol and interval.",
//         inputSchema: {
//             symbol: z.string().describe("Trading pair symbol (e.g., BTCUSDT)"),
//             interval: z
//                 .enum([
//                     "1m",
//                     "3m",
//                     "5m",
//                     "15m",
//                     "30m",
//                     "1h",
//                     "2h",
//                     "4h",
//                     "6h",
//                     "8h",
//                     "12h",
//                     "1d",
//                     "3d",
//                     "1w",
//                     "1M",
//                 ])
//                 .describe("Candlestick interval"),
//             limit: z.number().max(1500).optional().describe("Number of candles (default 500)"),
//             startTime: z.number().optional().describe("Start timestamp in ms"),
//             endTime: z.number().optional().describe("End timestamp in ms"),
//         },
//     },
//     async ({ symbol, interval, limit, startTime, endTime }) => {
//         try {
//             // ⚠️ Use Futures API base URL
//             const baseUrl = "https://fapi.binance.com/fapi/v1/klines";
//             const params = new URLSearchParams();

//             params.append("symbol", symbol);
//             params.append("interval", interval);

//             if (limit) params.append("limit", String(limit));
//             if (startTime) params.append("startTime", String(startTime));
//             if (endTime) params.append("endTime", String(endTime));

//             const url = `${baseUrl}?${params.toString()}`;

//             const response = await fetch(url);

//             if (!response.ok) {
//                 throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
//             }

//             const data = await response.json();

//             // Optional: format candles for readability
//             const formatted = data.map((candle: any[]) => ({
//                 openTime: candle[0],
//                 open: candle[1],
//                 high: candle[2],
//                 low: candle[3],
//                 close: candle[4],
//                 volume: candle[5],
//                 closeTime: candle[6],
//             }));

//             return {
//                 content: [
//                     {
//                         type: "text" as const,
//                         text: JSON.stringify(formatted, null, 2),
//                     },
//                 ],
//             };
//         } catch (error) {
//             const errorMessage = error instanceof Error ? error.message : String(error);
//             return {
//                 content: [
//                     {
//                         type: "text" as const,
//                         text: `Failed to get klines: ${errorMessage}`,
//                     },
//                 ],
//                 isError: true,
//             };
//         }
//     },
// );

// async function main() {
//     const transport = new StdioServerTransport();
//     await server.connect(transport);
//     console.error("MCP Server running");
// }

// main().catch((error) => {
//     console.error("Fatal error in main():", error);
//     process.exit(1);
// });
