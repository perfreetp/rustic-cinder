import {
  IDB_NAME,
  IDB_STORE_MODELS,
  IDB_STORE_PROJECTS,
  IDB_VERSION,
} from '../constants';
import type { ProjectFile, SavedProject } from '../types';

/**
 * 本地持久化:
 *  - models 库: 原始模型文件 Blob(按指纹),避免重复导入
 *  - projects 库: 工况配置(JSON),自动保存最近工程
 * 全部数据保存在浏览器本地,不上传任何服务。
 */
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_PROJECTS)) {
        db.createObjectStore(IDB_STORE_PROJECTS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(IDB_STORE_MODELS)) {
        db.createObjectStore(IDB_STORE_MODELS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.oncomplete = () => db.close();
      }),
  );
}

export const storage = {
  async listProjects(): Promise<SavedProject[]> {
    const all = await tx<SavedProject[]>(IDB_STORE_PROJECTS, 'readonly', (s) =>
      s.getAll() as IDBRequest<SavedProject[]>,
    );
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  async saveProject(p: SavedProject): Promise<void> {
    // Pinia/Vue 代理对象无法被结构化克隆,存储边界做纯对象解包
    const plain: SavedProject = JSON.parse(JSON.stringify(p));
    await tx(IDB_STORE_PROJECTS, 'readwrite', (s) => s.put(plain));
  },

  async deleteProject(id: string): Promise<void> {
    await tx(IDB_STORE_PROJECTS, 'readwrite', (s) => s.delete(id));
  },

  async putModel(fingerprint: string, blob: Blob): Promise<void> {
    await tx(IDB_STORE_MODELS, 'readwrite', (s) => s.put(blob, fingerprint));
  },

  async getModel(fingerprint: string): Promise<Blob | undefined> {
    return tx<Blob | undefined>(IDB_STORE_MODELS, 'readonly', (s) =>
      s.get(fingerprint) as IDBRequest<Blob | undefined>,
    );
  },

  async hasModel(fingerprint: string): Promise<boolean> {
    const v = await this.getModel(fingerprint);
    return v !== undefined;
  },
};

/** 计算模型文件指纹(名称 + 大小,读前 64KB 做轻量校验和) */
export async function modelFingerprint(file: File | Blob, name: string): Promise<string> {
  const slice = file.slice(0, 65536);
  const buf = await slice.arrayBuffer();
  let hash = 5381;
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i++) {
    hash = ((hash << 5) + hash + bytes[i]) | 0;
  }
  return `${encodeURIComponent(name)}::${file.size}::${(hash >>> 0).toString(16)}`;
}

/** 下载工程 JSON 文件(用于分享) */
export function downloadProjectFile(data: ProjectFile): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${data.name || '工况工程'}.lfsproj.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
