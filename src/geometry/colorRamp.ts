// 曲率 → 张力 → 色带映射（蓝-青-绿-黄-红）

export type RGB = [number, number, number];

const RAMP: ReadonlyArray<[number, RGB]> = [
  [0.0, [0.17, 0.31, 1.0]], // 深蓝：低张力
  [0.25, [0.0, 0.83, 1.0]], // 青
  [0.5, [0.24, 0.86, 0.52]], // 绿
  [0.75, [1.0, 0.82, 0.0]], // 黄
  [1.0, [1.0, 0.23, 0.19]], // 红：高张力
];

export function tensionColor(t: number, out: RGB): RGB {
  const x = Math.min(Math.max(t, 0), 1);
  for (let i = 1; i < RAMP.length; i++) {
    if (x <= RAMP[i][0]) {
      const [t0, c0] = RAMP[i - 1];
      const [t1, c1] = RAMP[i];
      const f = (x - t0) / (t1 - t0);
      out[0] = c0[0] + (c1[0] - c0[0]) * f;
      out[1] = c0[1] + (c1[1] - c0[1]) * f;
      out[2] = c0[2] + (c1[2] - c0[2]) * f;
      return out;
    }
  }
  const last = RAMP[RAMP.length - 1][1];
  out[0] = last[0];
  out[1] = last[1];
  out[2] = last[2];
  return out;
}

/** 张力色带刻度（供图例 UI 使用） */
export const RAMP_STOPS: ReadonlyArray<{ at: number; css: string }> = RAMP.map(([at, c]) => ({
  at,
  css: `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`,
}));
