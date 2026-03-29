https://github.com/user-attachments/assets/91d57677-8cbf-4410-b689-b167d80948b0

# Binance Assistant

A full-stack cryptocurrency assistant that integrates with Binance market data using an agentic chat interface. Built with Vue 3 + Express.js, powered by OpenAI and the Model Context Protocol (MCP).

## Tech Stack

- **Frontend:** Vue 3, TypeScript, Vite, Tailwind CSS v4
- **Backend:** Express.js 5, TypeScript, OpenAI SDK, MCP SDK
- **Package Manager:** pnpm (workspace monorepo)

## Prerequisites

- Node.js `^20.19.0 || >=22.12.0`
- pnpm `>=9`

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure environment variables

Create a `.env` file in the `backend/` directory:

```env
OPENAI_API_KEY=your-openai-api-key
PORT=3000  # optional, defaults to 3000
```

### 3. Run in development

```bash
# Start both frontend and backend concurrently
pnpm dev
```

Or run them individually:

```bash
pnpm dev:frontend   # Vite dev server → http://localhost:5173
pnpm dev:backend    # Express server  → http://localhost:3000
```

### 4. Build for production

```bash
# Build frontend
pnpm build

# Build backend
cd backend && npm run build

# Start production server
cd backend && npm start
```

## Project Structure

```
binance-assistant-monorepo/
├── frontend/
│   └── src/
│       ├── App.vue                # Main chat UI
│       ├── components/            # Header, Input, icons
│       └── composables/useChat.ts # Chat logic & SSE streaming
├── backend/
│   └── src/
│       ├── index.ts               # Express API server
│       └── mcp-server.ts          # MCP server (Binance tools)
├── package.json                   # Workspace scripts
└── pnpm-workspace.yaml
```

## How It Works

1. User sends a message through the Vue chat interface
2. Frontend streams Server-Sent Events (SSE) from the backend `/api/chat` endpoint
3. Backend forwards the message to OpenAI with available MCP tools (Binance API)
4. When the LLM wants to call a tool, the user is prompted to approve/deny the call
5. Approved tool results are fed back to the LLM, which continues generating a response
