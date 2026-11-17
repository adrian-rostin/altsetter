import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ExerciseService, capOldest } from './exercise.service';
import { AltsetterApi } from './altsetter-api';
import { I18n, type Lang } from '../i18n/i18n';
import { type ExerciseDetail, type Page } from '../models/exercise.model';

function detail(id: string, over: Partial<ExerciseDetail> = {}): ExerciseDetail {
  return {
    id,
    name: id,
    description: '',
    difficulty: 'beginner',
    equipment: [],
    muscles: { primary: [{ id: 'upper-chest', name: 'Upper Chest' }], secondary: [] },
    cues: [],
    mistakes: [],
    ...over,
  };
}

function pageOf(items: ExerciseDetail[], total = items.length): Page<ExerciseDetail> {
  return { items, page: 0, size: 20, totalItems: total, totalPages: Math.ceil(total / 20) || 1 };
}

/** Minimal stand-in for the HTTP layer, so the service is tested on its own. */
class FakeApi {
  muscleExercises = vi.fn(
    (_id: string, _lang: Lang, _page: number, _size: number): Promise<Page<ExerciseDetail>> =>
      Promise.resolve(pageOf([])),
  );
  exercise = vi.fn((id: string): Promise<ExerciseDetail> => Promise.resolve(detail(id)));
  search = vi.fn();
  similar = vi.fn((): Promise<ExerciseDetail[]> => Promise.resolve([]));
}

describe('ExerciseService', () => {
  let service: ExerciseService;
  let api: FakeApi;

  beforeEach(() => {
    api = new FakeApi();
    TestBed.configureTestingModule({
      providers: [{ provide: AltsetterApi, useValue: api as unknown as AltsetterApi }],
    });
    service = TestBed.inject(ExerciseService);
  });

  describe('selecting muscles', () => {
    it('highlights all parts when a whole family is selected', () => {
      service.selectFamily('chest');
      expect(service.selectedFamily()?.id).toBe('chest');
      expect([...service.highlight().strong].sort()).toEqual([
        'lower-chest',
        'mid-chest',
        'upper-chest',
      ]);
      expect(service.highlight().soft.size).toBe(0);
    });

    it('highlights a single part strong and its siblings soft', () => {
      service.selectMuscle('upper-chest');
      expect(service.selectedMuscle()?.id).toBe('upper-chest');
      expect([...service.highlight().strong]).toEqual(['upper-chest']);
      expect([...service.highlight().soft].sort()).toEqual(['lower-chest', 'mid-chest']);
    });

    it('selects the family on the first mesh click and the part on the next', () => {
      const mesh = 'Clavicular head of pectoralis major muscle'; // upper-chest, family "chest"
      service.selectByMesh(mesh);
      expect(service.selectedFamily()?.id).toBe('chest');
      expect(service.selectedMuscle()).toBeNull();

      service.selectByMesh(mesh);
      expect(service.selectedMuscle()?.id).toBe('upper-chest');
    });

    it('selects a lone muscle for a mesh without a family', () => {
      service.selectByMesh('Serratus anterior muscle'); // serratus, familyId null
      expect(service.selectedMuscle()?.id).toBe('serratus');
      expect(service.selectedFamily()).toBeNull();
      expect(service.unknownMeshName()).toBeNull();
    });

    it('reports an unknown mesh instead of guessing', () => {
      service.selectByMesh('No such mesh in the model');
      expect(service.unknownMeshName()).toBe('No such mesh in the model');
      expect(service.selectedMuscle()).toBeNull();
    });

    it('restores a known subject, rejects an unknown one, and clears on null', () => {
      expect(service.restore('not-a-muscle')).toBe(false);
      expect(service.hasSelection()).toBe(false);

      expect(service.restore('chest')).toBe(true);
      expect(service.selectedFamily()?.id).toBe('chest');

      expect(service.restore(null)).toBe(true);
      expect(service.hasSelection()).toBe(false);
    });
  });

  describe('loading a muscle’s exercises', () => {
    it('loads the first page when a muscle is opened', async () => {
      api.muscleExercises.mockResolvedValueOnce(
        pageOf([detail('bench-press'), detail('incline-press')], 3),
      );
      service.selectMuscle('upper-chest');
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.exerciseState()).toBe('ready');
      });
      expect(service.currentList()?.ids).toEqual(['bench-press', 'incline-press']);
      expect(service.exerciseTotal()).toBe(3);
      expect(api.muscleExercises).toHaveBeenCalledWith('upper-chest', expect.any(String), 0, 20);
    });

    it('appends the next page on loadMore()', async () => {
      api.muscleExercises
        .mockResolvedValueOnce(pageOf([detail('a'), detail('b')], 3))
        .mockResolvedValueOnce(pageOf([detail('c')], 3));
      service.selectMuscle('upper-chest');
      TestBed.tick();
      await vi.waitFor(() => {
        expect(service.exerciseState()).toBe('ready');
      });

      service.loadMore();
      await vi.waitFor(() => {
        expect(service.currentList()?.ids).toEqual(['a', 'b', 'c']);
      });
      expect(api.muscleExercises).toHaveBeenLastCalledWith(
        'upper-chest',
        expect.any(String),
        1,
        20,
      );
    });

    it('shows the error state when the first page fails', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      api.muscleExercises.mockRejectedValueOnce(new Error('network down'));
      service.selectMuscle('upper-chest');
      TestBed.tick();

      await vi.waitFor(() => {
        expect(service.exerciseState()).toBe('error');
      });
    });
  });

  describe('switching language', () => {
    it('reloads the visible list but keeps the selection', async () => {
      api.muscleExercises.mockResolvedValue(pageOf([detail('bench-press')], 1));
      service.selectMuscle('upper-chest');
      TestBed.tick();
      await vi.waitFor(() => {
        expect(service.exerciseState()).toBe('ready');
      });

      const i18n = TestBed.inject(I18n);
      const other: Lang = i18n.lang() === 'de' ? 'en' : 'de';
      const before = api.muscleExercises.mock.calls.length;

      i18n.setLang(other);
      TestBed.tick();

      await vi.waitFor(() => {
        expect(api.muscleExercises.mock.calls.length).toBeGreaterThan(before);
      });
      expect(service.selectedMuscle()?.id).toBe('upper-chest');
    });
  });
});

describe('capOldest', () => {
  const sample = (): Map<string, number> =>
    new Map([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ]);

  it('drops the oldest entries to stay within the cap', () => {
    expect([...capOldest(sample(), 2, null).keys()]).toEqual(['c', 'd']);
  });

  it('never evicts the kept entry, even if it is the oldest', () => {
    const capped = capOldest(sample(), 2, 'a');
    expect(capped.size).toBe(2);
    expect([...capped.keys()]).toEqual(['a', 'd']);
  });

  it('leaves a map that is within the cap untouched', () => {
    const m = sample();
    expect(capOldest(m, 10, null)).toBe(m);
  });
});
