import { createStore } from 'solid-js/store';
import { createEffect } from 'solid-js';
import type { DaylightMark, RoomConfig, WindowConfig } from './types';
import { CITIES } from './cities';

export interface AppState {
  room: RoomConfig;
  windows: WindowConfig[];
  cityIndex: number;
  /** 日期 yyyy-mm-dd */
  date: string;
  /** 模拟时刻(小时,6~18) */
  time: number;
  /** 采光不足阈值(lux) */
  threshold: number;
  marks: DaylightMark[];
  /** 是否处于框选标记模式 */
  markMode: boolean;
  /** 时间自动播放 */
  playing: boolean;
  selectedWindowId: string | null;
  /** 点云加载状态提示 */
  pointCloudStatus: string;
}

const STORAGE_KEY = 'daylight-sim-v1';

function today(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function defaultState(): AppState {
  return {
    room: { width: 6, depth: 5, height: 2.8, pointCloudUrl: '' },
    windows: [
      {
        id: 'w1',
        wall: 'south',
        offset: 0,
        width: 1.8,
        height: 1.5,
        sill: 0.9,
        mullionsX: 1,
        mullionsY: 1,
        frameWidth: 0.05,
        softness: 0.35,
      },
    ],
    cityIndex: 0,
    date: today(),
    time: 10,
    threshold: 300,
    marks: [],
    markMode: false,
    playing: false,
    selectedWindowId: null,
    pointCloudStatus: '',
  };
}

function loadState(): AppState {
  const base = defaultState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    return {
      ...base,
      ...saved,
      room: { ...base.room, ...(saved.room ?? {}) },
      playing: false,
      markMode: false,
      pointCloudStatus: '',
    };
  } catch {
    return base;
  }
}

export const [state, setState] = createStore<AppState>(loadState());

// 房间 / 窗户 / 标记等数据持久化到浏览器
let saveTimer: number | undefined;
createEffect(() => {
  const snapshot = {
    room: state.room,
    windows: state.windows,
    cityIndex: state.cityIndex,
    date: state.date,
    time: state.time,
    threshold: state.threshold,
    marks: state.marks,
  };
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      /* 存储满时忽略 */
    }
  }, 300);
});

export function currentCity() {
  return CITIES[state.cityIndex] ?? CITIES[0];
}

let idCounter = 0;
export function nextId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${(idCounter++).toString(36)}`;
}
