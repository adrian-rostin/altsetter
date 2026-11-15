import { DOCUMENT, Location } from '@angular/common';
import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
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
 *   /exercises/<exercise>             an open exercise, e.g. /exercises/landmine-press; opened from
 *                                     a link it appears under its first main muscle
 *   /muscle/<…>/<exercise>            older exercise links; still read, then shown as /exercises/…
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
  private readonly restored = signal(false);
  /** Counts apply() calls, so a slow one (an exercise still loading) can't undo a newer one. */
  private applied = 0;

  /** Path and page title for the current selection. */
  private readonly target = computed(() => {
    const subject = this.exercises.selectedMuscle() ?? this.exercises.selectedFamily();
    const exercise = this.exercises.openExercise()?.exercise;
    if (exercise) return { path: `/exercises/${exercise.id}`, title: `${SITE} - ${exercise.name}` };
    if (!subject) return { path: '/', title: SITE };
    return { path: `/muscle/${subject.id}`, title: `${SITE} - ${subject.name}` };
  });

  constructor() {
    // Read the URL right away: muscles are in the app, an exercise in the URL loads on its own.
    // Until then the URL stays as it is.
    void this.apply(this.location.path()).then(() => {
      this.restored.set(true);
    });

    // Every change of the selection becomes a history entry; going back undoes it. A language
    // switch only changes the title.
    effect(() => {
      const { path, title } = this.target();
      untracked(() => {
        if (!this.restored()) return;
        // Only the path counts: ?q=… belongs to the search (see Search) and stays while it is open.
        if (path !== this.location.path().split('?')[0]) this.location.go(path);
        this.title.setTitle(title);
        this.document.querySelector('link[rel="canonical"]')?.setAttribute('href', ORIGIN + path);
      });
    });

    // Back and forward buttons.
    this.location.subscribe(() => {
      if (this.restored()) void this.apply(this.location.path());
    });
  }

  /** Shows what a path describes; unknown paths lead to the start view. */
  private async apply(url: string): Promise<void> {
    const run = ++this.applied;
    const path = url.split(/[?#]/)[0];
    const parts = path.split('/').filter(Boolean).map(decodeURIComponent);
    const [section, first, second] = [parts.at(0), parts.at(1), parts.at(2)];

    const shown = first ? await this.show(section, first, second ?? null) : false;
    if (run !== this.applied) return; // a newer path came meanwhile
    if (shown) {
      // Older /muscle/<…>/<exercise> links become /exercises/<…> without an extra history entry.
      const canonical = this.target().path;
      if (canonical !== path) this.location.replaceState(canonical);
      return;
    }

    this.exercises.clear();
    if (path !== '/' && path !== '') this.location.replaceState('/');
  }

  /** Shows an exercise or a muscle from the path; false for unknown sections or ids. */
  private async show(section: string | undefined, first: string, second: string | null) {
    // showExercise() and restore() check that the exercise and the muscle exist.
    if (section === 'exercises') return this.exercises.showExercise(first);
    if (section === 'muscle') return this.exercises.restore(first, second);
    return false;
  }
}
