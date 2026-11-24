<script setup lang="ts">
import { ref } from 'vue';
import { useModelStore } from '../stores/model';
import { useSessionStore } from '../stores/session';

const modelStore = useModelStore();
const session = useSessionStore();

const modelInput = ref<HTMLInputElement | null>(null);
const projectInput = ref<HTMLInputElement | null>(null);
const toast = ref('');
const toastTimer = ref(0);
const showSaved = ref(false);

function showToast(msg: string): void {
  toast.value = msg;
  window.clearTimeout(toastTimer.value);
  toastTimer.value = window.setTimeout(() => (toast.value = ''), 3200);
}

async function onModelFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    await modelStore.importModel(file);
    session.setFrame(0);
    showToast(
      `导入完成:${modelStore.partCount.toLocaleString()} 个零件、` +
        `${modelStore.jointCount} 个可动关节`,
    );
    if (modelStore.warnings.length) showToast(modelStore.warnings[0]);
  } catch (err) {
    showToast(`导入失败:${(err as Error).message}`);
  }
  input.value = '';
}

async function onProjectFile(e: Event): Promise<void> {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const warns = await session.importProjectFile(file);
    showToast(warns.length ? warns[0] : '工况文件已载入');
  } catch (err) {
    showToast(`载入失败:${(err as Error).message}`);
  }
  input.value = '';
}

async function save(): Promise<void> {
  try {
    await session.saveCurrent();
    showToast(`工况已保存到浏览器本地(共 ${session.savedProjects.length} 条记录)`);
  } catch (err) {
    console.error('保存工况失败', err);
    showToast(`保存失败:${(err as Error).message}`);
  }
}

function exportFile(): void {
  session.exportFile();
  showToast('工况文件已导出,可发送给他人重新载入');
}

async function openSaved(): Promise<void> {
  await session.refreshProjectList();
  showSaved.value = true;
}

async function loadSaved(id: string): Promise<void> {
  try {
    await session.loadSaved(id);
    showSaved.value = false;
    showToast('本地工程已载入');
  } catch (err) {
    showToast(`载入失败:${(err as Error).message}`);
  }
}

async function removeSaved(id: string): Promise<void> {
  await session.deleteSaved(id);
}
</script>

<template>
  <header class="topbar">
    <div class="brand">
      <span class="logo">⚙</span>
      <span class="title">产线故障工况可视化工作台</span>
    </div>

    <div class="actions">
      <button class="primary" @click="modelInput?.click()">导入模型</button>
      <input
        ref="modelInput"
        type="file"
        accept=".glb,.gltf,.obj,.stl"
        hidden
        @change="onModelFile"
      />

      <button :disabled="!modelStore.hasModel" @click="save">保存到本地</button>
      <button :disabled="!modelStore.hasModel" @click="openSaved">本地工程</button>
      <button :disabled="!modelStore.hasModel" @click="exportFile">导出工况</button>
      <button @click="projectInput?.click()">载入工况</button>
      <input
        ref="projectInput"
        type="file"
        accept=".json,.lfsproj.json"
        hidden
        @change="onProjectFile"
      />

      <button
        v-if="modelStore.hasModel"
        class="ghost"
        title="卸载当前模型"
        @click="modelStore.unload()"
      >
        卸载
      </button>
    </div>

    <div v-if="toast" class="toast">{{ toast }}</div>

    <div v-if="showSaved" class="modal-mask" @click.self="showSaved = false">
      <div class="modal">
        <div class="modal-head">
          <span>浏览器本地保存的工况工程</span>
          <button class="ghost" @click="showSaved = false">关闭</button>
        </div>
        <div v-if="session.savedProjects.length === 0" class="muted empty">
          暂无保存记录
        </div>
        <div v-else class="saved-list">
          <div v-for="p in session.savedProjects" :key="p.id" class="saved-row">
            <div class="saved-meta">
              <div class="saved-name">{{ p.name }}</div>
              <div class="muted">
                {{ p.modelFileName }} · {{ new Date(p.updatedAt).toLocaleString() }}
              </div>
            </div>
            <div class="saved-btns">
              <button @click="loadSaved(p.id)">载入</button>
              <button class="ghost danger" @click="removeSaved(p.id)">删除</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </header>
</template>

<style scoped>
.topbar {
  flex: none;
  height: 52px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--bg-1);
  border-bottom: 1px solid var(--line);
}

.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo {
  font-size: 20px;
}

.title {
  font-weight: 700;
  letter-spacing: 0.5px;
}

.actions {
  display: flex;
  gap: 8px;
  margin-left: 12px;
}

.toast {
  position: fixed;
  top: 62px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--bg-3);
  border: 1px solid var(--accent);
  border-radius: 8px;
  padding: 8px 16px;
  z-index: 100;
  max-width: 60vw;
}

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.55);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 90;
}

.modal {
  width: 560px;
  max-height: 70vh;
  background: var(--bg-1);
  border: 1px solid var(--line);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
}

.modal-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 16px;
  border-bottom: 1px solid var(--line);
  font-weight: 600;
}

.saved-list {
  padding: 8px 16px 16px;
  overflow: auto;
}

.empty {
  padding: 28px;
  text-align: center;
}

.saved-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 4px;
  border-bottom: 1px solid var(--line);
}

.saved-name {
  font-weight: 600;
  margin-bottom: 2px;
}

.saved-btns {
  display: flex;
  gap: 6px;
}

.danger {
  color: var(--danger);
}
</style>
