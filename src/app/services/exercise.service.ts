import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { I18n, type Lang } from '../i18n/i18n';
import {
  type ExerciseDetail,
  type ExerciseSummary,
  type Muscle,
  type MuscleFamily,
} from '../models/exercise.model';
import { AltsetterApi, type Catalog } from './altsetter-api';

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

/**
 * Selection state of the app plus the catalog from the API: muscles, families and all exercises
 * are loaded once at start; exercise details are loaded when an exercise is opened.
 *
 * Switching the language reloads the catalog in that language. Ids are the same in every
 * language, so the selection (and the URL) stays; the old texts remain until the new ones arrive.
 */
@Injectable({ providedIn: 'root' })
export class ExerciseService {
  /** Whether the catalog has been loaded from the API. */
  readonly loadState = signal<LoadState>('loading');

  readonly muscles = computed<readonly Muscle[]>(() => this.catalog()?.muscles ?? []);
  readonly families = computed<readonly MuscleFamily[]>(() => this.catalog()?.families ?? []);
  readonly allExercises = computed<readonly ExerciseSummary[]>(
    () => this.catalog()?.exercises ?? [],
  );

  /**
   * True while the exercise card ↔ detail transition runs. The 3D view pauses rendering (and
   * holds its camera flight) meanwhile, so the GPU is free for the transition — on phones the two
   * at once made the animation stutter.
   */
  readonly cardAnimating = signal(false);

  /** The side menu (Impressum, Datenschutz, Quellen) is open. */
  readonly menuOpen = signal(false);

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
    const exercise = id ? this.exerciseIndex().get(id) : undefined;
    if (!exercise) return null;
    return {
      exercise,
      muscles: trainedMuscles(exercise),
      detail: this.details().get(exercise.id) ?? null,
      detailFailed: this.failedDetails().has(exercise.id),
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
  private readonly catalog = signal<Catalog | null>(null);
  private readonly selection = signal<SelectionState | null>(null);
  /** Loaded exercise details by id, in the current language. */
  private readonly details = signal<ReadonlyMap<string, ExerciseDetail>>(new Map());
  private readonly failedDetails = signal<ReadonlySet<string>>(new Set());
  /** Requests in flight, by "lang:id". */
  private readonly pendingDetails = new Map<string, Promise<ExerciseDetail>>();

  private readonly muscleIndex = computed(
    () => new Map(this.muscles().map((m) => [m.id, m] as const)),
  );

  /** normalised mesh base name -> muscle id */
  private readonly meshToMuscle = computed(
    () =>
      new Map(this.muscles().flatMap((m) => m.meshNames.map((n) => [normalise(n), m.id] as const))),
  );

  private readonly exerciseIndex = computed(
    () => new Map(this.allExercises().map((e) => [e.id, e] as const)),
  );

  constructor() {
    // At start and whenever the language changes.
    effect(() => {
      const lang = this.i18n.lang();
      untracked(() => {
        this.switchLanguage(lang);
      });
    });
  }

  /**
   * Loads the catalog in the current language; called at start, on a language switch and from
   * the retry button. "loading" is only shown while there is nothing to show yet.
   */
  async load(): Promise<void> {
    const lang = this.i18n.lang();
    if (!this.catalog()) this.loadState.set('loading');
    try {
      const catalog = await this.api.catalog(lang);
      if (lang !== this.i18n.lang()) return; // switched again meanwhile
      this.catalog.set(catalog);
      this.loadState.set('ready');
    } catch (error: unknown) {
      if (lang !== this.i18n.lang()) return;
      console.error('[ExerciseService] Could not load the catalog.', error);
      this.loadState.set('error');
    }
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
          if (current()) this.details.update((map) => new Map(map).set(exerciseId, detail));
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
   * `exerciseId` optionally an exercise open in its card. Returns false for unknown ids.
   */
  restore(subjectId: string | null, exerciseId: string | null = null): boolean {
    if (subjectId === null) {
      this.clear();
      return true;
    }
    const family = this.families().find((f) => f.id === subjectId);
    const muscle = family ? null : this.muscleById(subjectId);
    if (!family && !muscle) return false;
    if (exerciseId !== null && !this.exerciseIndex().has(exerciseId)) return false;
    this.selection.set({
      familyId: family?.id ?? muscle?.familyId ?? null,
      muscleId: muscle?.id ?? null,
      meshName: null,
      exerciseId,
    });
    if (exerciseId !== null) this.loadDetail(exerciseId).catch(() => undefined);
    return true;
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
    const exercise = this.exerciseIndex().get(exerciseId);
    return exercise ? trainedMuscles(exercise) : { focus: [], also: [] };
  }

  /**
   * Exercises for the given muscles: `primary` where one of them is a main muscle, `secondary`
   * where they only work along. Both sorted by name, as delivered by the API.
   */
  listFor(muscleIds: string[]): ExerciseList {
    const ids = new Set(muscleIds);
    const primary: ExerciseSummary[] = [];
    const secondary: ExerciseSummary[] = [];
    for (const exercise of this.allExercises()) {
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

  /** Drops texts of the previous language and loads everything visible in the new one. */
  private switchLanguage(lang: Lang): void {
    this.details.set(new Map());
    this.failedDetails.set(new Set());
    void this.load();
    const open = this.selection()?.exerciseId;
    if (open && lang === this.i18n.lang()) this.loadDetail(open).catch(() => undefined);
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
