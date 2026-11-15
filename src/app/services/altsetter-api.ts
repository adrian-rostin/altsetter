import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { type Lang } from '../i18n/i18n';
import {
  type ExerciseDetail,
  type ExerciseSummary,
  type List,
  type Page,
} from '../models/exercise.model';

/** Same origin as the app: in production via the ingress, locally via the dev-server proxy. */
const API = '/api/v1';

/**
 * Typed access to the Altsetter API, which delivers the exercises (the muscles live in the app),
 * only what is needed: a muscle's exercises page by page, single ones for search, similar
 * exercises and links. Every call names the language of the texts; the API answers with
 * `Vary: Accept-Language`, so the browser caches each language separately.
 */
@Injectable({ providedIn: 'root' })
export class AltsetterApi {
  private readonly http = inject(HttpClient);

  exercise(id: string, lang: Lang): Promise<ExerciseDetail> {
    return this.get<ExerciseDetail>(`/exercises/${encodeURIComponent(id)}`, lang);
  }

  /**
   * One page of the exercises of a muscle or muscle family (as primary or working along), with
   * everything for their pages, in the order of the app's card: per part its main exercises, then
   * the ones a part only works along in. Opening a muscle loads the first page, scrolling the rest.
   */
  muscleExercises(
    muscleOrFamilyId: string,
    lang: Lang,
    page: number,
    size: number,
  ): Promise<Page<ExerciseDetail>> {
    const id = encodeURIComponent(muscleOrFamilyId);
    return this.get<Page<ExerciseDetail>>(
      `/muscles/${id}/exercises?page=${page}&size=${size}`,
      lang,
    );
  }

  /**
   * One page of all exercises matching a search input, best first (name start, word starts,
   * muscles, …); `totalItems` tells how many there are in all.
   */
  search(query: string, lang: Lang, page = 0, size = 20): Promise<Page<ExerciseSummary>> {
    const path = `/exercises/search?q=${encodeURIComponent(query)}&page=${page}&size=${size}`;
    return this.get<Page<ExerciseSummary>>(path, lang);
  }

  /** Up to five exercises training the same muscles, most similar first; fewer if none fit. */
  async similar(id: string, lang: Lang): Promise<ExerciseSummary[]> {
    const path = `/exercises/${encodeURIComponent(id)}/similar`;
    return (await this.get<List<ExerciseSummary>>(path, lang)).items;
  }

  private get<T>(path: string, lang: Lang): Promise<T> {
    return firstValueFrom(this.http.get<T>(API + path, { headers: { 'Accept-Language': lang } }));
  }
}
