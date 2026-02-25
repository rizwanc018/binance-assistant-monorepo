<script setup lang="ts">
import BinanceLogo from "./icons/BinanceLogo.vue";
</script>

<template>
    <header class="flex items-center justify-between px-6 py-4 border-b border-border bg-muted w-full">
        <div class="flex items-center gap-3">
            <div class="flex items-center justify-center w-10 h-10 rounded-lg bg-primary">
                <BinanceLogo class="w-6 h-6 text-primary-foreground" />
            </div>
            <div>
                <h1 class="text-lg font-semibold text-foreground">
                    Binance Assistant
                </h1>
                <p class="text-xs text-muted-foreground">
                    AI-Powered Trading Helper
                </p>
            </div>
        </div>
        <div class="flex items-center gap-2">
            <span class="flex items-center gap-1.5 text-xs text-binance-green">
                <span class="w-2 h-2 rounded-full bg-binance-green animate-pulse" />
                Online
            </span>
        </div>
    </header>

</template>