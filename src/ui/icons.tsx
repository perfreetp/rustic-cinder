import React from "react";
import type { BaseShapeId, MaterialPresetId, ToolId } from '../core/types';

const s = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export function IconAdd() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <circle cx="12" cy="12" r="7.2" />
      <path d="M12 8.6v6.8M8.6 12h6.8" />
    </svg>
  );
}

export function IconErase() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M8.4 4.9l9.3 9.3-4.2 4.2a2 2 0 0 1-2.8 0l-4.9-4.9a2 2 0 0 1 0-2.8L8.4 4.9z" />
      <path d="M12.6 9.1l4.9 4.9 3.4-3.4a2 2 0 0 0 0-2.8l-2.6-2.6a2 2 0 0 0-2.8 0L12.6 9.1z" />
      <path d="M4.6 19.4h6.6" />
    </svg>
  );
}

export function IconSmooth() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M3.5 15.5c2.6-3.8 5-3.8 7.4 0s4.9 3.8 7.4 0" />
      <path d="M3.5 9.6c2.6-3.8 5-3.8 7.4 0s4.9 3.8 7.4 0" opacity="0.45" />
    </svg>
  );
}

export function IconMove() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <path d="M12 3.6v16.8M3.6 12h16.8" />
      <path d="M9.6 6l2.4-2.4L14.4 6M9.6 18l2.4 2.4 2.4-2.4M6 9.6L3.6 12 6 14.4M18 9.6l2.4 2.4-2.4 2.4" />
    </svg>
  );
}

export function IconOrbit() {
  return (
    <svg viewBox="0 0 24 24" {...s}>
      <ellipse cx="12" cy="12" rx="8.5" ry="4" transform="rotate(-28 12 12)" />
      <circle cx="12" cy="12" r="2.4" />
      <path d="M18.4 7.1l2.2.5-.7 2.1" />
    </svg>
  );
}

export function IconUndo() {
  return (
    <svg viewBox="0 0 24 24" {...s} width="15" height="15">
      <path d="M8.2 7.4H4.4V3.6" />
      <path d="M4.6 7.2a8 8 0 1 1-1 7" />
    </svg>
  );
}

export function IconExport() {
  return (
    <svg viewBox="0 0 24 24" {...s} width="15" height="15">
      <path d="M12 15.4V4.2M8.2 8L12 4.2 15.8 8" />
      <path d="M4.6 14.4v4a1.6 1.6 0 0 0 1.6 1.6h11.6a1.6 1.6 0 0 0 1.6-1.6v-4" />
    </svg>
  );
}

export function IconHome() {
  return (
    <svg viewBox="0 0 24 24" {...s} width="15" height="15">
      <path d="M4 10.6L12 4l8 6.6" />
      <path d="M6.2 9.4v9.2a1 1 0 0 0 1 1h9.6a1 1 0 0 0 1-1V9.4" />
    </svg>
  );
}

export function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" {...s} width="13" height="13">
      <path d="M5.2 7h13.6M9.4 7V5.2h5.2V7M7 7l.8 12h8.4l.8-12" />
    </svg>
  );
}

export const TOOL_META: { id: ToolId; label: string; kbd: string; icon: () => React.ReactElement }[] = [
  { id: 'add', label: '添加', kbd: '1', icon: IconAdd },
  { id: 'erase', label: '橡皮', kbd: '2', icon: IconErase },
  { id: 'smooth', label: '平滑', kbd: '3', icon: IconSmooth },
  { id: 'move', label: '移动', kbd: '4', icon: IconMove },
];

export function ShapeGlyph({ id }: { id: BaseShapeId }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.35, strokeLinejoin: 'round' } as const;
  switch (id) {
    case 'sphere':
      return (
        <svg viewBox="0 0 48 48">
          <circle cx="24" cy="24" r="15" {...common} />
          <ellipse cx="24" cy="24" rx="15" ry="5.6" {...common} opacity="0.4" />
        </svg>
      );
    case 'cube':
      return (
        <svg viewBox="0 0 48 48">
          <path d="M24 9l13 7.2v15.6L24 39l-13-7.2V16.2L24 9z" {...common} />
          <path d="M11 16.2L24 23.6l13-7.4M24 23.6V39" {...common} opacity="0.4" />
        </svg>
      );
    case 'cylinder':
      return (
        <svg viewBox="0 0 48 48">
          <ellipse cx="24" cy="14" rx="10.5" ry="4.4" {...common} />
          <path d="M13.5 14v20c0 2.4 4.7 4.4 10.5 4.4s10.5-2 10.5-4.4V14" {...common} />
        </svg>
      );
    case 'capsule':
      return (
        <svg viewBox="0 0 48 48">
          <path d="M24 8.5c4.4 0 7.8 3.4 7.8 7.8v15.4c0 4.4-3.4 7.8-7.8 7.8s-7.8-3.4-7.8-7.8V16.3c0-4.4 3.4-7.8 7.8-7.8z" {...common} />
          <path d="M16.2 23.6h15.6" {...common} opacity="0.35" />
        </svg>
      );
    case 'torus':
      return (
        <svg viewBox="0 0 48 48">
          <ellipse cx="24" cy="24" rx="15" ry="9" {...common} />
          <ellipse cx="24" cy="24" rx="6.2" ry="3.1" {...common} opacity="0.45" />
        </svg>
      );
  }
}

export const SHAPE_LABELS: Record<BaseShapeId, string> = {
  sphere: '球体',
  cube: '立方体',
  cylinder: '圆柱',
  capsule: '胶囊',
  torus: '环面',
};

export const TOOL_HINTS: Record<ToolId, string> = {
  add: '左键在表面落笔堆叠体积; 拖动可拉出胶囊状笔触',
  erase: '负体积挖除; 挖除后表面自动重新闭合',
  smooth: '按住降低局部曲率; 停留越久力度越大',
  move: '点中已有笔刷后拖动, 触发局部网格重建',
  orbit: '左键旋转视角',
};
