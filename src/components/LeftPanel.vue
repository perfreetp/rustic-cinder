<template>
  <aside class="left panel">
    <div class="panel-title">折痕标注</div>
    <div class="body scroll-y">
      <section class="block">
        <label class="block-label">示例折痕图</label>
        <div class="preset-grid">
          <button v-for="p in presetList" :key="p.key" @click="loadPreset(p.key)">
            {{ p.name }}
          </button>
        </div>
      </section>

      <section class="block" v-if="editorState.input">
        <label class="block-label">
          标注画布（拖拽画折痕）
          <span class="muted">{{ editorState.input.creases.length }} 条</span>
        </label>
        <CreaseEditor />
      </section>

      <section class="block" v-if="editorState.model">
        <label class="block-label">模型统计</label>
        <div class="stats">
          <div><span>折痕</span><b>{{ editorState.stats.creaseCount }}</b></div>
          <div><span>折面</span><b>{{ editorState.stats.faceCount }}</b></div>
          <div><span>高模顶点</span><b>{{ fmt(editorState.stats.highVerts) }}</b></div>
          <div><span>低模顶点</span><b>{{ fmt(editorState.stats.lowVerts) }}</b></div>
          <div><span>树深度</span><b>{{ maxDepth }}</b></div>
          <div><span>关键帧</span><b>{{ totalKeyframeCount() }}</b></div>
        </div>
        <div class="depth-dist" title="折痕树各层级的折面数量">
          <span
            v-for="d in depthDistribution"
            :key="d.depth"
            class="depth-chip"
          >
            L{{ d.depth }}:{{ d.count }}
          </span>
        </div>
        <p v-if="redundantSet.size" class="muted small redundant-note">
          {{ redundantSet.size }} 条冗余折痕（共点环边），角度随相邻折痕联动
        </p>
      </section>

      <section class="block crease-list" v-if="editorState.model">
        <label class="block-label">
          折痕列表
          <span class="muted">点击选中</span>
        </label>
        <div
          v-for="c in editorState.model.creases"
          :key="c.id"
          class="crease-row"
          :class="{ active: c.id === editorState.selectedCreaseId }"
          @click="selectCrease(c.id)"
        >
          <span class="mono fid">{{ c.id }}</span>
          <span class="tag" :class="c.type">
            {{ c.type === 'valley' ? '谷' : '峰' }}
          </span>
          <span v-if="redundantSet.has(c.id)" class="tag redundant" title="共点环边，角度随相邻折痕联动">
            冗余
          </span>
          <span class="angle muted mono">
            {{ (currentAngles[c.id] ?? 0).toFixed(1) }}°
          </span>
          <button
            class="mini"
            title="切换峰/谷"
            @click.stop="toggleType(c.id)"
          >
            ⇄
          </button>
        </div>
      </section>
    </div>
  </aside>
</template>

<script setup>
import { computed } from 'vue'
import CreaseEditor from './CreaseEditor.vue'
import {
  editorState,
  loadCreasePattern,
  selectCrease,
  currentAngles,
  totalKeyframeCount,
  invalidateWorkers
} from '../store/editorStore.js'
import {
  presetCross,
  presetFan,
  presetMiura,
  presetWindmill
} from '../core/presets.js'

const presetList = [
  { key: 'cross', name: '十字双折' },
  { key: 'fan', name: '扇形八折' },
  { key: 'windmill', name: '风车六角' },
  { key: 'miura', name: '三浦 62 折痕' }
]

const makers = {
  cross: presetCross,
  fan: presetFan,
  windmill: presetWindmill,
  miura: () => presetMiura()
}

const maxDepth = computed(() =>
  editorState.model
    ? Math.max(...editorState.model.faces.map((f) => f.depth))
    : 0
)

const redundantSet = computed(() => new Set(editorState.model?.redundantCreases || []))

const depthDistribution = computed(() => {
  if (!editorState.model) return []
  const counts = {}
  for (const f of editorState.model.faces) {
    counts[f.depth] = (counts[f.depth] || 0) + 1
  }
  return Object.keys(counts)
    .map(Number)
    .sort((a, b) => a - b)
    .map((d) => ({ depth: d, count: counts[d] }))
})

function loadPreset(key) {
  const cp = makers[key]()
  loadCreasePattern(cp, cp.name)
}

function fmt(n) {
  return n.toLocaleString()
}

function toggleType(creaseId) {
  const input = editorState.input
  const c = input.creases.find((x) => x.id === creaseId)
  if (!c) return
  c.type = c.type === 'valley' ? 'mountain' : 'valley'
  invalidateWorkers()
  // 重新建模（保留同名折痕的关键帧轨道）
  const oldTracks = JSON.parse(JSON.stringify(editorState.tracks))
  loadCreasePattern(input, editorState.modelName)
  editorState.tracks = oldTracks
}
</script>

<style scoped>
.left {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.body {
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.block-label {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 11px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--fg-dim);
  margin-bottom: 7px;
}

.preset-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 6px;
}

.preset-grid button {
  padding: 7px 6px;
  font-size: 12px;
}

.stats {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 5px 10px;
  font-size: 12px;
}

.stats div {
  display: flex;
  justify-content: space-between;
  background: var(--bg-panel-2);
  border-radius: 5px;
  padding: 4px 8px;
}

.stats span { color: var(--fg-faint); }
.stats b { font-family: var(--mono); color: var(--accent-2); }

.crease-list {
  min-height: 0;
}

.crease-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px;
  border-radius: 6px;
  cursor: pointer;
  border: 1px solid transparent;
}

.crease-row:hover {
  background: var(--bg-panel-2);
}

.crease-row.active {
  background: rgba(79, 140, 255, 0.14);
  border-color: var(--accent);
}

.fid {
  font-size: 11px;
  color: var(--fg-faint);
  width: 34px;
}

.angle {
  margin-left: auto;
  font-size: 11px;
}

.mini {
  padding: 0 6px;
  font-size: 11px;
  line-height: 18px;
}

.depth-dist {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 7px;
}

.depth-chip {
  font-family: var(--mono);
  font-size: 10px;
  background: var(--bg-panel-2);
  border: 1px solid var(--border);
  border-radius: 4px;
  padding: 1px 6px;
  color: var(--fg-dim);
}

.tag.redundant {
  color: var(--warn);
  border-color: var(--warn);
  background: rgba(224, 161, 60, 0.12);
}

.redundant-note {
  margin: 6px 0 0;
}

.small {
  font-size: 11px;
}
</style>
