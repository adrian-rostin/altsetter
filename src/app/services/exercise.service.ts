import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { I18n, type Lang } from '../i18n/i18n';
import {
  type ExerciseDetail,
  type ExerciseSummary,
  type Muscle,
  type MuscleFamily,
} from '../models/exercise.model';
import { MUSCLES } from '../data/muscles';
import { AltsetterApi } from './altsetter-api';

/**
 * What is selected:
 * - familyId only        -> a whole family (e.g. Bizeps), the "Alle" tab
 * - familyId + muscleId  -> one part of a family (e.g. langer Bizepskopf)
 * - muscleId only        -> a muscle without parts (e.g. Latissimus)
 * - meshName only        -> a clicked mesh that isn't in any group
 * - exerciseId           -> additionally, an exercise is open in the card
 */
interface SelectionState {
  familyId: string | null;
  muscleId: string | null;
  meshName: string | null;
  exerciseId?: string | null;
}

/** Which muscles to light up on the body. */
export interface Highlight {
  strong: ReadonlySet<string>;
  soft: ReadonlySet<string>;
}

/** All muscles an exercise trains: its main muscles (`focus`) and the ones working along. */
export interface TrainedMuscles {
  focus: string[];
  also: string[];
}

/** Exercises for a muscle: main exercises (it is a focus) and ones it only works along in. */
export interface ExerciseList {
  primary: ExerciseSummary[];
  secondary: ExerciseSummary[];
}

export type LoadState = 'loading' | 'ready' | 'error';

/** Exercises per page of a muscle's list; scrolling loads the next page. */
const PAGE_SIZE = 20;

/** The exercises of one muscle or family as loaded so far, in the order of the card. */
interface SubjectList {
  ids: readonly string[];
  /** How many there are in all. */
  total: number;
  /** Pages loaded so far. */
  pages: number;
  state: LoadState;
  loadingMore: boolean;
}

/**
 * Selection state of the app plus its data: muscles and families are fixed and live in the app
 * (data/muscles.ts), so the body is clickable right away, even when the API is down. Exercises are
 * only loaded when needed: opening a muscle loads the first page of its exercises (with everything
 * for their pages), scrolling the next ones; search, similar exercises and links load single ones.
 * Everything loaded is kept in one store by id.
 *
 * Switching the language reloads what is visible in that language. Ids are the same in every
 * language, so the selection (and the URL) stays; the old texts remain until the new ones arrive.
 */
@Injectable({ providedIn: 'root' })
export class ExerciseService {
  readonly muscles = computed<readonly Muscle[]>(() => MUSCLES[this.i18n.lang()].muscles);
  readonly families = computed<readonly MuscleFamily[]>(() => MUSCLES[this.i18n.lang()].families);
  /** Every exercise loaded so far (any muscle, search, similar, links). */
  readonly knownExercises = computed<readonly ExerciseSummary[]>(() => [...this.store().values()]);

  /** The list of the selected muscle (a part counts on its own) or family. */
  readonly currentList = computed<SubjectList | null>(() => {
    const key = this.subjectKey();
    return key ? (this.subjectLists().get(key) ?? null) : null;
  });
  /** Whether the selected muscle's exercises are there; 'loading' until the first page arrives. */
  readonly exerciseState = computed<LoadState>(() => this.currentList()?.state ?? 'loading');
  /** How many exercises the selected muscle has in all (not only the loaded ones). */
  readonly exerciseTotal = computed(() => this.currentList()?.total ?? 0);
  readonly loadingMore = computed(() => this.currentList()?.loadingMore ?? false);

  /**
   * True while the exercise card ↔ detail transition runs. The 3D view pauses rendering (and
   * holds its camera flight) meanwhile, so the GPU is free for the transition — on phones the two
   * at once made the animation stutter.
   */
  readonly cardAnimating = signal(false);

  /** The side menu (Impressum, Datenschutz, Quellen) is open. */
  readonly menuOpen = signal(false);

  /** The search is open; on phones it covers the top bar, so the logo and menu button fade out. */
  readonly searchOpen = signal(false);

  readonly hasSelection = computed(() => this.selection() !== null);

  readonly selectedFamilyId = computed(() => this.selection()?.familyId ?? null);

  readonly selectedFamily = computed(() => {
    const id = this.selectedFamilyId();
    return id ? (this.families().find((f) => f.id === id) ?? null) : null;
  });

  /** The parts of the selected family (e.g. long head, short head, brachialis), or []. */
  readonly familyParts = computed(() => {
    const family = this.selectedFamily();
    return family ? this.musclesById(family.muscleIds) : [];
  });

  /** The selected single muscle or part; null while a whole family is shown. */
  readonly selectedMuscle = computed(() => {
    const id = this.selection()?.muscleId;
    return id ? this.muscleById(id) : null;
  });

  /** Set only when the clicked mesh belongs to no muscle. */
  readonly unknownMeshName = computed(() => {
    const s = this.selection();
    return s && !s.familyId && !s.muscleId ? s.meshName : null;
  });

  /** The exercise open in the card, with the muscles it trains and its details (once loaded). */
  readonly openExercise = computed(() => {
    const id = this.selection()?.exerciseId;
    const exercise = id ? this.store().get(id) : undefined;
    if (!exercise) return null;
    return {
      exercise,
      muscles: trainedMuscles(exercise),
      detail: this.details().get(exercise.id) ?? null,
      detailFailed: this.failedDetails().has(exercise.id),
      /** Similar exercises, most similar first; null while loading, [] if none fit. */
      similar: this.similarExercises().get(exercise.id) ?? null,
    };
  });

  /**
   * What the camera frames: the open exercise's muscles, else the whole family (stays put while
   * switching between its parts), a single muscle, or an unknown clicked mesh.
   * `key` changes only when the camera should move.
   */
  readonly focus = computed<{ key: string; groupIds: string[]; meshName: string | null } | null>(
    () => {
      const s = this.selection();
      if (!s) return null;
      const open = this.openExercise();
      if (open) {
        return {
          key: `exercise:${open.exercise.id}`,
          groupIds: [...open.muscles.focus, ...open.muscles.also],
          meshName: null,
        };
      }
      if (s.familyId) {
        return {
          key: `family:${s.familyId}`,
          groupIds: this.familyParts().map((m) => m.id),
          meshName: null,
        };
      }
      if (s.muscleId) {
        return { key: `muscle:${s.muscleId}`, groupIds: [s.muscleId], meshName: null };
      }
      if (s.meshName) {
        return { key: `mesh:${normalise(s.meshName)}`, groupIds: [], meshName: s.meshName };
      }
      return null;
    },
  );

  /**
   * Open exercise -> its focus muscles strong, the ones working along soft.
   * Whole family -> all parts strong. One part -> it strong, its siblings soft.
   */
  readonly highlight = computed<Highlight>(() => {
    const s = this.selection();
    const open = this.openExercise();
    if (open) return { strong: new Set(open.muscles.focus), soft: new Set(open.muscles.also) };
    const parts = this.familyParts().map((m) => m.id);
    if (s?.muscleId) {
      return {
        strong: new Set([s.muscleId]),
        soft: new Set(parts.filter((id) => id !== s.muscleId)),
      };
    }
    if (s?.familyId) return { strong: new Set(parts), soft: new Set() };
    return { strong: new Set(), soft: new Set() };
  });

  // ---------- State and lookups ----------

  private readonly api = inject(AltsetterApi);
  private readonly i18n = inject(I18n);
  /** Every exercise loaded so far, by id. */
  private readonly store = signal<ReadonlyMap<string, ExerciseSummary>>(new Map());
  /** Loaded lists by muscle or family id, in the current language. */
  private readonly subjectLists = signal<ReadonlyMap<string, SubjectList>>(new Map());
  private readonly selection = signal<SelectionState | null>(null);
  /** Whose list the card shows: the selected part or single muscle, else the family. */
  private readonly subjectKey = computed(() => {
    const s = this.selection();
    return s?.muscleId ?? s?.familyId ?? null;
  });
  /** Loaded exercise details by id, in the current language. */
  private readonly details = signal<ReadonlyMap<string, ExerciseDetail>>(new Map());
  private readonly failedDetails = signal<ReadonlySet<string>>(new Set());
  /** Requests in flight, by "lang:id". */
  private readonly pendingDetails = new Map<string, Promise<ExerciseDetail>>();
  /** Similar exercises by exercise id, in the current language. */
  private readonly similarExercises = signal<ReadonlyMap<string, readonly ExerciseSummary[]>>(
    new Map(),
  );
  /** Similar-exercise requests in flight, by "lang:id". */
  private readonly pendingSimilar = new Set<string>();

  private readonly muscleIndex = computed(
    () => new Map(this.muscles().map((m) => [m.id, m] as const)),
  );

  /** normalised mesh base name -> muscle id */
  private readonly meshToMuscle = computed(
    () =>
      new Map(this.muscles().flatMap((m) => m.meshNames.map((n) => [normalise(n), m.id] as const))),
  );

  /**
   * The loaded exercises of the selected muscle, in the card's order; an open exercise that isn't
   * loaded yet (link, search, similar) is added, so its page has a place in the list.
   */
  private readonly subjectExercises = computed<readonly ExerciseSummary[]>(() => {
    const store = this.store();
    const loaded = (this.currentList()?.ids ?? [])
      .map((id) => store.get(id))
      .filter((e): e is ExerciseSummary => !!e);
    const openId = this.selection()?.exerciseId;
    const open = openId ? store.get(openId) : undefined;
    return open && !loaded.some((e) => e.id === open.id) ? [...loaded, open] : loaded;
  });

  constructor() {
    // At start and whenever the language changes.
    effect(() => {
      const lang = this.i18n.lang();
      untracked(() => {
        this.switchLanguage(lang);
      });
    });

    // Opening a muscle (or a part's tab) loads the first page of its exercises, once per language.
    effect(() => {
      const subject = this.subjectKey();
      const lang = this.i18n.lang();
      untracked(() => {
        if (subject && !this.subjectLists().has(subject)) void this.loadPage(subject, 0, lang);
      });
    });

    // Similar exercises for the open one, shown below its page.
    effect(() => {
      const id = this.selection()?.exerciseId ?? null;
      const lang = this.i18n.lang();
      untracked(() => {
        if (id) this.loadSimilar(id, lang);
      });
    });
  }

  /** Retry button: loads the selected muscle's first page again. */
  load(): Promise<void> {
    const subject = this.subjectKey();
    return subject ? this.loadPage(subject, 0, this.i18n.lang()) : Promise.resolve();
  }

  /** Scrolling near the end of the card: the next page of the selected muscle, if there is one. */
  loadMore(): void {
    const subject = this.subjectKey();
    const list = this.currentList();
    if (!subject || list?.state !== 'ready' || list.loadingMore) return;
    if (list.ids.length >= list.total) return;
    void this.loadPage(subject, list.pages, this.i18n.lang());
  }

  /** An exercise loaded so far, or null. */
  exerciseById(id: string): ExerciseSummary | null {
    return this.store().get(id) ?? null;
  }

  /** Adds exercises from the search or the similar exercises to the store. */
  remember(exercises: readonly ExerciseSummary[]): void {
    if (!exercises.length) return;
    this.store.update((store) => {
      const next = new Map(store);
      for (const exercise of exercises) next.set(exercise.id, exercise);
      return next;
    });
  }

  /**
   * Loads the details of an exercise once per language; later calls return the cached result.
   * A result arriving after a language switch is not kept.
   */
  loadDetail(exerciseId: string): Promise<ExerciseDetail> {
    const loaded = this.details().get(exerciseId);
    if (loaded) return Promise.resolve(loaded);
    const lang = this.i18n.lang();
    const key = `${lang}:${exerciseId}`;
    let pending = this.pendingDetails.get(key);
    if (!pending) {
      this.failedDetails.update((ids) => without(ids, exerciseId));
      const current = () => lang === this.i18n.lang();
      pending = this.api.exercise(exerciseId, lang).then(
        (detail) => {
          this.pendingDetails.delete(key);
          if (current()) this.addDetails([detail]);
          return detail;
        },
        (error: unknown) => {
          this.pendingDetails.delete(key);
          if (current()) this.failedDetails.update((ids) => new Set(ids).add(exerciseId));
          throw error;
        },
      );
      this.pendingDetails.set(key, pending);
    }
    return pending;
  }

  // ---------- Selecting ----------

  /**
   * Called when the 3D viewer reports a clicked mesh. The first click on a family selects the
   * whole family; once it is open, clicking one of its parts selects that part.
   */
  selectByMesh(meshName: string): void {
    const muscle = this.groupFor(meshName);
    if (muscle?.familyId && muscle.familyId === this.selectedFamilyId()) {
      this.selectMuscle(muscle.id);
    } else if (muscle?.familyId) {
      this.selection.set({ familyId: muscle.familyId, muscleId: null, meshName });
    } else {
      this.selection.set({ familyId: null, muscleId: muscle?.id ?? null, meshName });
    }
  }

  /** Selects a whole family, e.g. from the "Alle" tab. */
  selectFamily(familyId: string): void {
    this.selection.set({ familyId, muscleId: null, meshName: null });
  }

  /** Selects one muscle or one part of a family. */
  selectMuscle(muscleId: string): void {
    const muscle = this.muscleById(muscleId);
    this.selection.set({ familyId: muscle?.familyId ?? null, muscleId, meshName: null });
  }

  openExerciseById(exerciseId: string): void {
    this.selection.update((s) => (s ? { ...s, exerciseId } : s));
    // Details are needed for the page; opening by click has usually loaded them already.
    this.loadDetail(exerciseId).catch(() => undefined);
  }

  /**
   * Restores a selection in one step, e.g. from the URL: `subjectId` is a family or a muscle,
   * `exerciseId` optionally an exercise open in its card (its page appears once it is loaded).
   * Returns false for unknown muscles.
   */
  restore(subjectId: string | null, exerciseId: string | null = null): boolean {
    if (subjectId === null) {
      this.clear();
      return true;
    }
    const family = this.families().find((f) => f.id === subjectId);
    const muscle = family ? null : this.muscleById(subjectId);
    if (!family && !muscle) return false;
    this.selection.set({
      familyId: family?.id ?? muscle?.familyId ?? null,
      muscleId: muscle?.id ?? null,
      meshName: null,
      exerciseId,
    });
    if (exerciseId !== null) this.loadDetail(exerciseId).catch(() => undefined);
    return true;
  }

  /**
   * Opens any exercise by id: from the search, the similar exercises or an /exercises/<id> link.
   * Within the current muscle if the exercise trains it, otherwise under its first main muscle (so
   * its page has a place in a list). Loads the exercise first if needed; false if there is none.
   */
  async showExercise(exerciseId: string): Promise<boolean> {
    let exercise = this.store().get(exerciseId);
    if (!exercise) {
      try {
        exercise = summaryOf(await this.loadDetail(exerciseId));
      } catch {
        return false;
      }
    }
    const s = this.selection();
    const current = s?.muscleId ? [s.muscleId] : this.familyParts().map((m) => m.id);
    const trained = [...exercise.primaryMuscles, ...exercise.secondaryMuscles];
    if (s && current.some((id) => trained.includes(id))) {
      this.openExerciseById(exerciseId);
      return true;
    }
    return this.restore(exercise.primaryMuscles[0] ?? null, exerciseId);
  }

  closeExercise(): void {
    this.selection.update((s) => (s ? { ...s, exerciseId: null } : s));
  }

  clear(): void {
    this.selection.set(null);
  }

  // ---------- Exercises and muscles ----------

  /** Main muscles and muscles working along of an exercise. */
  trainedMuscles(exerciseId: string): TrainedMuscles {
    const exercise = this.store().get(exerciseId);
    return exercise ? trainedMuscles(exercise) : { focus: [], also: [] };
  }

  /**
   * Of the selected muscle's loaded exercises, those for the given muscles: `primary` where one of
   * them is a main muscle, `secondary` where they only work along. In the order of the API.
   */
  listFor(muscleIds: string[]): ExerciseList {
    const ids = new Set(muscleIds);
    const primary: ExerciseSummary[] = [];
    const secondary: ExerciseSummary[] = [];
    for (const exercise of this.subjectExercises()) {
      if (exercise.primaryMuscles.some((id) => ids.has(id))) primary.push(exercise);
      else if (exercise.secondaryMuscles.some((id) => ids.has(id))) secondary.push(exercise);
    }
    return { primary, secondary };
  }

  muscleById(id: string): Muscle | null {
    return this.muscleIndex().get(id) ?? null;
  }

  /** Maps a raw mesh name from the model to a muscle id. */
  muscleIdFor(meshName: string): string | null {
    return this.meshToMuscle().get(normalise(meshName)) ?? null;
  }

  groupFor(meshName: string): Muscle | null {
    const id = this.muscleIdFor(meshName);
    return id ? this.muscleById(id) : null;
  }

  familyFor(muscle: Muscle | null): MuscleFamily | null {
    return muscle?.familyId
      ? (this.families().find((f) => f.id === muscle.familyId) ?? null)
      : null;
  }

  /**
   * The mesh name without its side, so "…_left" and "…_right" compare equal.
   * Used to link both sides of a muscle that isn't in any group.
   */
  sideless(meshName: string): string {
    return normalise(meshName);
  }

  /**
   * Drops texts of the previous language and loads what is visible in the new one: the selected
   * muscle's first page and the open exercise. The store keeps the old texts until then.
   */
  private switchLanguage(lang: Lang): void {
    this.details.set(new Map());
    this.failedDetails.set(new Set());
    this.similarExercises.set(new Map());
    this.subjectLists.set(new Map());
    const subject = this.subjectKey();
    if (subject) void this.loadPage(subject, 0, lang);
    const open = this.selection()?.exerciseId;
    if (open) this.loadDetail(open).catch(() => undefined);
  }

  /**
   * Loads one page of a muscle's exercises. Page 0 starts the list (again); later pages are
   * appended. A failed first page shows the error with its retry button; a failed later page just
   * stops, and scrolling tries again.
   */
  private async loadPage(subject: string, page: number, lang: Lang): Promise<void> {
    const first = page === 0;
    this.updateList(subject, (list) =>
      first
        ? {
            ids: list?.ids ?? [],
            total: list?.total ?? 0,
            pages: list?.pages ?? 0,
            state: list?.state === 'ready' ? 'ready' : 'loading',
            loadingMore: false,
          }
        : { ...(list ?? emptyList()), loadingMore: true },
    );
    try {
      const result = await this.api.muscleExercises(subject, lang, page, PAGE_SIZE);
      if (lang !== this.i18n.lang()) return; // switched meanwhile
      this.addDetails(result.items);
      const ids = result.items.map((detail) => detail.id);
      this.updateList(subject, (list) => ({
        ids: first ? ids : [...(list?.ids ?? []), ...ids],
        total: result.totalItems,
        pages: page + 1,
        state: 'ready',
        loadingMore: false,
      }));
    } catch (error: unknown) {
      if (lang !== this.i18n.lang()) return;
      console.error('[ExerciseService] Could not load the exercises.', error);
      this.updateList(subject, (list) =>
        first && !list?.ids.length
          ? { ...emptyList(), state: 'error' }
          : { ...(list ?? emptyList()), loadingMore: false },
      );
    }
  }

  private updateList(subject: string, change: (list: SubjectList | undefined) => SubjectList) {
    this.subjectLists.update((lists) => new Map(lists).set(subject, change(lists.get(subject))));
  }

  /** Keeps exercise pages from the API: their details, and their summaries in the store. */
  private addDetails(details: readonly ExerciseDetail[]): void {
    if (!details.length) return;
    this.details.update((map) => {
      const next = new Map(map);
      for (const detail of details) next.set(detail.id, detail);
      return next;
    });
    this.remember(details.map(summaryOf));
  }

  /** Loads the similar exercises of an exercise once per language; none if that fails. */
  private loadSimilar(exerciseId: string, lang: Lang): void {
    const key = `${lang}:${exerciseId}`;
    if (this.similarExercises().has(exerciseId) || this.pendingSimilar.has(key)) return;
    this.pendingSimilar.add(key);
    const store = (similar: readonly ExerciseSummary[]) => {
      this.pendingSimilar.delete(key);
      if (lang === this.i18n.lang()) {
        this.remember(similar);
        this.similarExercises.update((map) => new Map(map).set(exerciseId, similar));
      }
    };
    this.api.similar(exerciseId, lang).then(store, () => {
      store([]);
    });
  }

  private musclesById(ids: readonly string[]): Muscle[] {
    return ids.map((id) => this.muscleById(id)).filter((m): m is Muscle => m !== null);
  }
}

function without(ids: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!ids.has(id)) return ids;
  const copy = new Set(ids);
  copy.delete(id);
  return copy;
}

function emptyList(): SubjectList {
  return { ids: [], total: 0, pages: 0, state: 'loading', loadingMore: false };
}

/** The list entry of an exercise page (same data, muscles as ids). */
function summaryOf(detail: ExerciseDetail): ExerciseSummary {
  return {
    id: detail.id,
    name: detail.name,
    description: detail.description,
    difficulty: detail.difficulty,
    equipment: detail.equipment,
    primaryMuscles: detail.muscles.primary.map((m) => m.id),
    secondaryMuscles: detail.muscles.secondary.map((m) => m.id),
    images: detail.images,
  };
}

function trainedMuscles(exercise: ExerciseSummary): TrainedMuscles {
  return { focus: exercise.primaryMuscles, also: exercise.secondaryMuscles };
}

/** "Long_head_of_biceps_brachii_left" -> "long head of biceps brachii" */
function normalise(name: string): string {
  return name
    .toLowerCase()
    .replace(/[\s_]+/g, ' ')
    .replace(/ (left|right)$/, '')
    .trim();
}
