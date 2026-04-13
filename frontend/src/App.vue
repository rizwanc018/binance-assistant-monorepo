<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import Header from "./components/Header.vue";
import { useChat } from "./composables/useChat";
import type { Message } from "./composables/useChat";
import Input from "./components/Input.vue";
import Candlestickchart from "./components/Candlestickchart.vue";

const { messages, showThinking, approveToolCall } = useChat();
const messagesContainer = ref<HTMLDivElement | null>(null);

const scrollToBottom = async () => {
    await nextTick();
    if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
};

watch(messages, () => scrollToBottom(), { deep: true });

// Type guard — narrows Message to the tool_approval variant in the template
type ToolApprovalMessage = Extract<Message, { role: "tool_approval" }>;
type ChartMessage = Extract<Message, { role: "chart" }>;

// const isToolApproval = (msg: Message): msg is ToolApprovalMessage => msg.role === "tool_approval";
const isToolApproval = (msg: Message): msg is ToolApprovalMessage => {
    return msg.role === "tool_approval";
}
const isChart = (msg: Message): msg is ChartMessage => msg.role === "chart";

</script>

<template>
    <div class="h-screen flex flex-col">
        <Header />
        <main class="flex-1 flex justify-center overflow-hidden">
            <div ref="messagesContainer" class="flex flex-col w-175 mx-auto overflow-y-auto p-4 gap-y-4">
                <template v-for="(msg, i) in messages" :key="i">

                    <!-- Candlestick chart -->
                    <div v-if="isChart(msg)" class="self-stretch">
                        <Candlestickchart :symbol="msg.symbol" :interval="msg.interval" :candles="msg.candles" />
                        <!-- <p>Chart for {{ msg.symbol }} {{ msg.interval }} {{ JSON.stringify(msg.candles) }}</p> -->
                    </div>

                    <!-- Tool approval card -->
                    <div v-else-if="isToolApproval(msg)"
                        class="self-start max-w-[80%] border border-border bg-muted rounded-lg p-4">
                        <p class="text-sm font-semibold text-foreground mb-3">Tool Call Request</p>

                        <div v-for="tool in msg.toolCalls" :key="tool.id" class="mb-3">
                            <p class="text-sm font-mono text-primary font-medium pt-1"><span class="text-white">Tool :
                                </span>{{ tool.name }}</p>
                            <pre
                                class="text-xs text-muted-foreground mt-1 bg-background rounded p-2 overflow-x-auto">{{ JSON.stringify(tool.args, null, 2) }}</pre>
                        </div>

                        <!-- Pending: show Approve / Deny buttons -->
                        <div v-if="msg.status === 'pending'" class="flex gap-2 mt-3">
                            <button @click="approveToolCall(msg.sessionId, true)" :disabled="msg.status !== 'pending'"
                                class="px-3 py-1 text-sm bg-primary text-primary-foreground rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
                                Approve
                            </button>
                            <button @click="approveToolCall(msg.sessionId, false)" :disabled="msg.status !== 'pending'"
                                class="px-3 py-1 text-sm border border-border text-foreground rounded hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer">
                                Deny
                            </button>
                        </div>

                        <!-- Resolved: show outcome -->
                        <p v-else class="text-xs text-muted-foreground mt-2">
                            {{ msg.status === "approved" ? "✅ Approved" : "❌ Denied" }}
                        </p>
                    </div>

                    <!-- Regular user / assistant messages -->
                    <div v-else-if="msg.role === 'user' || msg.role === 'assistant'" v-show="msg.content"
                        :class="msg.role === 'user' ? 'self-end bg-muted/10 text-primary-foreground' : 'self-start bg-primary text-primary-foreground'"
                        class="max-w-[80%] rounded-lg px-4 py-2 whitespace-pre-wrap wrap-break-word">
                        {{ msg.content }}
                    </div>

                </template>

                <!-- Shown while waiting for the first token or waiting after tool approval -->
                <div v-if="showThinking"
                    class="self-start bg-primary text-primary-foreground max-w-[80%] rounded-lg px-4 py-2 animate-pulse">
                    Thinking...
                </div>
            </div>
        </main>
        <Input />
    </div>
</template>
