import { type Difficulty, type Equipment } from '../models/exercise.model';

const DIFFICULTY_CLASS: Record<Difficulty, string> = {
  beginner: 'border-accent/30 bg-accent/10 text-accent-bright',
  intermediate: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
  advanced: 'border-rose-500/30 bg-rose-500/10 text-rose-300',
};

/** Tailwind classes for the difficulty badge. */
export function difficultyClass(difficulty: Difficulty): string {
  return DIFFICULTY_CLASS[difficulty];
}

/** "Barbell, Flat Bench" */
export function equipmentLabel(equipment: readonly Equipment[]): string {
  return equipment.map((e) => e.name).join(', ');
}

/** Readable name of a model mesh: "Long_head_of_biceps_femoris_left" -> "Long head of biceps femoris left". */
export function meshLabel(meshName: string): string {
  return meshName.replace(/[._-]+/g, ' ').trim();
}
