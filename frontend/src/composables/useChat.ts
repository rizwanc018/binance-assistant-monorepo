import { ref } from "vue";

export interface ToolCallInfo {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

// Discriminated union — each role has its own shape
export type Message =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string }
  | { role: "tool_approval"; sessionId: string; toolCalls: ToolCallInfo[]; status: "pending" | "approved" | "denied" };

const API_URL = "http://localhost:3000/api/chat";

const isLoading = ref(false);
const messages = ref<Message[]>([]);

export function useChat() {

  // Called after every API response — handles both "text" and "tool_calls" shapes
  function handleResponse(data: { type: string; content?: string; sessionId?: string; toolCalls?: ToolCallInfo[] }) {
    if (data.type === "text") {
      messages.value.push({ role: "assistant", content: data.content ?? "" });
    } else if (data.type === "tool_calls" && data.sessionId && data.toolCalls) {
      messages.value.push({
        role: "tool_approval",
        sessionId: data.sessionId,
        toolCalls: data.toolCalls,
        status: "pending",
      });
    }
  }

  const sendMessage = async (content: string) => {
    messages.value.push({ role: "user", content });
    isLoading.value = true;

    try {
      // Only send user/assistant messages to the backend (filter out tool_approval)
      const chatMessages = messages.value
        .filter((m): m is { role: "user" | "assistant"; content: string } =>
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

      handleResponse(await res.json());
    } catch (err) {
      messages.value.push({ role: "assistant", content: "Sorry, something went wrong. Please try again." });
      console.error("Chat error:", err);
    } finally {
      isLoading.value = false;
    }
  };

  const approveToolCall = async (sessionId: string, approved: boolean) => {
    // Find the pending approval message and mark it resolved
    const approvalMsg = messages.value
      .filter((m): m is Extract<Message, { role: "tool_approval" }> => m.role === "tool_approval")
      .find((m) => m.sessionId === sessionId);

    if (approvalMsg) approvalMsg.status = approved ? "approved" : "denied";

    isLoading.value = true;
    try {
      const res = await fetch(`${API_URL}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, approved }),
      });

      if (!res.ok) throw new Error(`API error: ${res.status}`);

      handleResponse(await res.json());
    } catch (err) {
      messages.value.push({ role: "assistant", content: "Sorry, something went wrong. Please try again." });
      console.error("Approve error:", err);
    } finally {
      isLoading.value = false;
    }
  };

  const clearChat = () => { messages.value = []; };

  return { isLoading, sendMessage, approveToolCall, messages, clearChat };
}
