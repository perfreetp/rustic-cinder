import { useSyncExternalStore } from 'react';
import type {
  AppConfig,
  PageId,
  ProfileSampleResponse,
  WeaveResponse,
  WeaveStats,
} from './types.ts';
import { defaultConfig } from './defaults.ts';
import { buildWeave } from './weave.ts';

/**
 * 应用 store：配置状态 + Worker 调度。
 * - 配置变更按 120ms 防抖重建；母线拖拽期间使用低 LOD，松手后全量重建。
 * - requestId 单调递增，过期响应直接丢弃，避免乱序覆盖。
 * - Worker 不可用时回退到主线程同步计算（保证环境兼容性）。
 */

export type BuildStatus = 'idle' | 'building' | 'ready' | 'error';

export interface AppState {
  config: AppConfig;
  page: PageId;
  status: BuildStatus;
  stats: WeaveStats | null;
  lastResponse: WeaveResponse | null;
  lowQuality: boolean;
  errorMessage: string | null;
}

type Listener = () => void;

const STORAGE_KEY = 'bamboo-lampshade-config-v1';

function initialConfig(): AppConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppConfig;
      if (parsed.version === 1 && parsed.profile?.points?.length > 1) return parsed;
    }
  } catch {
    /* ignore */
  }
  return defaultConfig();
}

class AppStore {
  private state: AppState = {
    config: initialConfig(),
    page: 'profile',
    status: 'idle',
    stats: null,
    lastResponse: null,
    lowQuality: false,
    errorMessage: null,
  };
  private listeners = new Set<Listener>();
  private worker: Worker | null = null;
  private requestId = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingLowQuality = false;

  constructor() {
    try {
      this.worker = new Worker(new URL('./weaveWorker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (ev: MessageEvent<WeaveResponse | ProfileSampleResponse | { error: string }>) => {
        const data = ev.data;
        if ('error' in data) {
          this.setState({ status: 'error', errorMessage: data.error });
          return;
        }
        if ('familyA' in data) {
          if (data.requestId !== this.requestId) return; // 过期响应
          this.setState({
            status: 'ready',
            stats: data.stats,
            lastResponse: data,
            lowQuality: this.pendingLowQuality,
            errorMessage: null,
          });
        }
      };
      this.worker.onerror = (e) => {
        this.setState({ status: 'error', errorMessage: e.message || 'Worker 运行错误' });
      };
    } catch {
      this.worker = null;
    }
  }

  getState = (): AppState => this.state;

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  private setState(patch: Partial<AppState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }

  private persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state.config));
    } catch {
      /* ignore */
    }
  }

  setPage(page: PageId) {
    this.setState({ page });
  }

  /** 局部更新配置并调度重建 */
  updateConfig(patch: Partial<AppConfig>, lowQuality = false) {
    const config: AppConfig = {
      ...this.state.config,
      ...patch,
      profile: { ...this.state.config.profile, ...(patch.profile ?? {}) },
      weave: { ...this.state.config.weave, ...(patch.weave ?? {}) },
      lighting: { ...this.state.config.lighting, ...(patch.lighting ?? {}) },
      quality: { ...this.state.config.quality, ...(patch.quality ?? {}) },
    };
    this.setState({ config });
    this.persist();
    this.scheduleRebuild(lowQuality);
  }

  updateProfile(points: AppConfig['profile']['points'], lowQuality = false) {
    this.updateConfig({ profile: { ...this.state.config.profile, points } }, lowQuality);
  }

  /** 拖拽结束：全量高精度重建 */
  flushFullQuality() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.pendingLowQuality = false;
    this.dispatchBuild(false);
  }

  private scheduleRebuild(lowQuality: boolean) {
    this.pendingLowQuality = lowQuality;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.dispatchBuild(lowQuality);
    }, lowQuality ? 60 : 120);
  }

  private dispatchBuild(lowQuality: boolean) {
    const { config } = this.state;
    const id = ++this.requestId;
    const segments = lowQuality
      ? Math.max(24, Math.round(config.quality.segments * 0.45))
      : config.quality.segments;
    this.setState({ status: 'building', lowQuality });

    if (this.worker) {
      this.worker.postMessage({
        requestId: id,
        profile: config.profile,
        weave: config.weave,
        segments,
      });
    } else {
      // 主线程回退
      setTimeout(() => {
        try {
          const built = buildWeave(config.profile, config.weave, segments);
          if (id !== this.requestId) return;
          const resp: WeaveResponse = {
            requestId: id,
            familyA: built.familyA,
            familyB: built.familyB,
            stats: built.stats,
          };
          this.setState({ status: 'ready', stats: resp.stats, lastResponse: resp, errorMessage: null });
        } catch (err) {
          this.setState({ status: 'error', errorMessage: err instanceof Error ? err.message : String(err) });
        }
      }, 0);
    }
  }

  /** 载入完整配置（导入文件） */
  loadConfig(config: AppConfig) {
    this.setState({ config });
    this.persist();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.dispatchBuild(false);
  }

  dispose() {
    this.worker?.terminate();
  }
}

export const appStore = new AppStore();

export function useAppState<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    appStore.subscribe,
    () => selector(appStore.getState()),
    () => selector(appStore.getState()),
  );
}
