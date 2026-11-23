<script setup lang="ts">
import { useRouteStore } from '@/stores/routeStore'
import { HOLD_COLORS, type HoldColor } from '@/types'

const store = useRouteStore()

const COLOR_HEX: Record<HoldColor, string> = {
  red: '#e84035',
  blue: '#3b82f6',
  green: '#2ecc71',
  yellow: '#f8e71c',
  orange: '#f5a623',
  purple: '#b06bff',
  white: '#eef2f7',
  black: '#23272f',
}

const COLOR_LABEL: Record<HoldColor, string> = {
  red: '红',
  blue: '蓝',
  green: '绿',
  yellow: '黄',
  orange: '橙',
  purple: '紫',
  white: '白',
  black: '黑',
}
</script>

<template>
  <div class="card">
    <h3>按颜色筛选岩点</h3>
    <div class="row" style="flex-wrap: wrap">
      <button
        v-for="c in HOLD_COLORS"
        :key="c"
        class="color-chip"
        :class="store.colorFilter?.has(c) ? 'on' : 'off'"
        :style="{ background: COLOR_HEX[c] }"
        :title="COLOR_LABEL[c]"
        @click="store.toggleColorFilter(c)"
      />
    </div>
    <button v-if="store.colorFilter" style="width: 100%; margin-top: 6px" @click="store.clearColorFilter()">
      清除筛选（显示全部岩点）
    </button>
    <p v-else class="muted" style="margin: 6px 0 0; font-size: 11px">
      点亮一个或多个颜色后，仅这些颜色的岩点可被悬停拾取与框选
    </p>
  </div>
</template>
