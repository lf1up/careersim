import { SimulationDifficulty } from '../types/index';

// Map each difficulty to a unique RetroBadge color
export const difficultyToBadgeColor = (difficulty: SimulationDifficulty) => {
  switch (difficulty) {
    case SimulationDifficulty.BEGINNER:
      return 'green';
    case SimulationDifficulty.INTERMEDIATE:
      return 'blue';
    case SimulationDifficulty.ADVANCED:
      return 'purple';
    case SimulationDifficulty.EXPERT:
      return 'red';
    case SimulationDifficulty.MASTER:
      return 'indigo';
    default:
      return 'default';
  }
};

// Predefined palette to assign unique colors to categories deterministically
const categoryPalette = [
  'amber', 'cyan', 'teal', 'pink', 'lime', 'indigo', 'orange', 'purple', 'blue', 'rose', 'yellow', 'green',
] as const;

export type RetroBadgeColor =
  | 'default' | 'yellow' | 'cyan' | 'green' | 'red' | 'blue' | 'purple' | 'orange' | 'pink' | 'lime' | 'teal' | 'indigo' | 'amber' | 'rose';

// Hash category name to a color from the palette so each is stable and unique-ish
export const categoryNameToBadgeColor = (name: string): RetroBadgeColor => {
  if (!name) return 'default';
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash << 5) - hash + name.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % categoryPalette.length;
  if (!Number.isInteger(index) || index < 0 || index >= categoryPalette.length) {
    return 'default';
  }
  const color = categoryPalette.slice(index, index + 1)[0];
  return (color as RetroBadgeColor | undefined) ?? 'default';
};

export const getDifficultyLabel = (difficulty: SimulationDifficulty): string => {
  switch (difficulty) {
    case SimulationDifficulty.BEGINNER:
      return 'Beginner';
    case SimulationDifficulty.INTERMEDIATE:
      return 'Intermediate';
    case SimulationDifficulty.ADVANCED:
      return 'Advanced';
    case SimulationDifficulty.EXPERT:
      return 'Expert';
    case SimulationDifficulty.MASTER:
      return 'Master';
    default:
      return 'Unknown';
  }
};


