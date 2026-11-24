import type { PartNode, PartStatus } from '../types';
import { parentOf } from './path';

/**
 * 解析零件的有效工况状态:
 * ownStatus 为 null 时沿父链向上继承,根未覆盖时为 normal。
 * 父节点状态改变 → 子节点自动继承;子节点写入 ownStatus 即单独覆盖。
 */
export function resolveStatus(
  path: string,
  nodes: Map<string, PartNode>,
): PartStatus {
  let cur: string | null = path;
  const guard = new Set<string>();
  while (cur !== null) {
    const node = nodes.get(cur);
    if (node && node.ownStatus !== null) return node.ownStatus;
    if (guard.has(cur)) break;
    guard.add(cur);
    cur = parentOf(cur);
  }
  return 'normal';
}

/** 收集子树全部节点路径(含自身) */
export function collectSubtree(path: string, nodes: Map<string, PartNode>): string[] {
  const root = nodes.get(path);
  if (!root) return [];
  const out: string[] = [];
  const stack = [path];
  while (stack.length) {
    const p = stack.pop()!;
    out.push(p);
    const n = nodes.get(p);
    if (n) stack.push(...n.children);
  }
  return out;
}

/** 仅收集子树中的叶子(承载网格的零件) */
export function collectLeaves(path: string, nodes: Map<string, PartNode>): string[] {
  return collectSubtree(path, nodes).filter((p) => {
    const n = nodes.get(p);
    return n && n.meshCount > 0;
  });
}

/**
 * 批量设置状态(框选场景)。
 * inherit = true 时清除 ownStatus(恢复继承),否则写入具体状态覆盖。
 */
export function applyStatus(
  paths: string[],
  status: PartStatus | 'inherit',
  nodes: Map<string, PartNode>,
): Map<string, PartNode> {
  const next = new Map(nodes);
  for (const p of paths) {
    const node = next.get(p);
    if (!node) continue;
    next.set(p, { ...node, ownStatus: status === 'inherit' ? null : status });
  }
  return next;
}
