import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/index";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
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

async function initializeMCPClient() {
    try {
        const serverPath = path.join(__dirname, "../dist/mcp-server.js");
        const transport = new StdioClientTransport({
            command: "node",
            args: [serverPath],
        });

        mcpClient = new Client(
            {
                name: "binance-web-client",
                version: "1.0.0",
            },
            {
                capabilities: {},
            },
        );

        await mcpClient.connect(transport);

        // Get available tools
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
    res.json({ message: "Binance Assistant API " });
});

app.post("/api/chat", async (req: Request, res: Response) => {
    const { messages } = req.body;

    if (!Array.isArray(messages)) {
        res.status(400).json({ error: "messages must be an array" });
        return;
    }

    if (!mcpClient) {
        res.status(503).json({ error: "MCP client is not yet initialized. Try again shortly." });
        return;
    }

    const fullMessages: ChatCompletionMessageParam[] = [
        { role: "system" as const, content: SYSTEM_PROMPT },
        ...messages,
    ];
    try {
        let iterations = 0;

        while (iterations < MAX_TOOL_CALL_ITERATIONS) {
            iterations++;

            const response = await openai.chat.completions.create({
                model: "gpt-5-mini",
                messages: fullMessages,
                tools: availableTools.length > 0 ? availableTools : undefined,
                tool_choice: availableTools.length > 0 ? "auto" : undefined,
            });

            const assistantMessage = response.choices[0]?.message;

            if (!assistantMessage) {
                res.json({ content: "No response from AI." });
                return;
            }

            if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
                const content = assistantMessage.content;
                res.json({ content: content || "" });
                return;
            }

            fullMessages.push({
                role: "assistant" as const,
                content: assistantMessage.content,
                tool_calls: assistantMessage.tool_calls,
            });

            for (const toolCall of assistantMessage.tool_calls) {
                if (toolCall.type !== "function") {
                    fullMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: "Unsupported tool call type.",
                    });
                    continue;
                }

                const functionName = toolCall.function.name;
                let functionArgs: Record<string, unknown>;

                try {
                    functionArgs = JSON.parse(toolCall.function.arguments);
                } catch (error) {
                    fullMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: "Failed to parse tool arguments.",
                    });
                    continue;
                }


                try {
                    const toolResult = await mcpClient.callTool({
                        name: functionName,
                        arguments: functionArgs,
                    });

                    const resultText = (toolResult.content as { type: string; text: string }[])
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join("");

                    fullMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: resultText || "Tool returned no content.",
                    });

                } catch (toolError) {
                    console.error(`Tool execution error (${functionName}):`, toolError);
                    const errorMsg = toolError instanceof Error ? toolError.message : String(toolError);
                    fullMessages.push({
                        role: "tool",
                        tool_call_id: toolCall.id,
                        content: `Error executing tool "${functionName}": ${errorMsg}`,
                    });
                }
            }
            // while loop continues — calls OpenAI again with tool results
        }

        // Exhausted max iterations — force a final text-only response
        const finalResponse = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: fullMessages,
        });

        res.json({
            content:
                finalResponse.choices[0]?.message?.content ||
                "I was unable to complete the request within the allowed number of steps.",
        });
    } catch (err) {
        console.error("OpenAI API error:", err);
        res.status(500).json({ error: "Failed to get response from AI" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
