<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { RouteViewer, type CompareRoute } from '@/three/RouteViewer'
import { useRouteStore } from '@/stores/routeStore'
import type { RouteData } from '@/types'

const store = useRouteStore()
const cellA = ref<HTMLDivElement | null>(null)
const cellB = ref<HTMLDivElement | null>(null)
const syncCamera = ref(true)
let viewerA: RouteViewer | null = null
let viewerB: RouteViewer | null = null
let syncing = false

function toCompareRoute(data: RouteData | undefined): CompareRoute | null {
  if (!data) return null
  return {
    name: data.name,
    holdIds: data.holds.map((h) => h.holdId),
    color: data.color,
  }
}

const routeA = computed(() =>
  toCompareRoute(store.library.find((r) => r.id === store.compareAId)),
)
const routeB = computed(() =>
  toCompareRoute(store.library.find((r) => r.id === store.compareBId)),
)

const diff = computed(() => {
  const a = new Set(routeA.value?.holdIds ?? [])
  const b = new Set(routeB.value?.holdIds ?? [])
  const shared = [...a].filter((id) => b.has(id))
  const onlyA = [...a].filter((id) => !b.has(id))
  const onlyB = [...b].filter((id) => !a.has(id))
  return { shared, onlyA, onlyB }
})

async function mountViewers(): Promise<void> {
  await nextTick()
  if (!cellA.value || !cellB.value || !store.dataset) return
  viewerA = new RouteViewer(cellA.value, store.dataset)
  viewerB = new RouteViewer(cellB.value, store.dataset)
  viewerA.showRoute(routeA.value)
  viewerB.showRoute(routeB.value)
  // 相机联动：任一视口轨道操作后把姿态同步给另一侧
  const poll = () => {
    if (!viewerA || !viewerB) return
    if (syncCamera.value && !syncing) {
      syncing = true
      const s = viewerA.getCameraState()
      viewerB.setCameraState(s.pos, s.target)
      setTimeout(() => (syncing = false), 60)
    }
    raf = requestAnimationFrame(poll)
  }
  raf = requestAnimationFrame(poll)
}

let raf = 0

watch(routeA, (r) => viewerA?.showRoute(r))
watch(routeB, (r) => viewerB?.showRoute(r))

function close(): void {
  store.showCompare = false
}

onBeforeUnmount(() => {
  cancelAnimationFrame(raf)
  viewerA?.dispose()
  viewerB?.dispose()
  viewerA = null
  viewerB = null
})

mountViewers()
</script>

<template>
  <div class="compare-overlay">
    <div class="row" style="margin: 0; gap: 14px">
      <h2 style="margin: 0; font-size: 16px">路线对比</h2>
      <label style="display: flex; align-items: center; gap: 6px">
        <input type="checkbox" v-model="syncCamera" style="width: auto" /> 相机联动
      </label>
      <div class="spacer" style="flex: 1"></div>
      <button @click="close">关闭对比</button>
    </div>

    <div class="compare-summary">
      <span>路线 A：
        <select v-model="store.compareAId" style="width: 180px">
          <option v-for="r in store.library" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </span>
      <span>路线 B：
        <select v-model="store.compareBId" style="width: 180px">
          <option v-for="r in store.library" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </span>
      <span>共用岩点：<b>{{ diff.shared.length }}</b></span>
      <span>仅 A 有：<b>{{ diff.onlyA.length }}</b></span>
      <span>仅 B 有：<b>{{ diff.onlyB.length }}</b></span>
      <span class="muted">
        共用编号：{{ diff.shared.length ? diff.shared.slice(0, 12).map((i) => '#' + i).join(' ') : '无'
        }}{{ diff.shared.length > 12 ? ' …' : '' }}
      </span>
    </div>

    <div class="compare-grid">
      <div ref="cellA" class="compare-cell">
        <span class="title" :style="{ borderBottom: `3px solid ${routeA?.color ?? '#888'}` }">
          A · {{ routeA?.name ?? '未选择' }}
        </span>
      </div>
      <div ref="cellB" class="compare-cell">
        <span class="title" :style="{ borderBottom: `3px solid ${routeB?.color ?? '#888'}` }">
          B · {{ routeB?.name ?? '未选择' }}
        </span>
      </div>
    </div>
  </div>
</template>
