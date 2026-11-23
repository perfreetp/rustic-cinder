import type { AtomMeta, Trajectory } from '../types'

export class ParseError extends Error {}

function uid(): string {
  return `traj-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 多帧 XYZ 解析。格式:
 *   第1行:原子数 N
 *   第2行:注释(可空)
 *   接下来 N 行:元素 x y z
 * 以上结构重复 F 次。坐标单位按 Å(埃)处理。
 */
export function parseMultiXyz(text: string, name: string): Trajectory {
  const lines = text.split(/\r?\n/)
  let cursor = 0
  const frames: number[][] = []
  let atomCount = -1
  let atoms: AtomMeta[] = []

  while (cursor < lines.length) {
    // 跳过空行
    while (cursor < lines.length && lines[cursor].trim() === '') cursor++
    if (cursor >= lines.length) break

    const n = Number.parseInt(lines[cursor].trim(), 10)
    if (!Number.isFinite(n) || n <= 0) {
      throw new ParseError(`第 ${cursor + 1} 行:期望原子数,实际为 "${lines[cursor].trim()}"`)
    }
    if (atomCount === -1) {
      atomCount = n
    } else if (n !== atomCount) {
      throw new ParseError(`第 ${cursor + 1} 行:原子数 ${n} 与首帧 ${atomCount} 不一致`)
    }
    cursor += 2 // 跳过计数行与注释行

    const coords: number[] = new Array(n * 3)
    for (let i = 0; i < n; i++) {
      if (cursor >= lines.length) throw new ParseError(`文件在第 ${cursor + 1} 行提前结束`)
      const parts = lines[cursor].trim().split(/\s+/)
      if (parts.length < 4) throw new ParseError(`第 ${cursor + 1} 行:需要 "元素 x y z",实际为 "${lines[cursor].trim()}"`)
      const symbol = normalizeElement(parts[0])
      if (frames.length === 0) {
        atoms.push({
          id: i,
          element: symbol,
          residue: symbol, // XYZ 无残基信息,标注时回退到元素名
          residueId: Math.floor(i / 10) + 1,
          atomName: `${symbol}${i + 1}`,
        })
      } else if (atoms[i].element !== symbol) {
        throw new ParseError(`第 ${cursor + 1} 行:原子 ${i + 1} 元素与首帧不一致`)
      }
      const x = Number(parts[1])
      const y = Number(parts[2])
      const z = Number(parts[3])
      if (![x, y, z].every(Number.isFinite)) throw new ParseError(`第 ${cursor + 1} 行:坐标不是合法数字`)
      coords[i * 3] = x
      coords[i * 3 + 1] = y
      coords[i * 3 + 2] = z
      cursor++
    }
    frames.push(coords)
  }

  if (frames.length === 0) throw new ParseError('文件中没有解析到任何帧')

  const positions = new Float32Array(atomCount * frames.length * 3)
  frames.forEach((f, fi) => positions.set(f, fi * atomCount * 3))

  return {
    id: uid(),
    name,
    frameCount: frames.length,
    atomCount,
    atoms,
    positions,
    frameDelta: 1,
    createdAt: Date.now(),
  }
}

function normalizeElement(raw: string): string {
  const s = raw.trim()
  if (/^\d+$/.test(s)) return 'X' // 纯数字原子序号占位
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

/**
 * 自定义 JSON 格式(支持残基标注):
 * {
 *   "name": "...", "frameDelta": 1,
 *   "atoms": [{ "element": "C", "residue": "ALA", "residueId": 1, "atomName": "CA" }],
 *   "frames": [[x,y,z, ...], ...]   // 每帧 atomCount*3 个数字
 * }
 */
export function parseTrajectoryJson(text: string, fallbackName: string): Trajectory {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (e) {
    throw new ParseError(`JSON 解析失败:${(e as Error).message}`)
  }
  const obj = data as Record<string, unknown>
  const rawAtoms = obj.atoms
  const rawFrames = obj.frames
  if (!Array.isArray(rawAtoms) || rawAtoms.length === 0) throw new ParseError('缺少非空 atoms 数组')
  if (!Array.isArray(rawFrames) || rawFrames.length === 0) throw new ParseError('缺少非空 frames 数组')

  const atomCount = rawAtoms.length
  const atoms: AtomMeta[] = rawAtoms.map((a, i) => {
    const o = a as Record<string, unknown>
    const symbol = normalizeElement(String(o.element ?? 'X'))
    return {
      id: i,
      element: symbol,
      residue: o.residue != null ? String(o.residue) : symbol,
      residueId: o.residueId != null ? Number(o.residueId) : Math.floor(i / 10) + 1,
      atomName: o.atomName != null ? String(o.atomName) : `${symbol}${i + 1}`,
    }
  })

  const positions = new Float32Array(atomCount * rawFrames.length * 3)
  rawFrames.forEach((frame, fi) => {
    if (!Array.isArray(frame) || frame.length !== atomCount * 3) {
      throw new ParseError(`第 ${fi + 1} 帧长度应为 ${atomCount * 3},实际 ${Array.isArray(frame) ? frame.length : '非数组'}`)
    }
    const offset = fi * atomCount * 3
    for (let k = 0; k < frame.length; k++) {
      const v = Number(frame[k])
      if (!Number.isFinite(v)) throw new ParseError(`第 ${fi + 1} 帧第 ${k + 1} 个值不是合法数字`)
      positions[offset + k] = v
    }
  })

  return {
    id: uid(),
    name: String(obj.name ?? fallbackName),
    frameCount: rawFrames.length,
    atomCount,
    atoms,
    positions,
    frameDelta: Number(obj.frameDelta) > 0 ? Number(obj.frameDelta) : 1,
    createdAt: Date.now(),
  }
}

export async function parseTrajectoryFile(file: File): Promise<Trajectory> {
  const text = await file.text()
  const baseName = file.name.replace(/\.[^.]+$/, '')
  if (file.name.toLowerCase().endsWith('.json')) return parseTrajectoryJson(text, baseName)
  if (file.name.toLowerCase().endsWith('.xyz')) return parseMultiXyz(text, baseName)
  // 内容嗅探:首字符为 { 走 JSON,否则按 XYZ
  if (text.trimStart().startsWith('{')) return parseTrajectoryJson(text, baseName)
  return parseMultiXyz(text, baseName)
}
