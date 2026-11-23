<script setup lang="ts">
import { useRouteStore } from '@/stores/routeStore'
import type { EndpointKind } from '@/types'

const store = useRouteStore()

const modes: { kind: EndpointKind; label: string; hint: string }[] = [
  { kind: 'start', label: '起步标记', hint: '绿色圆锥' },
  { kind: 'bonus', label: '奖励点标记', hint: '金色八面体' },
  { kind: 'top', label: '顶点标记', hint: '紫色五角星' },
]
</script>

<template>
  <div class="card">
    <h3>端点样式标记</h3>
    <div class="row" style="flex-wrap: wrap">
      <button
        v-for="m in modes"
        :key="m.kind"
        :class="{ active: store.markingMode === m.kind }"
        @click="store.setMarkingMode(m.kind)"
      >
        {{ m.label }}
      </button>
    </div>
    <p class="muted" style="margin: 6px 0 0; font-size: 11px">
      进入标记模式后，点击路线中的任意岩点切换该端点；同类端点全局唯一。
      起点默认由第一个岩点承担。
    </p>
  </div>
</template>
