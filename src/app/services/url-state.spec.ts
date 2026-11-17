import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { UrlState } from './url-state';
import { ExerciseService } from './exercise.service';
import { AltsetterApi } from './altsetter-api';
import { type Lang } from '../i18n/i18n';
import { type ExerciseDetail, type Page } from '../models/exercise.model';

class FakeApi {
  muscleExercises = vi.fn(
    (_id: string, _lang: Lang, _page: number, _size: number): Promise<Page<ExerciseDetail>> =>
      Promise.resolve({ items: [], page: 0, size: 20, totalItems: 0, totalPages: 1 }),
  );
  exercise = vi.fn();
  search = vi.fn();
  similar = vi.fn((): Promise<ExerciseDetail[]> => Promise.resolve([]));
}

describe('UrlState', () => {
  let location: Location;
  let exercises: ExerciseService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideLocationMocks(),
        { provide: AltsetterApi, useValue: new FakeApi() as unknown as AltsetterApi },
      ],
    });
    location = TestBed.inject(Location);
    exercises = TestBed.inject(ExerciseService);
  });

  it('restores a muscle from the path on start', async () => {
    location.go('/muscle/chest');
    TestBed.inject(UrlState); // reads the path in its constructor

    await vi.waitFor(() => {
      expect(exercises.selectedFamily()?.id).toBe('chest');
    });
  });

  it('falls back to the start view for an unknown path', async () => {
    location.go('/muscle/does-not-exist');
    TestBed.inject(UrlState);

    TestBed.tick();
    await vi.waitFor(() => {
      expect(exercises.hasSelection()).toBe(false);
    });
  });

  it('writes the path when the selection changes', async () => {
    TestBed.inject(UrlState);
    TestBed.tick(); // let the initial read finish (restored = true)

    exercises.selectFamily('biceps');
    await vi.waitFor(() => {
      expect(location.path()).toBe('/muscle/biceps');
    });
  });
});
