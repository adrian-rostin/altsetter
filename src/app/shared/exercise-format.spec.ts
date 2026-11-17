import { describe, it, expect } from 'vitest';
import { type Difficulty, type Equipment } from '../models/exercise.model';
import { difficultyClass, equipmentLabel, meshLabel } from './exercise-format';

describe('difficultyClass', () => {
  it('gives each difficulty its own, non-empty class set', () => {
    const classes = (['beginner', 'intermediate', 'advanced'] as Difficulty[]).map(difficultyClass);
    for (const c of classes) expect(c.length).toBeGreaterThan(0);
    expect(new Set(classes).size).toBe(3);
  });
});

describe('equipmentLabel', () => {
  const eq = (name: string): Equipment => ({ id: name.toLowerCase(), name });

  it('joins equipment names with a comma', () => {
    expect(equipmentLabel([eq('Barbell'), eq('Flat Bench')])).toBe('Barbell, Flat Bench');
  });

  it('is empty for no equipment', () => {
    expect(equipmentLabel([])).toBe('');
  });
});

describe('meshLabel', () => {
  it('turns a model mesh name into readable text', () => {
    expect(meshLabel('Long_head_of_biceps_femoris_left')).toBe('Long head of biceps femoris left');
    expect(meshLabel('Serratus anterior muscle')).toBe('Serratus anterior muscle');
  });
});
