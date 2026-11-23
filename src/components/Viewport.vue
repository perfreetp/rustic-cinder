<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { EditorScene } from '@/three/EditorScene'
import { useRouteStore } from '@/stores/routeStore'
import type { HoldColor } from '@/types'

const store = useRouteStore()
const wrapRef = ref<HTMLDivElement | null>(null)
let editor: EditorScene | null = null

const hover = ref<{ id: number; normal: THREE.Vector3; sx: number; sy: number } | null>(null)

onMounted(() => {
  const ds = store.dataset
  if (!ds || !wrapRef.value) return
  const rect = () => wrapRef.value!.getBoundingClientRect()
  editor = new EditorScene(wrapRef.value, ds, {
    onPickHold: (id, additive) => store.pickHold(id, additive),
    onBoxSelect: (ids, additive) => store.boxSelect(ids, additive),
    onPickBlank: () => {
      if (!store.markingMode) store.clearSelection()
    },
    onHover: (info) => {
      if (!info) hover.value = null
      else {
        const r = rect()
        hover.value = {
          id: info.id,
          normal: info.normal,
          sx: info.x - r.left,
          sy: info.y - r.top,
        }
      }
    },
    onHoldMoved: (_id, committing) => {
      // 拖拽中实时重算（切线整体更新），松手时不再额外处理
      void committing
      store.notifyHoldMoved()
    },
  })
  syncAll()

  if (import.meta.env.DEV) {
    ;(window as unknown as { __editor: EditorScene }).__editor = editor
  }
})

function syncAll(): void {
  if (!editor) return
  editor.setColorFilter(store.colorFilter as Set<HoldColor> | null)
  editor.setRouteView(store.orderedHolds, store.current.holds, store.metrics)
  editor.setSelection(store.selection)
}

watch(
  () => [store.orderedHolds, store.current.holds, store.metrics],
  () => editor?.setRouteView(store.orderedHolds, store.current.holds, store.metrics),
  { deep: false },
)

watch(
  () => store.geometryVersion,
  () => editor?.setRouteView(store.orderedHolds, store.current.holds, store.metrics),
)

watch(
  () => store.selection,
  (s) => editor?.setSelection(s),
  { deep: true },
)

watch(
  () => store.colorFilter,
  (f) => editor?.setColorFilter(f as Set<HoldColor> | null),
)

onBeforeUnmount(() => {
  editor?.dispose()
  editor = null
})
</script>

<template>
  <div ref="wrapRef" class="viewport-wrap">
    <div
      v-if="hover"
      class="hover-tip"
      :style="{ left: hover.sx + 14 + 'px', top: hover.sy + 14 + 'px' }"
    >
      <div>岩点编号：<b>#{{ hover.id }}</b></div>
      <div class="normal">
        法线 n = ({{ hover.normal.x.toFixed(2) }},
        {{ hover.normal.y.toFixed(2) }}, {{ hover.normal.z.toFixed(2) }})
      </div>
    </div>
    <div v-if="store.markingMode" class="hover-tip" style="left: 12px; bottom: 12px; top: auto">
      标记模式：<b>{{
        store.markingMode === 'start'
          ? '起步点'
          : store.markingMode === 'bonus'
            ? '奖励点'
            : '顶点'
      }}</b>，点击路线内岩点分配
    </div>
  </div>
</template>
