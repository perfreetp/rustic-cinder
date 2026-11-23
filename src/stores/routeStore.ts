import { computed, reactive, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type {
  EndpointKind,
  Grade,
  Hold,
  HoldColor,
  RouteData,
  RouteHold,
  WallDataset,
} from '@/types'
import {
  computeRouteMetrics,
  DEFAULT_THRESHOLDS,
  type RouteMetrics,
} from '@/lib/grade'
import {
  deleteRoute,
  loadAllRoutes,
  newRouteId,
  upsertRoute,
} from '@/lib/storage'

interface CurrentRoute {
  id: string
  name: string
  color: string
  holds: RouteHold[]
  thresholds: typeof DEFAULT_THRESHOLDS
  createdAt: number
  updatedAt: number
}

function blankRoute(): CurrentRoute {
  const now = Date.now()
  return {
    id: newRouteId(),
    name: '未命名路线',
    color: '#3aa0ff',
    holds: [],
    thresholds: deepClone(DEFAULT_THRESHOLDS),
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * 深拷贝路线数据。不能用 structuredClone：Pinia 的 reactive 代理
 * 在部分浏览器下对结构化克隆抛出 DataCloneError；路线数据全是
 * JSON 可序列化的纯对象，JSON 往返即可得到脱离响应式的普通对象。
 */
function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

export const useRouteStore = defineStore('route', () => {
  const dataset = shallowRef<WallDataset | null>(null)
  const current = reactive<CurrentRoute>(blankRoute())
  const selection = ref<Set<number>>(new Set())
  const colorFilter = ref<Set<HoldColor> | null>(null)
  const markingMode = ref<EndpointKind | null>(null)
  const library = ref<RouteData[]>([])
  const geometryVersion = ref(0)
  const compareAId = ref<string | null>(null)
  const compareBId = ref<string | null>(null)
  const showCompare = ref(false)

  const holdsById = computed(() => {
    const map = new Map<number, Hold>()
    dataset.value?.holds.forEach((h) => map.set(h.id, h))
    return map
  })

  const routeHoldIdSet = computed(
    () => new Set(current.holds.map((h) => h.holdId)),
  )

  const orderedHolds = computed<Hold[]>(() =>
    current.holds
      .map((rh) => holdsById.value.get(rh.holdId))
      .filter((h): h is Hold => Boolean(h)),
  )

  const metrics = computed<RouteMetrics | null>(() =>
    orderedHolds.value.length >= 2
      ? computeRouteMetrics(orderedHolds.value, current.thresholds)
      : null,
  )

  const grade = computed<Grade | null>(() => metrics.value?.grade ?? null)

  function initDataset(ds: WallDataset): void {
    dataset.value = ds
    library.value = loadAllRoutes()
  }

  // ------------------------------------------------------------ 拾取/选择

  /** 点击拾取：标记模式下分配端点，否则切换路线成员 */
  function pickHold(holdId: number, additive: boolean): void {
    const existing = current.holds.find((h) => h.holdId === holdId)
    if (markingMode.value) {
      assignEndpoint(holdId, markingMode.value)
      return
    }
    if (existing) {
      if (additive) {
        selection.value = new Set([...selection.value, holdId])
      } else {
        current.holds = current.holds.filter((h) => h.holdId !== holdId)
        selection.value.delete(holdId)
        selection.value = new Set(selection.value)
        touch()
      }
      return
    }
    const entry: RouteHold = {
      holdId,
      endpoint: current.holds.length === 0 ? 'start' : null,
    }
    current.holds.push(entry)
    if (additive) selection.value = new Set([...selection.value, holdId])
    else selection.value = new Set([holdId])
    touch()
  }

  /** 框选：更新选择集，并把新岩点追加进路线 */
  function boxSelect(holdIds: number[], additive: boolean): void {
    if (holdIds.length === 0) {
      if (!additive) selection.value = new Set()
      return
    }
    const next = additive
      ? new Set([...selection.value, ...holdIds])
      : new Set(holdIds)
    selection.value = next

    const known = routeHoldIdSet.value
    const appended = holdIds
      .filter((id) => !known.has(id))
      .sort((a, b) => a - b)
      .map<RouteHold>((id) => ({ holdId: id, endpoint: null }))
    if (appended.length) {
      current.holds.push(...appended)
      touch()
    }
  }

  function clearSelection(): void {
    selection.value = new Set()
  }

  function removeHold(holdId: number): void {
    current.holds = current.holds.filter((h) => h.holdId !== holdId)
    selection.value.delete(holdId)
    selection.value = new Set(selection.value)
    touch()
  }

  function moveHold(from: number, to: number): void {
    const arr = current.holds
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return
    const [item] = arr.splice(from, 1)
    arr.splice(to, 0, item)
    touch()
  }

  function clearRoute(): void {
    Object.assign(current, blankRoute())
    selection.value = new Set()
    markingMode.value = null
  }

  // ------------------------------------------------------------ 端点标记

  function assignEndpoint(holdId: number, kind: EndpointKind): void {
    if (!routeHoldIdSet.value.has(holdId)) return
    // 同一种端点全局唯一
    current.holds.forEach((h) => {
      if (h.endpoint === kind) h.endpoint = null
    })
    const target = current.holds.find((h) => h.holdId === holdId)
    if (target) target.endpoint = target.endpoint === kind ? null : kind
    touch()
  }

  function setMarkingMode(kind: EndpointKind | null): void {
    markingMode.value = markingMode.value === kind ? null : kind
  }

  // ------------------------------------------------------------ 色带阈值

  function setThreshold(kind: 'spacing' | 'angle', level: number, value: number): void {
    current.thresholds[kind][level] = value
    touch()
  }

  function resetThresholds(): void {
    current.thresholds = deepClone(DEFAULT_THRESHOLDS)
    touch()
  }

  // ------------------------------------------------------------ 颜色筛选

  function toggleColorFilter(color: HoldColor): void {
    const next = new Set(colorFilter.value ?? [])
    if (next.has(color)) next.delete(color)
    else next.add(color)
    colorFilter.value = next.size ? next : null
  }

  function clearColorFilter(): void {
    colorFilter.value = null
  }

  // ------------------------------------------------------------ 拖拽通知

  function notifyHoldMoved(): void {
    geometryVersion.value++
    touch()
  }

  function touch(): void {
    current.updatedAt = Date.now()
  }

  // ------------------------------------------------------------ 路线库

  function toRouteData(): RouteData {
    const gradeValue = metrics.value?.grade ?? 'V0'
    return {
      version: 1,
      id: current.id,
      name: current.name,
      color: current.color,
      createdAt: current.createdAt,
      updatedAt: current.updatedAt,
      holds: deepClone(current.holds),
      thresholds: deepClone(current.thresholds),
      grade: gradeValue,
      wallFingerprint: dataset.value?.fingerprint ?? '',
    }
  }

  function saveToLibrary(): RouteData {
    const data = toRouteData()
    library.value = upsertRoute(data)
    return data
  }

  function loadRoute(data: RouteData): number[] {
    const knownIds = new Set(dataset.value?.holds.map((h) => h.id) ?? [])
    const valid = data.holds.filter((h) => knownIds.has(h.holdId))
    const missing = data.holds
      .filter((h) => !knownIds.has(h.holdId))
      .map((h) => h.holdId)
    Object.assign(current, {
      id: data.id,
      name: `${data.name}`,
      color: data.color,
      holds: deepClone(valid),
      thresholds: deepClone(data.thresholds),
      createdAt: data.createdAt,
      updatedAt: Date.now(),
    })
    selection.value = new Set()
    markingMode.value = null
    return missing
  }

  function importRoute(data: RouteData): { missing: number[]; mismatch: boolean } {
    const missing = loadRoute(data)
    return {
      missing,
      mismatch: data.wallFingerprint !== (dataset.value?.fingerprint ?? ''),
    }
  }

  function removeFromLibrary(id: string): void {
    library.value = deleteRoute(id)
  }

  function startNewRoute(): void {
    clearRoute()
  }

  return {
    // state
    dataset,
    current,
    selection,
    colorFilter,
    markingMode,
    library,
    geometryVersion,
    compareAId,
    compareBId,
    showCompare,
    // getters
    holdsById,
    routeHoldIdSet,
    orderedHolds,
    metrics,
    grade,
    // actions
    initDataset,
    pickHold,
    boxSelect,
    clearSelection,
    removeHold,
    moveHold,
    clearRoute,
    assignEndpoint,
    setMarkingMode,
    setThreshold,
    resetThresholds,
    touch,
    toggleColorFilter,
    clearColorFilter,
    notifyHoldMoved,
    saveToLibrary,
    loadRoute,
    importRoute,
    removeFromLibrary,
    startNewRoute,
    toRouteData,
  }
})
