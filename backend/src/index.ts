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

Be conversational and helpful!`;

// --- Session types ---
// When OpenAI requests tool calls, we pause execution and store the
// conversation state here. The frontend shows the pending tool calls
// to the user, who can approve or deny before execution continues.

type PendingToolCall = {
    id: string;
    name: string;
    args: Record<string, unknown>;
};

type PendingSession = {
    messages: ChatCompletionMessageParam[];
    toolCalls: PendingToolCall[];
};

type AgenticResult =
    | { type: "text"; content: string }
    | { type: "tool_calls"; sessionId: string; toolCalls: PendingToolCall[] };

// In-memory store: sessionId → pending conversation state
const sessions = new Map<string, PendingSession>();

// --- MCP initialization ---

async function initializeMCPClient() {
    try {
        const serverPath = path.join(__dirname, "../dist/mcp-server.js");
        const transport = new StdioClientTransport({
            command: "node",
            args: [serverPath],
        });

        mcpClient = new Client(
            { name: "binance-web-client", version: "1.0.0" },
            { capabilities: {} },
        );

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

// --- Middleware ---

app.use(cors());
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
    res.json({ message: "Binance Assistant API" });
});

// --- Agentic loop ---
// Calls OpenAI and checks the response:
//   - If text → return it as the final answer
//   - If tool_calls → pause, store state, return tool call info for user approval

async function runAgenticLoop(messages: ChatCompletionMessageParam[]): Promise<AgenticResult> {
    let iterations = 0;

    while (iterations < MAX_TOOL_CALL_ITERATIONS) {
        iterations++;

        const response = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages,
            tools: availableTools.length > 0 ? availableTools : undefined,
            tool_choice: availableTools.length > 0 ? "auto" : undefined,
        });

        const assistantMessage = response.choices[0]?.message;
        if (!assistantMessage) return { type: "text", content: "No response from AI." };

        // No tool calls — this is the final text answer
        if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
            return { type: "text", content: assistantMessage.content || "" };
        }

        // Collect the tool calls into a simpler shape for the frontend
        const pendingToolCalls: PendingToolCall[] = [];
        for (const toolCall of assistantMessage.tool_calls) {
            if (toolCall.type !== "function") continue;
            let args: Record<string, unknown>;
            try {
                args = JSON.parse(toolCall.function.arguments);
            } catch {
                args = {};
            }
            pendingToolCalls.push({ id: toolCall.id, name: toolCall.function.name, args });
        }

        // Push the assistant message (OpenAI requires this to correlate tool results)
        messages.push({
            role: "assistant",
            content: assistantMessage.content,
            tool_calls: assistantMessage.tool_calls,
        });

        // Save the current conversation state and return to the frontend for approval
        const sessionId = randomUUID();
        sessions.set(sessionId, { messages: [...messages], toolCalls: pendingToolCalls });

        return { type: "tool_calls", sessionId, toolCalls: pendingToolCalls };
    }

    // Exhausted max iterations — force a plain text response
    const finalResponse = await openai.chat.completions.create({
        model: "gpt-5-mini",
        messages,
    });

    return {
        type: "text",
        content: finalResponse.choices[0]?.message?.content || "I was unable to complete the request.",
    };
}

// --- Routes ---

// Step 1: User sends a message.
// If the AI wants to call a tool, we pause and return the tool call details
// to the frontend instead of executing automatically.
app.post("/api/chat", async (req: Request, res: Response) => {
    const { messages } = req.body;

    if (!Array.isArray(messages)) {
        res.status(400).json({ error: "messages must be an array" });
        return;
    }

    if (!mcpClient) {
        res.status(503).json({ error: "MCP client not yet initialized. Try again shortly." });
        return;
    }

    const fullMessages: ChatCompletionMessageParam[] = [
        { role: "system", content: SYSTEM_PROMPT },
        ...messages,
    ];

    try {
        const result = await runAgenticLoop(fullMessages);
        res.json(result);
    } catch (err) {
        console.error("Chat error:", err);
        res.status(500).json({ error: "Failed to get response from AI" });
    }
});

// Step 2: User approves or denies the pending tool calls.
// If approved → execute tools via MCP and continue the loop.
// If denied → tell the model and let it respond without tool data.
app.post("/api/chat/approve", async (req: Request, res: Response) => {
    const { sessionId, approved }: { sessionId: string; approved: boolean } = req.body;

    if (!sessionId || typeof approved !== "boolean") {
        res.status(400).json({ error: "sessionId and approved (boolean) are required" });
        return;
    }

    const session = sessions.get(sessionId);
    if (!session) {
        res.status(404).json({ error: "Session not found or already used" });
        return;
    }

    // Consume the session — each sessionId is single-use
    sessions.delete(sessionId);

    if (!mcpClient) {
        res.status(503).json({ error: "MCP client not yet initialized." });
        return;
    }

    const { messages, toolCalls } = session;

    if (!approved) {
        // User denied — inform the model so it can respond without the data
        for (const toolCall of toolCalls) {
            messages.push({
                role: "tool",
                tool_call_id: toolCall.id,
                content: "Tool call was denied by the user.",
            });
        }
    } else {
        // User approved — execute each tool via MCP and collect results
        for (const toolCall of toolCalls) {
            console.log(`🔧 Calling tool: ${toolCall.name}`, toolCall.args);
            try {
                const toolResult = await mcpClient.callTool({
                    name: toolCall.name,
                    arguments: toolCall.args,
                });

                const resultText = (toolResult.content as { type: string; text: string }[])
                    .filter((part) => part.type === "text")
                    .map((part) => part.text)
                    .join("\n");

                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: resultText || "Tool returned no content.",
                });
            } catch (toolError) {
                const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
                messages.push({
                    role: "tool",
                    tool_call_id: toolCall.id,
                    content: `Error: ${errorMsg}`,
                });
            }
        }
    }

    try {
        // Continue the loop — may return text or another round of tool_calls
        const result = await runAgenticLoop(messages);
        res.json(result);
    } catch (err) {
        console.error("Approve error:", err);
        res.status(500).json({ error: "Failed to continue after approval" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
