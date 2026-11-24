import { useSyncExternalStore } from 'react';
import {
  DEFAULT_KITE_PARAMS,
  DEFAULT_WIND,
  type KiteParams,
  type WindState,
} from './types';

export interface AppState {
  params: KiteParams;
  wind: WindState;
  /** 张力染色开关 */
  showTension: boolean;
  /** 线框模式 */
  wireframe: boolean;
  /** 自动环绕演示 */
  autoRotate: boolean;
}

const initialState: AppState = {
  params: { ...DEFAULT_KITE_PARAMS, twistStations: [...DEFAULT_KITE_PARAMS.twistStations] },
  wind: { ...DEFAULT_WIND },
  showTension: true,
  wireframe: false,
  autoRotate: false,
};

let state: AppState = initialState;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getState(): AppState {
  return state;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** React 组件用：订阅切片，只在切片变化时重渲染 */
export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

/** 高频写入（拖拽 / 每帧循环）直接改对象，不产生新引用 */
export function setWind(patch: Partial<WindState>): void {
  Object.assign(state.wind, patch);
  emit();
}

export function setParams(patch: Partial<KiteParams>): void {
  Object.assign(state.params, patch);
  emit();
}

export function setTwistStation(index: number, value: number): void {
  const next = [...state.params.twistStations] as KiteParams['twistStations'];
  next[index] = value;
  state.params.twistStations = next;
  emit();
}

export function setFlags(patch: Partial<Pick<AppState, 'showTension' | 'wireframe' | 'autoRotate'>>): void {
  Object.assign(state, patch);
  emit();
}

export function replaceAll(next: AppState): void {
  state = {
    params: { ...next.params, twistStations: [...next.params.twistStations] },
    wind: { ...next.wind },
    showTension: next.showTension,
    wireframe: next.wireframe,
    autoRotate: next.autoRotate,
  };
  emit();
}

export function resetAll(): void {
  replaceAll(initialState);
}

/** 供动画循环订阅（不经过 React） */
export function onStateChange(l: () => void): () => void {
  return subscribe(l);
}
