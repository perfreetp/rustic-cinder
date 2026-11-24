<template>
  <div class="grid-app">
    <TopBar class="area-top" />
    <LeftPanel class="area-left" />
    <Viewport3d class="area-center" />
    <RightPanel class="area-right" />
    <TimelinePanel class="area-timeline" />
  </div>
</template>

<script setup>
import { onMounted, onBeforeUnmount } from 'vue'
import TopBar from './components/TopBar.vue'
import LeftPanel from './components/LeftPanel.vue'
import Viewport3d from './components/Viewport3d.vue'
import RightPanel from './components/RightPanel.vue'
import TimelinePanel from './components/TimelinePanel.vue'
import {
  loadCreasePattern,
  disposeEditor,
  seedFoldPose
} from './store/editorStore.js'
import { presetMiura } from './core/presets.js'

onMounted(() => {
  // 默认载入三浦折叠（60+ 折痕），直接验证大规模交互
  loadCreasePattern(presetMiura(), '三浦折叠示例')
  // 批量播种首尾折展姿态，只触发一次求解
  seedFoldPose(62)
})

onBeforeUnmount(() => disposeEditor())
</script>

<style scoped>
.area-top { grid-area: topbar; }
.area-left { grid-area: left; min-height: 0; }
.area-center { grid-area: center; min-width: 0; min-height: 0; }
.area-right { grid-area: right; min-height: 0; }
.area-timeline { grid-area: timeline; min-width: 0; }
</style>
