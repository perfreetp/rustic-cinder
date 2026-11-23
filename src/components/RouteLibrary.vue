<script setup lang="ts">
import { ref } from 'vue'
import { useRouteStore } from '@/stores/routeStore'
import { exportRouteFile, importRouteFile } from '@/lib/storage'
import { GRADE_COLORS } from '@/lib/grade'

const store = useRouteStore()
const fileInput = ref<HTMLInputElement | null>(null)
const toast = ref<{ text: string; error?: boolean } | null>(null)
let toastTimer: ReturnType<typeof setTimeout> | undefined

function showToast(text: string, error = false): void {
  toast.value = { text, error }
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => (toast.value = null), 4000)
}

function save(): void {
  if (store.current.holds.length === 0) {
    showToast('当前路线没有岩点，无法保存', true)
    return
  }
  const data = store.saveToLibrary()
  showToast(`路线「${data.name}」已存入浏览器路线库`)
}

function exportCurrent(): void {
  if (store.current.holds.length === 0) {
    showToast('当前路线没有岩点，无法导出', true)
    return
  }
  exportRouteFile(store.toRouteData())
  showToast('路线 JSON 已导出')
}

async function onImportFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || !store.dataset) return
  try {
    const result = await importRouteFile(
      file,
      new Set(store.dataset.holds.map((h) => h.id)),
      store.dataset.fingerprint,
    )
    const { missing, mismatch } = store.importRoute(result.route)
    const notes: string[] = []
    if (missing.length) notes.push(`有 ${missing.length} 个岩点编号在当前岩壁不存在，已跳过`)
    if (mismatch) notes.push('岩壁指纹不一致，请确认路线来自同一面墙')
    showToast(
      notes.length ? notes.join('；') : `路线「${result.route.name}」已按编号回填并重建弧线`,
      notes.length > 0,
    )
  } catch (err) {
    showToast(`导入失败：${(err as Error).message}`, true)
  }
}

function openCompare(): void {
  if (store.library.length < 2) {
    showToast('路线库中至少需要两条路线才能对比', true)
    return
  }
  store.compareAId = store.library[0].id
  store.compareBId = store.library[1].id
  store.showCompare = true
}
</script>

<template>
  <div class="card">
    <h3>路线库（浏览器本地存储，{{ store.library.length }} 条）</h3>
    <div class="row" style="flex-wrap: wrap">
      <button class="primary" @click="save">保存当前路线</button>
      <button @click="exportCurrent">导出 JSON</button>
      <button @click="fileInput?.click()">导入 JSON</button>
      <button @click="openCompare">对比视图</button>
      <input
        ref="fileInput"
        type="file"
        accept="application/json,.json"
        style="display: none"
        @change="onImportFile"
      />
    </div>

    <div v-if="!store.library.length" class="muted" style="font-size: 12px; margin-top: 6px">
      尚无保存的路线。定线完成后点击“保存当前路线”。
    </div>

    <div style="margin-top: 8px">
      <div v-for="r in store.library" :key="r.id" class="library-item">
        <div style="display: flex; align-items: center; gap: 8px">
          <span
            :style="{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: GRADE_COLORS[r.grade],
              flexShrink: 0,
            }"
          />
          <b style="flex: 1">{{ r.name }}</b>
          <span class="muted">{{ r.grade }} · {{ r.holds.length }} 点</span>
        </div>
        <div class="meta">
          {{ new Date(r.updatedAt).toLocaleString() }}
        </div>
        <div class="actions">
          <button @click="store.loadRoute(r); showToast(`已载入路线「${r.name}」`)">载入编辑</button>
          <button @click="exportRouteFile(r)">导出</button>
          <button class="danger" @click="store.removeFromLibrary(r.id)">删除</button>
        </div>
      </div>
    </div>

    <div v-if="toast" class="toast" :class="{ error: toast.error }">{{ toast.text }}</div>
  </div>
</template>
