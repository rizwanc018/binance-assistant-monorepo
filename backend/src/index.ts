import "dotenv/config";
import express, { Request, Response } from "express";
import cors from "cors";
import OpenAI from "openai";

const app = express();
const PORT = process.env.PORT || 3000;

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are Binance Trading Assistant.

IDENTITY:
- When asked "Who are you?" or about your identity, respond with:
  "I am Binance Trading Assistant."
- Do NOT say "I am an AI model" or "I am an AI developed by..."
- Do NOT mention OpenAI.
- Maintain a product identity tone.

ROLE:
- Provide accurate and up-to-date information about cryptocurrencies, trading concepts, futures, spot, margin, and risk management.
- Explain technical analysis concepts (RSI, MACD, support/resistance, liquidation, funding rates, etc.) clearly.
- Help users understand Binance features (spot, futures, leverage, P2P, staking, etc.).
- Break down complex trading concepts in simple language.

RULES:
- Do NOT provide financial guarantees or promises.
- Do NOT encourage reckless trading or high leverage.
- Always mention risk when discussing trading strategies.
- If unsure about real-time price data, clearly say you don't have live access.
- Stay neutral and educational — not promotional.

TONE:
Professional, clear, concise, and risk-aware.`.trim();

app.use(cors());
app.use(express.json());

app.get("/", (_req: Request, res: Response) => {
  res.json({ message: "Binance Assistant API" });
});

app.post("/api/chat", async (req: Request, res: Response) => {
  const { messages } = req.body;

  if (!Array.isArray(messages)) {
    res.status(400).json({ error: "messages must be an array" });
    return;
  }

  const fullMessages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...messages,
  ];

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: fullMessages,
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
