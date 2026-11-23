import type { Trajectory, TrajectorySummary } from '../types'

/**
 * 轨迹本地持久化(IndexedDB)。
 * 坐标以裸二进制 Float32 存储,不做 JSON 序列化,千帧轨迹也不会爆内存字符串。
 */
const DB_NAME = 'mol-trajectory-db'
const STORE = 'trajectories'
const VERSION = 1

interface StoredRecord {
  id: string
  name: string
  frameCount: number
  atomCount: number
  frameDelta: number
  createdAt: number
  atoms: Trajectory['atoms']
  /** 原始 Float32 字节 */
  positionsBuffer: ArrayBuffer
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = run(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      }),
  )
}

export async function saveTrajectory(traj: Trajectory): Promise<void> {
  const record: StoredRecord = {
    id: traj.id,
    name: traj.name,
    frameCount: traj.frameCount,
    atomCount: traj.atomCount,
    frameDelta: traj.frameDelta,
    createdAt: traj.createdAt,
    atoms: traj.atoms,
    // 拷贝一份独立 buffer,避免 transfer 走调用方内存
    positionsBuffer: traj.positions.buffer.slice(0) as ArrayBuffer,
  }
  await tx('readwrite', (s) => s.put(record))
}

export async function loadTrajectory(id: string): Promise<Trajectory | null> {
  const rec = await tx<StoredRecord | undefined>('readonly', (s) => s.get(id))
  if (!rec) return null
  return {
    id: rec.id,
    name: rec.name,
    frameCount: rec.frameCount,
    atomCount: rec.atomCount,
    frameDelta: rec.frameDelta,
    createdAt: rec.createdAt,
    atoms: rec.atoms,
    positions: new Float32Array(rec.positionsBuffer),
  }
}

export async function listTrajectories(): Promise<TrajectorySummary[]> {
  const all = await tx<StoredRecord[]>('readonly', (s) => s.getAll())
  return all
    .map((r) => ({
      id: r.id,
      name: r.name,
      frameCount: r.frameCount,
      atomCount: r.atomCount,
      sizeBytes: r.positionsBuffer.byteLength + JSON.stringify(r.atoms).length,
      createdAt: r.createdAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt)
}

export async function deleteTrajectory(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id))
}
