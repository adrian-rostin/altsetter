import { Location } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  afterNextRender,
  computed,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { I18n } from '../../i18n/i18n';
import { type ExerciseSummary } from '../../models/exercise.model';
import { AltsetterApi } from '../../services/altsetter-api';
import { ExerciseService } from '../../services/exercise.service';
import { Glass } from '../../shared/liquid-glass';

/** Wait this long after the last keystroke before asking the API (ms). */
const DEBOUNCE_MS = 120;
/** Matches per page; the next page loads while scrolling towards the end. */
const PAGE_SIZE = 20;
/** Load the next page when the end of the list is this close (px). */
const LOAD_MORE_MARGIN = 160;

type SearchState = 'idle' | 'loading' | 'done' | 'error';

/**
 * Exercise search in liquid glass. Phones: a round button in the top-left corner that grows to the
 * full width when tapped. Large screens: a small pill at the top centre that moves down and grows
 * like Spotlight when focused (or with Ctrl/Cmd+K). The results come from the API as you type;
 * picking one opens the exercise (/exercises/<id>). Layout and motion: .search-* in styles.css.
 */
@Component({
  selector: 'app-search',
  imports: [Glass],
  templateUrl: './search.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown)': 'onGlobalKey($event)',
  },
})
export class Search {
  protected readonly t = inject(I18n).t;
  /** Shared with the app, which fades out the logo and menu button while the search is open. */
  protected readonly open = inject(ExerciseService).searchOpen;
  protected readonly query = signal('');
  protected readonly results = signal<readonly ExerciseSummary[]>([]);
  protected readonly state = signal<SearchState>('idle');
  /** Highlighted result for the arrow keys and Enter. */
  protected readonly active = signal(0);
  /** How many exercises match in all; the list holds the pages loaded so far. */
  protected readonly total = signal(0);
  protected readonly loadingMore = signal(false);

  /** Results area: only once something is typed. */
  protected readonly showResults = computed(() => this.open() && this.query().trim() !== '');

  private readonly api = inject(AltsetterApi);
  private readonly i18n = inject(I18n);
  private readonly exercises = inject(ExerciseService);
  private readonly input = viewChild.required<ElementRef<HTMLInputElement>>('input');
  private readonly location = inject(Location);
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Counts requests, so an answer to an older input is dropped. */
  private sequence = 0;
  /** The input the loaded pages belong to, and the last page loaded. */
  private loadedQuery = '';
  private loadedPage = 0;

  constructor() {
    // A link with ?q=… (shared, bookmarked, reloaded) opens the search with that input.
    afterNextRender(() => {
      const query = new URLSearchParams(window.location.search).get('q')?.trim();
      if (!query) return;
      this.open.set(true);
      this.query.set(query);
      void this.run(query);
    });
  }

  /** Opens the search; focusing within the tap lets phones show the keyboard right away. */
  protected openSearch(): void {
    this.open.set(true);
    this.input().nativeElement.focus();
  }

  protected close(): void {
    clearTimeout(this.timer);
    this.sequence++;
    this.open.set(false);
    this.query.set('');
    this.results.set([]);
    this.state.set('idle');
    this.input().nativeElement.blur();
    this.syncUrl('');
  }

  protected onInput(value: string): void {
    this.query.set(value);
    this.syncUrl(value.trim());
    clearTimeout(this.timer);
    const query = value.trim();
    if (!query) {
      this.sequence++;
      this.results.set([]);
      this.state.set('idle');
      return;
    }
    this.timer = setTimeout(() => void this.run(query), DEBOUNCE_MS);
  }

  /** Arrows move the highlight, Enter opens it, Esc closes (and doesn't reach the card). */
  protected onKeydown(event: KeyboardEvent): void {
    const count = this.results().length;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    } else if (event.key === 'ArrowDown' && count) {
      event.preventDefault();
      if (this.active() >= count - 3) void this.loadMore();
      this.active.update((i) => (i + 1) % count);
    } else if (event.key === 'ArrowUp' && count) {
      event.preventDefault();
      this.active.update((i) => (i - 1 + count) % count);
    } else if (event.key === 'Enter') {
      const hit = this.results().at(this.active());
      if (hit) this.select(hit.id);
    }
  }

  /** Large screens: Ctrl/Cmd+K opens the search from anywhere, like Spotlight. */
  protected onGlobalKey(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      this.openSearch();
    }
  }

  protected select(exerciseId: string): void {
    this.close();
    this.exercises.menuOpen.set(false);
    // The result has everything for its place in the card; only its page still loads.
    this.exercises.remember(this.results().filter((e) => e.id === exerciseId));
    void this.exercises.showExercise(exerciseId);
  }

  /** Names of the muscles an exercise mainly trains, for its tags (not the ones working along). */
  protected mainMuscles(exercise: ExerciseSummary): string[] {
    return exercise.primaryMuscles
      .map((id) => this.exercises.muscleById(id)?.name)
      .filter((name): name is string => !!name);
  }

  protected photoUrl(exercise: ExerciseSummary): string | null {
    return exercise.images?.find((image) => image.position === 'start')?.url ?? null;
  }

  /** Loads the next page once the list is scrolled close to its end. */
  protected onResultsScroll(event: Event): void {
    const list = event.target as HTMLElement;
    if (list.scrollTop + list.clientHeight > list.scrollHeight - LOAD_MORE_MARGIN) {
      void this.loadMore();
    }
  }

  /**
   * Keeps the input in the address as ?q=…, so a search can be shared, bookmarked and reloaded.
   * Replaces the entry instead of adding one per keystroke; the path (muscle, exercise) stays.
   */
  private syncUrl(query: string): void {
    const path = this.location.path().split('?')[0];
    const current = new URLSearchParams(window.location.search).get('q') ?? '';
    if (query === current) return;
    this.location.replaceState(path, query ? `q=${encodeURIComponent(query)}` : '');
  }

  /** First page for a new input; replaces the list. */
  private async run(query: string): Promise<void> {
    const sequence = ++this.sequence;
    this.state.set('loading');
    this.loadingMore.set(false);
    try {
      const page = await this.api.search(query, this.i18n.lang(), 0, PAGE_SIZE);
      if (sequence !== this.sequence) return;
      this.results.set(page.items);
      this.total.set(page.totalItems);
      this.loadedQuery = query;
      this.loadedPage = 0;
      this.active.set(0);
      this.state.set('done');
    } catch {
      if (sequence !== this.sequence) return;
      this.results.set([]);
      this.total.set(0);
      this.state.set('error');
    }
  }

  /** Next page of the same input, appended; nothing if all are loaded or one is on its way. */
  private async loadMore(): Promise<void> {
    if (this.state() !== 'done' || this.loadingMore()) return;
    if (this.results().length >= this.total()) return;
    const sequence = this.sequence;
    this.loadingMore.set(true);
    try {
      const page = await this.api.search(
        this.loadedQuery,
        this.i18n.lang(),
        this.loadedPage + 1,
        PAGE_SIZE,
      );
      if (sequence !== this.sequence) return;
      this.results.update((loaded) => [...loaded, ...page.items]);
      this.loadedPage++;
    } catch {
      // The list just stays as it is; scrolling again tries once more.
    } finally {
      if (sequence === this.sequence) this.loadingMore.set(false);
    }
  }
}
