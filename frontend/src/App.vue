<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import Header from "./components/Header.vue";
import SendIcon from "./components/icons/SendIcon.vue";
import { useChat } from "./composables/useChat";

const { messages, isLoading, sendMessage: sendToAI } = useChat();


const textArearef = ref<HTMLTextAreaElement | null>(null);
const messagesContainer = ref<HTMLDivElement | null>(null);
const input = ref("");

const scrollToBottom = async () => {
    await nextTick();
    if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
};

watch(messages, () => scrollToBottom(), { deep: true });

const sendMessage = async () => {
    if (!input.value.trim() || isLoading.value) return;
    const message = input.value;
    input.value = "";
    resizeTextArea();
    await sendToAI(message);
};

const MAX_HEIGHT = 200
const resizeTextArea = () => {
    if (!textArearef.value) return;
    textArearef.value.style.height = "48px"
    const newHeight = Math.min(textArearef.value.scrollHeight, MAX_HEIGHT)

    textArearef.value.style.height = newHeight + "px"
    textArearef.value.style.overflowY = textArearef.value.scrollHeight > MAX_HEIGHT ? "auto" : "hidden"
}

const handleKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        sendMessage()
    }
}
</script>

<template>
    <div class="h-screen flex flex-col">
        <Header />
        <main class="flex-1 flex justify-center overflow-hidden">
            <div ref="messagesContainer" class="flex flex-col w-175 mx-auto overflow-y-auto p-4 space-y-4">
                <template v-for="(msg, i) in messages" :key="i">
                    <div v-if="msg.content || (msg.role === 'assistant' && isLoading)"
                        :class="msg.role === 'user' ? 'self-end  bg-muted/10 text-primary-foreground' : 'self-start bg-primary text-primary-foreground'"
                        class="max-w-[80%] rounded-lg px-4 py-2 whitespace-pre-wrap wrap-break-word">
                        {{ msg.content || "Thinking..." }}
                    </div>
                </template>
            </div>
        </main>

        <div class="border-t border-border bg-muted p-4 flex justify-center">
            <div class=" w-175 mx-auto">
                <div class="flex gap-3">
                    <textarea ref="textArearef" v-model="input" @input="resizeTextArea" @keydown="handleKeydown"
                        placeholder="Ask about trading, markets, portfolio..."
                        class="flex-1 bg-input border border-border rounded-lg px-3 py-2 text-foreground placeholder:text-muted-foreground outline-none focus:border-primary resize-none h-12" />
                    <button @click="sendMessage" :disabled="isLoading"
                        class="bg-primary hover:bg-binance-yellow-hover text-primary-foreground w-12 h-12 rounded-lg flex items-center justify-center self-end shrink-0 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed">
                        <SendIcon class="w-5 h-5" />
                    </button>
                </div>
                <p class="text-xs text-muted-foreground mt-2 text-center">
                    Binance Assistant can make mistakes. Verify important
                    information.
                </p>
            </div>
        </div>
    </div>
</template>

<style scoped>
textarea::-webkit-scrollbar {
    width: 6px;
}

textarea::-webkit-scrollbar-track {
    background: transparent;
}

textarea::-webkit-scrollbar-thumb {
    background: #5e5d5d;
    border-radius: 3px;
}

textarea::-webkit-scrollbar-thumb:hover {
    background: var(--muted-foreground);
}
</style>
