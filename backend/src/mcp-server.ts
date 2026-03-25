// @ts-nocheck
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BINANCE_API = "https://api.binance.com/api/v3";

// Create server instance
const server = new McpServer({
    name: "binance-mcp",
    version: "1.0.0",
});

server.registerTool(
    "add_numbers",
    {
        description: "Add two numbers together",
        inputSchema: {
            a: z.number().describe("First number"),
            b: z.number().describe("Second number"),
        },
    },
    ({ a, b }) => {
        return {
            content: [{ type: "text" as const, text: `${a} + ${b} = ${a + b}` }],
        };
    },
);

server.registerTool(
    "get_exchange_info",
    {
        description:
            "Get current exchange trading rules and symbol information from Binance. Returns timezone, server time, rate limits, exchange filters, and symbol details including trading status, asset precision, order types, and permissions.",
        inputSchema: {
            symbol: z
                .string()
                .optional()
                .describe("Single trading pair symbol (e.g., BNBBTC). Cannot be used with symbolStatus."),
            symbols: z
                .array(z.string())
                .optional()
                .describe(
                    'Array of trading pair symbols (e.g., ["BNBBTC", "BTCUSDT"]). Cannot be used with symbolStatus.',
                ),
            permissions: z
                .union([z.string(), z.array(z.string())])
                .optional()
                .describe(
                    "Filter by permission type. Single value (e.g., 'SPOT') or array (e.g., ['MARGIN', 'LEVERAGED']). Cannot be used with symbol or symbols.",
                ),
            showPermissionSets: z
                .boolean()
                .optional()
                .describe("Controls whether the permissionSets field is populated. Defaults to true."),
            symbolStatus: z
                .enum(["TRADING", "HALT", "BREAK"])
                .optional()
                .describe("Filter symbols by trading status. Cannot be used with symbol or symbols."),
        },
    },
    async ({ symbol, symbols, permissions, showPermissionSets, symbolStatus }) => {
        try {
            const baseUrl = `${BINANCE_API}/exchangeInfo`;
            const params = new URLSearchParams();

            if (symbol) {
                params.append("symbol", symbol);
            }
            if (symbols && symbols.length > 0) {
                params.append("symbols", JSON.stringify(symbols));
            }
            if (permissions) {
                if (Array.isArray(permissions)) {
                    params.append("permissions", JSON.stringify(permissions));
                } else {
                    params.append("permissions", permissions);
                }
            }
            if (showPermissionSets !== undefined) {
                params.append("showPermissionSets", String(showPermissionSets));
            }
            if (symbolStatus) {
                params.append("symbolStatus", symbolStatus);
            }

            const url = params.toString() ? `${baseUrl}?${params.toString()}` : baseUrl;
            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(data, null, 2),
                    },
                ],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [{ type: "text" as const, text: `Failed to get exchange info: ${errorMessage}` }],
                isError: true,
            };
        }
    },
);

server.registerTool(
    "get_klines",
    {
        description:
            "Get candlestick (kline) data from Binance Futures. Returns OHLCV data for a given symbol and interval.",
        inputSchema: {
            symbol: z.string().describe("Trading pair symbol (e.g., BTCUSDT)"),
            interval: z
                .enum([
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
                ])
                .describe("Candlestick interval"),
            limit: z.number().max(1500).optional().describe("Number of candles (default 500)"),
            startTime: z.number().optional().describe("Start timestamp in ms"),
            endTime: z.number().optional().describe("End timestamp in ms"),
        },
    },
    async ({ symbol, interval, limit, startTime, endTime }) => {
        try {
            // ⚠️ Use Futures API base URL
            const baseUrl = "https://fapi.binance.com/fapi/v1/klines";
            const params = new URLSearchParams();

            params.append("symbol", symbol);
            params.append("interval", interval);

            if (limit) params.append("limit", String(limit));
            if (startTime) params.append("startTime", String(startTime));
            if (endTime) params.append("endTime", String(endTime));

            const url = `${baseUrl}?${params.toString()}`;

            const response = await fetch(url);

            if (!response.ok) {
                throw new Error(`Binance API error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // Optional: format candles for readability
            const formatted = data.map((candle: any[]) => ({
                openTime: candle[0],
                open: candle[1],
                high: candle[2],
                low: candle[3],
                close: candle[4],
                volume: candle[5],
                closeTime: candle[6],
            }));

            return {
                content: [
                    {
                        type: "text" as const,
                        text: JSON.stringify(formatted, null, 2),
                    },
                ],
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Failed to get klines: ${errorMessage}`,
                    },
                ],
                isError: true,
            };
        }
    },
);

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("MCP Server running");
}

main().catch((error) => {
    console.error("Fatal error in main():", error);
    process.exit(1);
});
