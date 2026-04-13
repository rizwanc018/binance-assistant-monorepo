// index.ts

import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/index";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { randomUUID } from "crypto";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

let mcpClient: Client | null = null;
let availableTools: ChatCompletionTool[] = [];
const MAX_TOOL_CALL_ITERATIONS = 10;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a helpful cryptocurrency assistant with access to real-time Binance market data.

When users ask about cryptocurrencies:
- Use the correct symbol format (e.g., BTCUSDT for Bitcoin, ETHUSDT for Ethereum)
- Always use the available tools to fetch real-time data
- Provide clear, concise, and informative responses
- Format numbers with proper currency symbols and decimals
- Include relevant context like 24h change, volume, etc.

Common trading pairs:
- Bitcoin: BTCUSDT
- Ethereum: ETHUSDT
- Binance Coin: BNBUSDT
- Cardano: ADAUSDT
- Solana: SOLUSDT
- XRP: XRPUSDT
- Dogecoin: DOGEUSDT

Be conversational and helpful!
All responses should be short and concise.
For klines only give your prediction of the next candle. dont give the data itself.
`;

const pendingApprovals = new Map<string, (approved: boolean) => void>();

async function initializeMCPClient() {
    try {
        const serverPath = path.join(__dirname, "../dist/mcp-server.js");
        const transport = new StdioClientTransport({
            command: "node",
            args: [serverPath],
        });

        mcpClient = new Client({ name: "binance-web-client", version: "1.0.0" }, { capabilities: {} });

        await mcpClient.connect(transport);

        const toolsResponse = await mcpClient.listTools();
        availableTools = toolsResponse.tools.map((tool) => ({
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
                parameters: tool.inputSchema,
            },
        }));

        console.log("✅ MCP Client initialized successfully");
        console.log(`📊 Available tools: ${availableTools.length}`);
    } catch (error) {
        console.error("❌ Failed to initialize MCP client:", error);
        throw error;
    }
}

initializeMCPClient().catch(console.error);

app.use(cors());
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
    res.json({ message: "Binance Assistant API" });
});

type SendEvent = (event: string, data: unknown) => void;

function createSender(res: Response): SendEvent {
    return (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

type ToolCallAcc = { id: string; name: string; arguments: string };
type PendingToolCall = { id: string; name: string; args: Record<string, unknown> };
// Shape that comes back from get_klines MCP tool
interface RawCandle {
    openTime: number;
    open: string | number;
    high: string | number;
    low: string | number;
    close: string | number;
    volume: string | number;
    closeTime: number;
}

async function runAgenticLoop(messages: ChatCompletionMessageParam[], sendEvent: SendEvent): Promise<void> {
    let iterations = 0;

    while (iterations < MAX_TOOL_CALL_ITERATIONS) {
        iterations++;

        const stream = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages,
            tools: availableTools.length > 0 ? availableTools : undefined,
            tool_choice: availableTools.length > 0 ? "auto" : undefined,
            stream: true,
        });

        let fullContent = "";
        const toolCallAcc: Record<number, ToolCallAcc> = {};

        for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta;
            if (!delta) continue;

            if (delta.content) {
                fullContent += delta.content;
                sendEvent("delta", { token: delta.content });
            }

            // Tool calls arrive incrementally across chunks — accumulate them
            if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index;
                    if (!toolCallAcc[idx]) toolCallAcc[idx] = { id: "", name: "", arguments: "" };
                    if (tc.id) toolCallAcc[idx].id = tc.id;
                    if (tc.function?.name) toolCallAcc[idx].name += tc.function.name;
                    if (tc.function?.arguments) toolCallAcc[idx].arguments += tc.function.arguments;
                }
            }
        }

        const toolCallList = Object.values(toolCallAcc);

        if (toolCallList.length === 0) return;

        const pendingToolCalls: PendingToolCall[] = toolCallList.map((tc) => ({
            id: tc.id,
            name: tc.name,
            args: (() => {
                try {
                    return JSON.parse(tc.arguments);
                } catch {
                    return {};
                }
            })(),
        }));

        messages.push({
            role: "assistant",
            content: fullContent || null,
            tool_calls: toolCallList.map((tc) => ({
                id: tc.id,
                type: "function" as const,
                function: { name: tc.name, arguments: tc.arguments },
            })),
        });

        const sessionId = randomUUID();
        sendEvent("tool_call", { sessionId, toolCalls: pendingToolCalls });

        const approved = await new Promise<boolean>((resolve) => {
            pendingApprovals.set(sessionId, resolve);
        });

        if (!approved) {
            for (const tc of pendingToolCalls) {
                messages.push({ role: "tool", tool_call_id: tc.id, content: "Tool call denied by user." });
            }
        } else {
            for (const tc of pendingToolCalls) {
                console.log(` Calling tool: ${tc.name}`, tc.args);
                try {
                    const toolResult = await mcpClient!.callTool({ name: tc.name, arguments: tc.args });
                    const resultText = (toolResult.content as { type: string; text: string }[])
                        .filter((p) => p.type === "text")
                        .map((p) => p.text)
                        .join("\n");

                    //  Kline chart detection
                    if (tc.name === "analyze_price_action" && resultText) {
                        try {
                            const candles: RawCandle[] = JSON.parse(resultText)._chartCandles;
                            if (Array.isArray(candles) && candles.length > 0) {
                                // Normalise to numbers — Binance returns strings for prices
                                const chartCandles = candles.map((c) => ({
                                    time: Math.floor(c.openTime / 1000), // Lightweight Charts uses seconds
                                    open: Number(c.open),
                                    high: Number(c.high),
                                    low: Number(c.low),
                                    close: Number(c.close),
                                    volume: Number(c.volume),
                                }));

                                sendEvent("chart_data", {
                                    symbol: (tc.args.symbol as string) ?? "UNKNOWN",
                                    interval: (tc.args.interval as string) ?? "",
                                    candles: chartCandles,
                                });
                            }
                        } catch {
                            // Not valid JSON — skip chart emission, carry on
                        }
                    }

                    messages.push({
                        role: "tool",
                        tool_call_id: tc.id,
                        content: resultText || "No content.",
                    });
                } catch (toolError) {
                    const msg = toolError instanceof Error ? toolError.message : String(toolError);
                    messages.push({ role: "tool", tool_call_id: tc.id, content: `Error: ${msg}` });
                }
            }
        }
    }
}

app.post("/api/chat", async (req: Request, res: Response) => {
    const { messages } = req.body;

    if (!Array.isArray(messages)) {
        res.status(400).json({ error: "messages must be an array" });
        return;
    }

    if (!mcpClient) {
        res.status(503).json({ error: "MCP client not yet initialized." });
        return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const sendEvent = createSender(res);
    const fullMessages: ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
    ];

    try {
        await runAgenticLoop(fullMessages, sendEvent);
    } catch (err) {
        console.error("Chat error:", err);
        sendEvent("error", { message: "An error occurred." });
    } finally {
        sendEvent("done", {});
        res.end();
    }
});

app.post("/api/chat/approve", (req: Request, res: Response) => {
    const { sessionId, approved }: { sessionId: string; approved: boolean } = req.body;

    if (!sessionId || typeof approved !== "boolean") {
        res.status(400).json({ error: "sessionId and approved (boolean) are required" });
        return;
    }

    const resolve = pendingApprovals.get(sessionId);
    if (!resolve) {
        res.status(404).json({ error: "Session not found or already resolved" });
        return;
    }

    pendingApprovals.delete(sessionId);
    resolve(approved); // unblocks the awaiting SSE loop

    res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
