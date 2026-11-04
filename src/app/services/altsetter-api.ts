import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { type Lang } from '../i18n/i18n';
import {
  type ExerciseDetail,
  type ExerciseSummary,
  type List,
  type Muscle,
  type MuscleFamily,
  type Page,
} from '../models/exercise.model';

/** Same origin as the app: in production via the ingress, locally via the dev-server proxy. */
const API = '/api/v1';
/** Largest page the API allows; all exercises fit in very few pages. */
const PAGE_SIZE = 100;

/** Everything the app needs up front: muscles for the 3D model and all exercises for the lists. */
export interface Catalog {
  families: MuscleFamily[];
  muscles: Muscle[];
  exercises: ExerciseSummary[];
}

/**
 * Typed access to the Altsetter API. Every call names the language of the texts; the API answers
 * with `Vary: Accept-Language`, so the browser caches each language separately.
 */
@Injectable({ providedIn: 'root' })
export class AltsetterApi {
  private readonly http = inject(HttpClient);

  async catalog(lang: Lang): Promise<Catalog> {
    const [families, muscles, exercises] = await Promise.all([
      this.get<List<MuscleFamily>>('/muscle-families', lang),
      this.get<List<Muscle>>('/muscles', lang),
      this.allExercises(lang),
    ]);
    return { families: families.items, muscles: muscles.items, exercises };
  }

  exercise(id: string, lang: Lang): Promise<ExerciseDetail> {
    return this.get<ExerciseDetail>(`/exercises/${encodeURIComponent(id)}`, lang);
  }

  private async allExercises(lang: Lang): Promise<ExerciseSummary[]> {
    const first = await this.page(0, lang);
    const rest = await Promise.all(
      Array.from({ length: first.totalPages - 1 }, (_, i) => this.page(i + 1, lang)),
    );
    return [first, ...rest].flatMap((p) => p.items);
  }

  private page(page: number, lang: Lang): Promise<Page<ExerciseSummary>> {
    return this.get<Page<ExerciseSummary>>(`/exercises?page=${page}&size=${PAGE_SIZE}`, lang);
  }

  private get<T>(path: string, lang: Lang): Promise<T> {
    return firstValueFrom(this.http.get<T>(API + path, { headers: { 'Accept-Language': lang } }));
  }
}
