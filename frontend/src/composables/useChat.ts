import { ref } from "vue";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

const API_URL = "http://localhost:3000/api/chat";

export function useChat() {
  const isLoading = ref(false);
  const messages = ref<Message[]>([]);

  const sendMessage = async (content: string) => {
    messages.value.push({ role: "user", content });
    isLoading.value = true;

    messages.value.push({ role: "assistant", content: "" });
    const assistantMessage = messages.value[messages.value.length - 1];

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.value
            .filter((m) => m.role === "user" || (m.role === "assistant" && m.content))
            .slice(0, -1), // exclude the empty assistant placeholder
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const data = line.slice(6);
          if (data === "[DONE]") break;

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              assistantMessage.content += parsed.content;
            }
          } catch {
            // skip malformed chunks
          }
        }
      }

      if (!assistantMessage.content) {
        assistantMessage.content = "Sorry, something went wrong. Please try again.";
      }
    } catch (err) {
      console.error("Chat API error:", err);
      assistantMessage.content = "Sorry, something went wrong. Please try again.";
    } finally {
      isLoading.value = false;
    }
  };

  const clearChat = () => {
    messages.value = [];
  };

  return { isLoading, sendMessage, messages, clearChat };
}
