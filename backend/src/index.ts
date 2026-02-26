import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import OpenAI from "openai";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";

const app = express();
const PORT = process.env.PORT || 3000;

let mcpClient = null;
let availableTools: any[] = [];

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

    const fullMessages = [{ role: "system" as const, content: SYSTEM_PROMPT }, ...messages];
    try {
        const response = await openai.chat.completions.create({
            model: "gpt-5-mini",
            messages: fullMessages,
            tools: availableTools,
            tool_choice: "auto",
        });

        const content = response.choices[0]?.message?.content;
        res.json({ content: content || "" });
    } catch (err) {
        console.error("OpenAI API error:", err);
        res.status(500).json({ error: "Failed to get response from AI" });
    }
});

app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
