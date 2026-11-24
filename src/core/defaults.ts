import type { AppConfig, ProfilePoint } from './types.ts';

/** 默认母线：典型的鼓形/收腰灯罩轮廓（r, z，单位 mm，z 升序） */
export function defaultProfilePoints(): ProfilePoint[] {
  return [
    { r: 55, z: 0 },
    { r: 78, z: 35 },
    { r: 88, z: 90 },
    { r: 82, z: 150 },
    { r: 62, z: 200 },
    { r: 48, z: 225 },
  ];
}

export function defaultConfig(): AppConfig {
  return {
    version: 1,
    profile: {
      points: defaultProfilePoints(),
      samples: 220,
    },
    weave: {
      stripWidth: 4,
      stripThickness: 1.5,
      familyCount: 64,
      helixAngle: 45,
      turns: 0,
      spacingFactor: 1,
      pattern: 'plain',
      clearance: 0.15,
    },
    lighting: {
      mode: 'side',
      sideAngle: 35,
      sideIntensity: 1.6,
      backIntensity: 2.2,
      ambient: 0.35,
      gloss: 0.85,
      opacity: 0.96,
      color: '#c9a063',
      showSurface: false,
      showProfile: true,
    },
    quality: {
      segments: 96,
    },
  };
}

export const LIMITS = {
  stripWidth: { min: 2, max: 8, step: 0.1 },
  stripThickness: { min: 1, max: 3, step: 0.05 },
  familyCount: { min: 8, max: 1000, step: 1 },
  helixAngle: { min: 20, max: 70, step: 1 },
  spacingFactor: { min: 0.8, step: 0.01, max: 1.4 },
  clearance: { min: 0, max: 1, step: 0.01 },
  segments: { min: 24, max: 200, step: 4 },
} as const;
