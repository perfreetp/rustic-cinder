import type { RouteData } from '@/types'

const STORAGE_KEY = 'boulder-route-planner:routes:v1'

/** 读取全部已保存路线（浏览器 localStorage） */
export function loadAllRoutes(): RouteData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as RouteData[]) : []
  } catch (err) {
    console.warn('路线库读取失败', err)
    return []
  }
}

/** 全量覆盖保存 */
export function saveAllRoutes(routes: RouteData[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(routes))
}

export function upsertRoute(route: RouteData): RouteData[] {
  const all = loadAllRoutes()
  const idx = all.findIndex((r) => r.id === route.id)
  if (idx >= 0) all[idx] = route
  else all.unshift(route)
  saveAllRoutes(all)
  return all
}

export function deleteRoute(id: string): RouteData[] {
  const all = loadAllRoutes().filter((r) => r.id !== id)
  saveAllRoutes(all)
  return all
}

/** 导出单条路线为 JSON 文件下载 */
export function exportRouteFile(route: RouteData): void {
  const blob = new Blob([JSON.stringify(route, null, 2)], {
    type: 'application/json',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `route-${route.name.replace(/[\\/:*?"<>|\s]+/g, '_')}-${route.id.slice(0, 8)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export interface ImportResult {
  route: RouteData
  /** 回填时找不到的岩点编号 */
  missingHoldIds: number[]
  /** 岩壁指纹不一致（仍允许导入，调用方提示） */
  fingerprintMismatch: boolean
}

/** 从 File 解析路线 JSON，并按岩点编号校验回填 */
export async function importRouteFile(
  file: File,
  knownHoldIds: Set<number>,
  wallFingerprint: string,
): Promise<ImportResult> {
  const text = await file.text()
  const route = JSON.parse(text) as RouteData
  if (!route || route.version !== 1 || !Array.isArray(route.holds)) {
    throw new Error('文件格式无效：不是受支持的路线 JSON（version 1）')
  }
  const missingHoldIds = route.holds
    .map((h) => h.holdId)
    .filter((id) => !knownHoldIds.has(id))
  return {
    route,
    missingHoldIds,
    fingerprintMismatch: route.wallFingerprint !== wallFingerprint,
  }
}

export function newRouteId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID()
  }
  return `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}
