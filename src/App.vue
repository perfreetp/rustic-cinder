<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRouteStore } from '@/stores/routeStore'
import { createDemoDataset } from '@/three/demoData'
import Viewport from '@/components/Viewport.vue'
import ColorFilter from '@/components/ColorFilter.vue'
import RouteHoldList from '@/components/RouteHoldList.vue'
import EndpointMarkers from '@/components/EndpointMarkers.vue'
import GradePanel from '@/components/GradePanel.vue'
import RouteLibrary from '@/components/RouteLibrary.vue'
import CompareView from '@/components/CompareView.vue'
import { GRADE_COLORS } from '@/lib/grade'

const store = useRouteStore()

onMounted(() => {
  // 加载岩壁网格（2 万面）与 1200 个岩点实例，进入编辑视口
  store.initDataset(createDemoDataset())
  // DEV 调试/自动化入口，生产构建会被裁掉
  if (import.meta.env.DEV) {
    ;(window as unknown as { __store: typeof store }).__store = store
  }
})

const holdCount = computed(() => store.dataset?.holds.length ?? 0)
const wallTriangles = computed(() => {
  const geo = store.dataset?.wallGeometry
  return geo ? geo.index ? geo.index.count / 3 : 0 : 0
})
</script>

<template>
  <div v-if="store.dataset" class="app-shell">
    <header class="topbar">
      <h1>🧗 攀岩路线三维规划器</h1>
      <span class="muted">
        岩壁 {{ wallTriangles.toLocaleString() }} 面 · 岩点 {{ holdCount }} 个（BVH 加速拾取）
      </span>
      <span class="spacer"></span>
      <input v-model="store.current.name" style="width: 200px" placeholder="路线名称" />
      <label class="row" style="margin: 0; gap: 6px">
        <span class="muted">路线色</span>
        <input type="color" v-model="store.current.color" style="width: 42px; padding: 2px" />
      </label>
      <span
        v-if="store.grade"
        class="tag"
        :style="{
          background: GRADE_COLORS[store.grade],
          color: '#0c0f15',
          fontSize: 13,
          padding: '3px 12px',
        }"
      >{{ store.grade }}</span>
      <button class="danger" @click="store.startNewRoute()">新建路线</button>
    </header>

    <aside class="side left">
      <ColorFilter />
      <EndpointMarkers />
      <RouteHoldList />
    </aside>

    <main>
      <Viewport />
    </main>

    <aside class="side right">
      <GradePanel />
      <RouteLibrary />
    </aside>

    <CompareView v-if="store.showCompare" />
  </div>
  <div v-else style="display: flex; align-items: center; justify-content: center; height: 100%">
    正在加载岩壁与岩点…
  </div>
</template>
