import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { type Lang } from '../i18n/i18n';
import { type ExerciseDetail, type ExerciseSummary, type Page } from '../models/exercise.model';

/** Same origin as the app: in production via the ingress, locally via the dev-server proxy. */
const API = '/api/v1';
/** Largest page the API allows; all exercises fit in very few pages. */
const PAGE_SIZE = 100;

/**
 * Typed access to the Altsetter API, which delivers the exercises (the muscles live in the app).
 * Every call names the language of the texts; the API answers with `Vary: Accept-Language`, so
 * the browser caches each language separately.
 */
@Injectable({ providedIn: 'root' })
export class AltsetterApi {
  private readonly http = inject(HttpClient);

  /** All exercises, sorted by name. */
  async exercises(lang: Lang): Promise<ExerciseSummary[]> {
    const first = await this.page(0, lang);
    const rest = await Promise.all(
      Array.from({ length: first.totalPages - 1 }, (_, i) => this.page(i + 1, lang)),
    );
    return [first, ...rest].flatMap((p) => p.items);
  }

  exercise(id: string, lang: Lang): Promise<ExerciseDetail> {
    return this.get<ExerciseDetail>(`/exercises/${encodeURIComponent(id)}`, lang);
  }

  private page(page: number, lang: Lang): Promise<Page<ExerciseSummary>> {
    return this.get<Page<ExerciseSummary>>(`/exercises?page=${page}&size=${PAGE_SIZE}`, lang);
  }

  private get<T>(path: string, lang: Lang): Promise<T> {
    return firstValueFrom(this.http.get<T>(API + path, { headers: { 'Accept-Language': lang } }));
  }
}
