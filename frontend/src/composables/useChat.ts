import { ref, watch } from "vue";

export interface Message {
  role: "user" | "assistant";
  content: string;
}

const API_URL = "http://localhost:3000/api/chat";

const isLoading = ref(false);
const messages = ref<Message[]>([]);

export function useChat() {

  const sendMessage = async (content: string) => {
    messages.value.push({ role: "user", content });
    const assistantMsg: Message = { role: "assistant", content: "" };
    messages.value.push(assistantMsg);
    isLoading.value = true;

    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: messages.value
            .filter((m) => m.content)
            .map(({ role, content }) => ({ role, content })),
        }),
      });

      if (!res.ok) {
        throw new Error(`API error: ${res.status}`);
      }

      const data = await res.json();
      assistantMsg.content = data.content;
    } catch (err) {
      assistantMsg.content = "Sorry, something went wrong. Please try again.";
      console.error("Chat error:", err);
    } finally {
      isLoading.value = false;
    }
  };

  const clearChat = () => {
    messages.value = [];
  };

  return { isLoading, sendMessage, messages, clearChat };
}
