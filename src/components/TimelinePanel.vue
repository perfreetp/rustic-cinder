<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { useSessionStore } from '../stores/session';
import { FAULT_META } from '../constants';

const session = useSessionStore();

const progressPct = computed(
  () => (session.currentFrame / Math.max(1, session.frameCount - 1)) * 100,
);

const faultMarkers = computed(() =>
  session.faults.map((f) => ({
    ...f,
    pct: (f.frame / Math.max(1, session.frameCount - 1)) * 100,
    meta: FAULT_META[f.type],
  })),
);

// ---------------- 播放循环 ----------------
const fps = 60;
const frameDuration = 1000 / fps;
const raf = ref(0);
let lastTs = 0;

function tick(ts: number): void {
  if (!session.playing) return;
  if (!lastTs) lastTs = ts;
  const delta = ts - lastTs;
  if (delta >= frameDuration) {
    lastTs = ts;
    const step = session.playDirection;
    let next = session.currentFrame + step;
    if (next >= session.frameCount) {
      next = session.frameCount - 1;
      session.pause();
    } else if (next < 0) {
      next = 0;
      session.pause();
    }
    session.setFrame(next);
  }
  raf.value = requestAnimationFrame(tick);
}

watch(
  () => session.playing,
  (playing) => {
    if (playing) {
      // 到端点时反向起步,保证点播放总有动作
      if (session.playDirection === 1 && session.currentFrame >= session.frameCount - 1) {
        session.setDirection(-1);
      } else if (session.playDirection === -1 && session.currentFrame <= 0) {
        session.setDirection(1);
      }
      lastTs = 0;
      raf.value = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(raf.value);
    }
  },
);

onBeforeUnmount(() => cancelAnimationFrame(raf.value));

function jumpToFault(frame: number): void {
  session.setFrame(frame);
}
</script>

<template>
  <div class="panel timeline-panel">
    <div class="panel-header">
      <span>装配动画时间轴</span>
      <span class="mono muted">
        帧 {{ session.currentFrame }} / {{ session.frameCount - 1 }}
      </span>
    </div>
    <div class="panel-body timeline-body">
      <div class="controls">
        <button
          class="ghost"
          :title="session.playDirection === 1 ? '当前:拆卸方向' : '当前:合拢方向'"
          @click="session.setDirection(session.playDirection === 1 ? -1 : 1)"
        >
          {{ session.playDirection === 1 ? '拆卸 →' : '← 合拢' }}
        </button>
        <button @click="session.setFrame(0)" title="回到首帧">⏮</button>
        <button class="primary" @click="session.togglePlay()">
          {{ session.playing ? '⏸ 暂停' : '▶ 播放' }}
        </button>
        <button @click="session.setFrame(session.frameCount - 1)" title="跳到末帧">⏭</button>
        <div class="mode-tag">
          {{ session.playDirection === 1 ? '拆卸过程' : '装配合拢' }}
          · {{ progressPct.toFixed(0) }}%
        </div>
      </div>

      <div class="track-wrap">
        <input
          class="frame-range"
          type="range"
          min="0"
          :max="session.frameCount - 1"
          :value="session.currentFrame"
          @input="session.setFrame(Number(($event.target as HTMLInputElement).value))"
        />
        <div class="marker-layer">
          <button
            v-for="m in faultMarkers"
            :key="m.id"
            class="fault-marker"
            :class="m.type"
            :style="{ left: m.pct + '%' }"
            :title="`${m.meta.label} @帧${m.frame}`"
            @click="jumpToFault(m.frame)"
          ></button>
        </div>
      </div>

      <div class="fault-legend">
        <template v-if="faultMarkers.length">
          <span
            v-for="m in faultMarkers"
            :key="m.id"
            class="legend-item"
            @click="jumpToFault(m.frame)"
          >
            <i :class="m.type"></i>{{ m.meta.label }} · 帧{{ m.frame }}
          </span>
        </template>
        <span v-else class="muted">暂无故障帧标记,故障注入后将自动标记并跳转</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.timeline-panel {
  flex: none;
}

.timeline-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.controls {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mode-tag {
  margin-left: auto;
  color: var(--fg-1);
  font-size: 12px;
}

.track-wrap {
  position: relative;
  padding: 6px 0;
}

.frame-range {
  margin: 0;
}

.marker-layer {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 14px;
  transform: translateY(-50%);
  pointer-events: none;
}

.fault-marker {
  position: absolute;
  width: 10px;
  height: 14px;
  padding: 0;
  border: none;
  border-radius: 2px;
  transform: translateX(-50%);
  pointer-events: auto;
  cursor: pointer;
}

.fault-marker.jam {
  background: var(--warn);
}
.fault-marker.overheat {
  background: var(--danger);
}
.fault-marker.shaftBreak {
  background: var(--purple);
}

.fault-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  font-size: 11px;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  color: var(--fg-1);
}

.legend-item i {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  display: inline-block;
}

.legend-item i.jam {
  background: var(--warn);
}
.legend-item i.overheat {
  background: var(--danger);
}
.legend-item i.shaftBreak {
  background: var(--purple);
}
</style>
