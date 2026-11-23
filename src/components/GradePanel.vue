<script setup lang="ts">
import { computed } from 'vue'
import { useRouteStore } from '@/stores/routeStore'
import { GRADE_COLORS } from '@/lib/grade'
import { GRADES } from '@/types'

const store = useRouteStore()

const spacingRows = computed(() =>
  GRADES.map((g, i) => ({
    grade: g,
    value: store.current.thresholds.spacing[i],
    min: 0.1,
    max: 2,
    step: 0.01,
    kind: 'spacing' as const,
    level: i,
  })),
)

const angleRows = computed(() =>
  GRADES.map((g, i) => ({
    grade: g,
    value: store.current.thresholds.angle[i],
    min: 2,
    max: 90,
    step: 1,
    kind: 'angle' as const,
    level: i,
  })),
)
</script>

<template>
  <div class="card">
    <h3>难度色带（V0 - V8）</h3>
    <div class="row" style="align-items: flex-start">
      <div
        class="grade-badge"
        :style="{ background: store.grade ? GRADE_COLORS[store.grade] : '#444' }"
      >
        {{ store.grade ?? '—' }}
      </div>
      <div v-if="store.metrics" style="flex: 1; font-size: 12px; line-height: 1.7">
        <div>平均间距：<b>{{ store.metrics.avgSpacing.toFixed(2) }} m</b></div>
        <div>平均转角：<b>{{ store.metrics.avgAngle.toFixed(1) }}°</b></div>
        <div>间距档 / 角度档：{{ store.metrics.spacingLevel }} / {{ store.metrics.angleLevel }}</div>
      </div>
      <div v-else class="muted" style="flex: 1; font-size: 12px">
        至少两个岩点后计算难度
      </div>
    </div>

    <div style="display: flex; gap: 3px; margin: 10px 0 6px">
      <div
        v-for="g in GRADES"
        :key="g"
        :title="g"
        :style="{
          flex: 1,
          height: 10,
          background: GRADE_COLORS[g],
          outline: store.grade === g ? '2px solid #fff' : 'none',
          borderRadius: 2,
        }"
      />
    </div>

    <h3 style="margin-top: 12px">间距阈值（米）</h3>
    <div class="threshold-row" v-for="r in spacingRows" :key="'s' + r.grade">
      <span class="gname" :style="{ color: GRADE_COLORS[r.grade] }">{{ r.grade }}</span>
      <input
        type="range"
        :min="r.min"
        :max="r.max"
        :step="r.step"
        :value="r.value"
        @input="store.setThreshold('spacing', r.level, parseFloat(($event.target as HTMLInputElement).value))"
      />
      <span class="muted">{{ r.value.toFixed(2) }}</span>
    </div>

    <h3 style="margin-top: 12px">转角阈值（度）</h3>
    <div class="threshold-row" v-for="r in angleRows" :key="'a' + r.grade">
      <span class="gname" :style="{ color: GRADE_COLORS[r.grade] }">{{ r.grade }}</span>
      <input
        type="range"
        :min="r.min"
        :max="r.max"
        :step="r.step"
        :value="r.value"
        @input="store.setThreshold('angle', r.level, parseFloat(($event.target as HTMLInputElement).value))"
      />
      <span class="muted">{{ r.value.toFixed(0) }}°</span>
    </div>

    <button style="width: 100%; margin-top: 8px" @click="store.resetThresholds()">
      恢复默认阈值（路线重新着色）
    </button>
  </div>
</template>
