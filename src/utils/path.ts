/** 稳定 id 生成(故障记录等) */
export function uid(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 零件树路径工具。
 * 路径形如 /传送带组件/驱动轴组/轴#12,根节点路径为 ''(空串)。
 */
export function joinPath(parentPath: string | null, name: string): string {
  const safe = name.replace(/\//g, '／');
  return parentPath === null || parentPath === '' ? `/${safe}` : `${parentPath}/${safe}`;
}

export function parentOf(path: string): string | null {
  if (!path.startsWith('/') || path === '/') return null;
  const idx = path.lastIndexOf('/');
  return idx === 0 ? '' : path.slice(0, idx);
}

export function nameOf(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** 深度:根=0 */
export function depthOf(path: string): number {
  if (!path) return 0;
  let d = 0;
  for (const c of path) if (c === '/') d++;
  return d;
}

/** b 是否为 a 本身或 a 的后代 */
export function isSelfOrDescendant(a: string, b: string): boolean {
  return a === b || b.startsWith(a === '' ? '/' : `${a}/`);
}

/** 同层重名时追加序号,如 轴#2 */
export function uniqueName(base: string, siblingNames: Set<string>): string {
  if (!siblingNames.has(base)) return base;
  let i = 2;
  let candidate = `${base}#${i}`;
  while (siblingNames.has(candidate)) {
    i++;
    candidate = `${base}#${i}`;
  }
  return candidate;
}
