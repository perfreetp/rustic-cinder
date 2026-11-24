import type { ImportedTrajectory, PoseKey, ProjectData, TrajectoryKey } from "./types";

/** 工程文件导出:轨迹点 + 姿态关键帧 + fps,一个 JSON 文件全部带走 */
export function exportProject(
  trajectoryKeys: TrajectoryKey[],
  poseKeys: PoseKey[],
  fps: number,
): string {
  const data: ProjectData = {
    format: "kite-air-pose-studio",
    version: 1,
    fps,
    trajectoryKeys: [...trajectoryKeys].sort((a, b) => a.frame - b.frame),
    poseKeys: [...poseKeys].sort((a, b) => a.frame - b.frame),
  };
  return JSON.stringify(data, null, 2);
}

export function parseProject(text: string): ProjectData {
  const data = JSON.parse(text) as Partial<ProjectData>;
  if (data.format !== "kite-air-pose-studio") {
    throw new Error("不是本工作室的工程文件(缺少 format 标识)");
  }
  if (!Array.isArray(data.trajectoryKeys) || data.trajectoryKeys.length < 2) {
    throw new Error("工程文件中轨迹关键点不足 2 个");
  }
  return {
    format: "kite-air-pose-studio",
    version: data.version ?? 1,
    fps: data.fps ?? 30,
    trajectoryKeys: data.trajectoryKeys.map(normalizeTrajKey),
    poseKeys: Array.isArray(data.poseKeys) ? data.poseKeys : [],
  };
}

/** 解析导入内容:支持完整工程 JSON、裸轨迹 JSON、CSV */
export function parseTrajectoryInput(text: string): ImportedTrajectory {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const obj = JSON.parse(trimmed) as Record<string, unknown>;
    if (obj.format === "kite-air-pose-studio") {
      const proj = obj as unknown as ProjectData;
      return { trajectoryKeys: proj.trajectoryKeys, fps: proj.fps };
    }
    const raw = pickArray(obj, ["trajectoryKeys", "keys", "points", "data"]);
    if (raw) return { trajectoryKeys: raw.map(normalizeTrajKey), fps: numField(obj, "fps") };
    throw new Error("JSON 中未找到轨迹点数组(可用键:trajectoryKeys/keys/points/data)");
  }
  if (trimmed.startsWith("[")) {
    const raw = JSON.parse(trimmed) as unknown[];
    if (!Array.isArray(raw) || raw.length === 0) throw new Error("JSON 数组为空");
    return { trajectoryKeys: raw.map(normalizeTrajKey) };
  }
  return { trajectoryKeys: parseCsv(trimmed) };
}

function parseCsv(text: string): TrajectoryKey[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV 至少需要表头 + 一行数据");
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const idx = (names: string[]): number => {
    for (const name of names) {
      const i = header.indexOf(name);
      if (i >= 0) return i;
    }
    return -1;
  };
  const iFrame = idx(["frame", "帧", "f"]);
  const iH = idx(["height", "h", "高度"]);
  const iD = idx(["distance", "d", "x", "水平位移", "位移"]);
  const iL = idx(["lateral", "y", "侧向", "漂移"]);
  const iK = idx(["kiteheading", "heading", "kite", "伞翼朝向", "朝向"]);
  if (iH < 0 || iD < 0) throw new Error("CSV 表头必须包含 height 与 distance 列");

  return lines.slice(1).map((line, row) => {
    const c = line.split(",").map((v) => v.trim());
    const num = (i: number, fallback = 0): number => {
      if (i < 0) return fallback;
      const v = parseFloat(c[i]);
      return Number.isFinite(v) ? v : fallback;
    };
    return normalizeTrajKey({
      frame: iFrame >= 0 ? num(iFrame, row * 10) : row * 10,
      height: num(iH),
      distance: num(iD),
      lateral: num(iL),
      kiteHeading: num(iK),
    });
  });
}

function normalizeTrajKey(raw: unknown): TrajectoryKey {
  const o = (raw ?? {}) as Record<string, unknown>;
  const num = (v: unknown, fallback = 0): number => {
    const n = typeof v === "string" ? parseFloat(v) : (v as number);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    frame: Math.round(num(o.frame, 0)),
    height: num(o.height),
    distance: num(o.distance),
    lateral: num(o.lateral),
    kiteHeading: num(o.kiteHeading),
  };
}

function pickArray(obj: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const k of keys) {
    if (Array.isArray(obj[k])) return obj[k] as unknown[];
  }
  return null;
}

function numField(obj: Record<string, unknown>, key: string): number | undefined {
  const v = obj[key];
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

export function downloadTextFile(filename: string, text: string, mime = "application/json"): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
