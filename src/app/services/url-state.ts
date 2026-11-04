import { DOCUMENT, Location } from '@angular/common';
import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { ExerciseService } from './exercise.service';

const SITE = 'Altsetter';
const ORIGIN = 'https://altsetter.adrianrostin.de';

/**
 * Keeps the address bar in sync with the selection, so a reload, a shared link or the browser's
 * back button lead to the same view. Paths are English in every language:
 *
 *   /                                 start view
 *   /muscle/<family or muscle>        e.g. /muscle/chest, /muscle/upper-chest
 *   /muscle/<…>/<exercise>            an exercise, opened from that muscle's card,
 *                                     e.g. /muscle/upper-chest/incline-barbell-bench-press
 *
 * The path segments are the ids from the API, which are the same in every language.
 * Unknown paths fall back to the start view.
 */
@Injectable({ providedIn: 'root' })
export class UrlState {
  private readonly exercises = inject(ExerciseService);
  private readonly location = inject(Location);
  private readonly title = inject(Title);
  private readonly document = inject(DOCUMENT);

  /** The URL is only written once it has been read, so the initial path isn't overwritten. */
  private restored = false;

  /** Path and page title for the current selection. */
  private readonly target = computed(() => {
    const subject = this.exercises.selectedMuscle() ?? this.exercises.selectedFamily();
    const exercise = this.exercises.openExercise()?.exercise;
    if (!subject) return { path: '/', title: SITE };
    const base = `/muscle/${subject.id}`;
    return exercise
      ? { path: `${base}/${exercise.id}`, title: `${SITE} - ${exercise.name}` }
      : { path: base, title: `${SITE} - ${subject.name}` };
  });

  constructor() {
    // Read the URL as soon as the catalog (and with it all valid ids) has arrived.
    effect(() => {
      if (this.exercises.loadState() !== 'ready' || this.restored) return;
      untracked(() => {
        this.restored = true;
        this.apply(this.location.path());
      });
    });

    // Every change of the selection becomes a history entry; going back undoes it. A language
    // switch only changes the title.
    effect(() => {
      const { path, title } = this.target();
      untracked(() => {
        if (!this.restored) return;
        if (path !== this.location.path()) this.location.go(path);
        this.title.setTitle(title);
        this.document.querySelector('link[rel="canonical"]')?.setAttribute('href', ORIGIN + path);
      });
    });

    // Back and forward buttons.
    this.location.subscribe(() => {
      if (this.restored) this.apply(this.location.path());
    });
  }

  /** Shows what a path describes; unknown paths lead to the start view. */
  private apply(url: string): void {
    const path = url.split(/[?#]/)[0];
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const [section, first, second] = [parts.at(0), parts.at(1), parts.at(2)];

    // restore() checks that the muscle and the exercise exist.
    if (section === 'muscle' && first && this.exercises.restore(first, second ?? null)) {
      return;
    }

    this.exercises.clear();
    if (path !== '/' && path !== '') this.location.replaceState('/');
  }
}
