<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from "vue";
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  ColorType,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type HistogramData,
  type Time,
} from "lightweight-charts";
import type { ChartCandle } from "../composables/useChat";

const props = defineProps<{
  symbol: string;
  interval: string;
  candles: ChartCandle[];
}>();

const chartContainer = ref<HTMLDivElement | null>(null);
const volumeContainer = ref<HTMLDivElement | null>(null);

let chart: IChartApi | null = null;
let candleSeries: ISeriesApi<"Candlestick"> | null = null;
let volumeChart: IChartApi | null = null;
let volumeSeries: ISeriesApi<"Histogram"> | null = null;

// Derive if the latest candle is bullish (close >= open)
const lastCandle = props.candles.at(-1);
const isUp = lastCandle ? lastCandle.close >= lastCandle.open : true;

const COLORS = {
  bg: "#0d0f14",
  grid: "#1a1d26",
  border: "#1e2130",
  text: "#8892a4",
  up: "#00c896",
  down: "#ff4d6a",
  upAlpha: "rgba(0,200,150,0.15)",
  downAlpha: "rgba(255,77,106,0.15)",
  crosshair: "#3d4460",
};

function buildChart() {
  if (!chartContainer.value || !volumeContainer.value) return;

  // ── Main candlestick chart ──────────────────────────────────────────────
  chart = createChart(chartContainer.value, {
    layout: {
      background: { type: ColorType.Solid, color: COLORS.bg },
      textColor: COLORS.text,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: COLORS.grid },
      horzLines: { color: COLORS.grid },
    },
    crosshair: {
      vertLine: { color: COLORS.crosshair, labelBackgroundColor: "#252a3d" },
      horzLine: { color: COLORS.crosshair, labelBackgroundColor: "#252a3d" },
    },
    rightPriceScale: {
      borderColor: COLORS.border,
      scaleMargins: { top: 0.1, bottom: 0.1 },
    },
    timeScale: {
      borderColor: COLORS.border,
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: true,
    handleScale: true,
  });

  candleSeries = chart.addSeries(CandlestickSeries, {
    upColor: COLORS.up,
    downColor: COLORS.down,
    borderUpColor: COLORS.up,
    borderDownColor: COLORS.down,
    wickUpColor: COLORS.up,
    wickDownColor: COLORS.down,
  });

  const candleData: CandlestickData[] = props.candles.map((c) => ({
    time: c.time as Time,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
  }));

  candleSeries.setData(candleData);
  chart.timeScale().fitContent();

  // ── Volume chart ────────────────────────────────────────────────────────
  volumeChart = createChart(volumeContainer.value, {
    layout: {
      background: { type: ColorType.Solid, color: COLORS.bg },
      textColor: COLORS.text,
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: 11,
    },
    grid: {
      vertLines: { color: COLORS.grid },
      horzLines: { color: "transparent" },
    },
    crosshair: {
      vertLine: { color: COLORS.crosshair, labelBackgroundColor: "#252a3d" },
      horzLine: { visible: false, labelVisible: false },
    },
    rightPriceScale: {
      borderColor: COLORS.border,
      scaleMargins: { top: 0.1, bottom: 0 },
    },
    timeScale: {
      borderColor: COLORS.border,
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: true,
    handleScale: true,
  });

  volumeSeries = volumeChart.addSeries(HistogramSeries, {
    priceFormat: { type: "volume" },
    priceScaleId: "right",
  });

  const volumeData: HistogramData[] = props.candles.map((c) => ({
    time: c.time as Time,
    value: c.volume,
    color: c.close >= c.open ? COLORS.upAlpha : COLORS.downAlpha,
  }));

  volumeSeries.setData(volumeData);
  volumeChart.timeScale().fitContent();

  // Sync crosshair & scroll between both charts
  chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range) volumeChart?.timeScale().setVisibleLogicalRange(range);
  });
  volumeChart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
    if (range) chart?.timeScale().setVisibleLogicalRange(range);
  });

  // Resize observer
  const ro = new ResizeObserver(() => {
    if (chartContainer.value) chart?.applyOptions({ width: chartContainer.value.clientWidth });
    if (volumeContainer.value) volumeChart?.applyOptions({ width: volumeContainer.value.clientWidth });
  });
  if (chartContainer.value) ro.observe(chartContainer.value);
  if (volumeContainer.value) ro.observe(volumeContainer.value);
}

onMounted(() => buildChart());
onUnmounted(() => {
  chart?.remove();
  volumeChart?.remove();
});

watch(() => props.candles, () => {
  chart?.remove();
  volumeChart?.remove();
  buildChart();
});

// Stat helpers
const first = props.candles[0];
const last2 = props.candles.at(-1)!;
const priceChange = last2 && first ? ((last2.close - first.open) / first.open) * 100 : 0;
const periodHigh = Math.max(...props.candles.map((c) => c.high));
const periodLow = Math.min(...props.candles.map((c) => c.low));
const totalVolume = props.candles.reduce((acc, c) => acc + c.volume, 0);

function fmt(n: number, decimals = 2) {
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtVol(n: number) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(2) + "K";
  return n.toFixed(2);
}
</script>

<template>
  <div class="chart-wrapper">
    <!-- Header bar -->
    <div class="chart-header">
      <div class="chart-title">
        <span class="symbol">{{ symbol }}</span>
        <span class="interval-badge">{{ interval }}</span>
        <span :class="['price-change', priceChange >= 0 ? 'up' : 'down']">
          {{ priceChange >= 0 ? "▲" : "▼" }} {{ Math.abs(priceChange).toFixed(2) }}%
        </span>
      </div>
      <div class="chart-stats">
        <div class="stat">
          <span class="stat-label">H</span>
          <span class="stat-value up">{{ fmt(periodHigh) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">L</span>
          <span class="stat-value down">{{ fmt(periodLow) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">VOL</span>
          <span class="stat-value">{{ fmtVol(totalVolume) }}</span>
        </div>
        <div class="stat">
          <span class="stat-label">CLOSE</span>
          <span :class="['stat-value', isUp ? 'up' : 'down']">{{ fmt(last2.close) }}</span>
        </div>
      </div>
    </div>

    <!-- Candlestick -->
    <div ref="chartContainer" class="chart-canvas" style="height: 280px;" />

    <!-- Volume -->
    <div class="volume-label">VOL</div>
    <div ref="volumeContainer" class="chart-canvas" style="height: 80px;" />
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');

.chart-wrapper {
  font-family: 'IBM Plex Mono', monospace;
  background: #0d0f14;
  border: 1px solid #1e2130;
  border-radius: 10px;
  overflow: hidden;
  width: 100%;
  margin: 4px 0;
}

.chart-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px 8px;
  border-bottom: 1px solid #1a1d26;
  flex-wrap: wrap;
  gap: 8px;
}

.chart-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.symbol {
  font-size: 13px;
  font-weight: 600;
  color: #e0e6f0;
  letter-spacing: 0.05em;
}

.interval-badge {
  font-size: 10px;
  background: #1a1d26;
  color: #8892a4;
  border: 1px solid #252a3d;
  border-radius: 4px;
  padding: 1px 6px;
  letter-spacing: 0.08em;
}

.price-change {
  font-size: 12px;
  font-weight: 600;
}

.price-change.up {
  color: #00c896;
}

.price-change.down {
  color: #ff4d6a;
}

.chart-stats {
  display: flex;
  gap: 16px;
  align-items: center;
}

.stat {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 1px;
}

.stat-label {
  font-size: 9px;
  color: #4a5168;
  letter-spacing: 0.1em;
}

.stat-value {
  font-size: 11px;
  color: #8892a4;
}

.stat-value.up {
  color: #00c896;
}

.stat-value.down {
  color: #ff4d6a;
}

.chart-canvas {
  width: 100%;
}

.volume-label {
  font-size: 9px;
  color: #4a5168;
  letter-spacing: 0.12em;
  padding: 4px 14px 0;
}
</style>