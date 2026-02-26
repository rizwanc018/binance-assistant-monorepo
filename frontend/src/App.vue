<script setup lang="ts">
import { ref, nextTick, watch } from "vue";
import Header from "./components/Header.vue";
import { useChat } from "./composables/useChat";
import Input from "./components/Input.vue";

const { messages, isLoading } = useChat();
const messagesContainer = ref<HTMLDivElement | null>(null);

const scrollToBottom = async () => {
    await nextTick();
    if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight;
    }
};

watch(messages, () => scrollToBottom(), { deep: true });

</script>

<template>
    <div class="h-screen flex flex-col">
        <Header />
        <main class="flex-1 flex justify-center overflow-hidden">
            <div ref="messagesContainer" class="flex flex-col w-175 mx-auto overflow-y-auto p-4 gap-y-4">
                <template v-for="(msg, i) in messages" :key="i">
                    <div v-if="msg.content || (msg.role === 'assistant' && isLoading)"
                        :class="msg.role === 'user' ? 'self-end  bg-muted/10 text-primary-foreground' : 'self-start bg-primary text-primary-foreground'"
                        class="max-w-[80%] rounded-lg px-4 py-2 whitespace-pre-wrap wrap-break-word ">
                        {{ msg.content || "Thinking..." }}
                    </div>
                </template>
            </div>
        </main>
        <Input />
    </div>
</template>