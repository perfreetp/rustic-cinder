<script setup lang="ts">
import { computed } from 'vue'
import { useRouteStore } from '@/stores/routeStore'
import type { EndpointKind } from '@/types'

const store = useRouteStore()

const endpointLabel: Record<EndpointKind, string> = {
  start: '起步',
  bonus: '奖励',
  top: '顶点',
}

const rows = computed(() =>
  store.current.holds.map((rh, i) => ({
    entry: rh,
    index: i,
    hold: store.holdsById.get(rh.holdId),
  })),
)
</script>

<template>
  <div class="card">
    <h3>路线岩点序列（{{ store.current.holds.length }}）</h3>
    <div v-if="!rows.length" class="muted" style="font-size: 12px">
      点击岩壁上的岩点加入路线，或按住左键拖出框选矩形批量加入。
    </div>
    <div v-else class="hold-list">
      <div v-for="r in rows" :key="r.entry.holdId" class="hold-row">
        <span class="idx">{{ r.index + 1 }}</span>
        <span class="name">#{{ r.entry.holdId }}</span>
        <span v-if="r.entry.endpoint" class="tag" :class="r.entry.endpoint">
          {{ endpointLabel[r.entry.endpoint] }}
        </span>
        <button
          :disabled="r.index === 0"
          title="上移"
          @click="store.moveHold(r.index, r.index - 1)"
        >↑</button>
        <button
          :disabled="r.index === rows.length - 1"
          title="下移"
          @click="store.moveHold(r.index, r.index + 1)"
        >↓</button>
        <button title="移出路线" @click="store.removeHold(r.entry.holdId)">✕</button>
      </div>
    </div>
  </div>
</template>
