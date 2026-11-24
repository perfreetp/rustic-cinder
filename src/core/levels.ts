import { LEVEL_DEFAULTS, type LevelState } from './constants';

export function createDefaultLevels(): LevelState[] {
  return LEVEL_DEFAULTS.map((level) => ({ ...level }));
}
