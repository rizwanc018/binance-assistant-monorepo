import { ref, computed } from "vue";

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface ChartCandle {
  time: number; // Unix seconds — Lightweight Charts format
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Discriminated union — each role has its own shape
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | {
      role: "tool_approval";
      sessionId: string;
      toolCalls: ToolCallInfo[];
      status: "pending" | "approved" | "denied";
    }
  | { role: "chart"; symbol: string; interval: string; candles: ChartCandle[] };

// const API_URL = "http://localhost:3000/api/chat";
const API_URL = `${import.meta.env.VITE_API_URL}/api/chat`

const isLoading = ref(false);
const messages = ref<Message[]>([]);

export function useChat() {
  // Show "Thinking..." when loading but no text is actively streaming yet:
  // - after user sends a message (waiting for first token)
  // - after approving a tool call (waiting for OpenAI's next response)
  const showThinking = computed(() => {
    if (!isLoading.value) return false;
    const last = messages.value[messages.value.length - 1];
    if (!last) return true;
    if (last.role === "user") return true;
    if (last.role === "chart") return true;
    if (last.role === "tool_approval" && last.status !== "pending") return true;
    return false;
  });

  // Reads the SSE stream from an open fetch response.
  // SSE events are separated by blank lines (\n\n).
  // Each event block has "event: <name>" and "data: <json>" lines.
  async function readSSEStream(res: globalThis.Response): Promise<void> {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    // Track the array index instead of a direct object reference.
    // Accessing messages.value[index] goes through Vue's reactive Proxy,
    // which triggers re-renders. A direct object reference bypasses the Proxy.
    let currentAssistantMsgIndex = -1;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Split on blank lines — each SSE event ends with \n\n
      const eventBlocks = buffer.split("\n\n");
      buffer = eventBlocks.pop() ?? ""; // keep the incomplete trailing block

      for (const block of eventBlocks) {
        if (!block.trim()) continue;

        let eventName = "";
        let eventData = "";

        for (const line of block.split("\n")) {
          if (line.startsWith("event: ")) eventName = line.slice(7).trim();
          else if (line.startsWith("data: ")) eventData = line.slice(6).trim();
        }

        if (!eventName || !eventData) continue;

        const data = JSON.parse(eventData);

        if (eventName === "delta") {
          if (currentAssistantMsgIndex === -1) {
            messages.value.push({ role: "assistant", content: "" });
            currentAssistantMsgIndex = messages.value.length - 1;
          }
          // Access through the reactive array — this triggers Vue's Proxy and re-renders
          (
            messages.value[currentAssistantMsgIndex] as Extract<Message, { role: "assistant" }>
          ).content += data.token;
        } else if (eventName === "tool_call") {
          // Reset so the final answer after tool execution gets its own bubble
          currentAssistantMsgIndex = -1;
          messages.value.push({
            role: "tool_approval",
            sessionId: data.sessionId,
            toolCalls: data.toolCalls,
            status: "pending",
          });
        } else if (eventName === "chart_data") {
          // Insert chart message — assistant text bubble (if any) comes after this
          currentAssistantMsgIndex = -1;
          messages.value.push({
            role: "chart",
            symbol: data.symbol,
            interval: data.interval,
            candles: data.candles,
          });
        } else if (eventName === "error") {
          messages.value.push({ role: "assistant", content: `Error: ${data.message}` });
          return;
        } else if (eventName === "done") {
          return;
        }
      }
    }
  }

  const sendMessage = async (content: string) => {
    messages.value.push({ role: "user", content });
    isLoading.value = true;

    try {
      // Only send user/assistant messages — tool_approval is UI-only
      const chatMessages = messages.value
        .filter(
          (m): m is Extract<Message, { role: "user" | "assistant" }> =>
            m.role === "user" || m.role === "assistant",
        )
        .filter((m) => m.content)
        .map(({ role, content }) => ({ role, content }));

      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: chatMessages }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      await readSSEStream(res);
    } catch (err) {
      messages.value.push({
        role: "assistant",
        content: "Sorry, something went wrong. Please try again.",
      });
      console.error("Chat error:", err);
    } finally {
      isLoading.value = false;
    }
  };

  const approveToolCall = async (sessionId: string, approved: boolean) => {
    // Update the approval card status immediately
    const approvalMsg = messages.value
      .filter((m): m is Extract<Message, { role: "tool_approval" }> => m.role === "tool_approval")
      .find((m) => m.sessionId === sessionId);

    if (approvalMsg) approvalMsg.status = approved ? "approved" : "denied";

    // Just fire the approval — the SSE stream (still open) handles the rest
    await fetch(`${API_URL}/approve`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, approved }),
    }).catch(console.error);
  };

  const clearChat = () => {
    messages.value = [];
  };

  return { isLoading, showThinking, sendMessage, approveToolCall, messages, clearChat };
}
