/**
 * Data of the app. Muscles and families are fixed and live in the app (data/muscles.ts);
 * exercises come from the Altsetter API (/api/v1). Ids are English, lowercase and hyphenated and
 * the same in every language, e.g. 'upper-chest' for a muscle or 'lat-pulldown' for an exercise;
 * the app's paths use them too. Texts come in the language the app asks for.
 */

export type Difficulty = 'beginner' | 'intermediate' | 'advanced';

/** A muscle or part of a muscle family, as the 3D model knows it. */
export interface Muscle {
  id: string;
  /** Family this muscle is a part of (e.g. 'biceps' for the long head), null if none. */
  familyId: string | null;
  /** Everyday name, e.g. "Upper Chest". */
  name: string;
  region: string;
  /**
   * Model mesh names without the "left"/"right" suffix (e.g. "Long head of biceps brachii").
   * Matching is case-insensitive and ignores "_".
   */
  meshNames: string[];
}

/**
 * A muscle made of several parts that are trained differently, e.g. "Bizeps" with long head,
 * short head and brachialis. Selected as a whole when clicked on the body.
 */
export interface MuscleFamily {
  id: string;
  name: string;
  region: string;
  /** Its parts, from top to bottom. */
  muscleIds: string[];
}

/** All muscles and families in one language. */
export interface MuscleCatalog {
  families: MuscleFamily[];
  muscles: Muscle[];
}

export interface Equipment {
  id: string;
  name: string;
}

export interface MuscleRef {
  id: string;
  name: string;
}

/**
 * A photo of an exercise. `url` is on the app's own origin and carries a version, so the browser
 * may keep it for good.
 */
export interface ExerciseImage {
  position: 'start' | 'end';
  url: string;
  width: number;
  height: number;
}

/** An exercise in lists: enough to show its card and highlight its muscles. */
export interface ExerciseSummary {
  id: string;
  name: string;
  description: string;
  difficulty: Difficulty;
  equipment: Equipment[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  /**
   * Start before end; holds like the plank only have a start photo. Missing from APIs older than
   * the photos, so the app keeps working (without photos) if it is deployed first.
   */
  images?: ExerciseImage[];
}

/** Everything about one exercise, for its detail page. */
export interface ExerciseDetail {
  id: string;
  name: string;
  description: string;
  difficulty: Difficulty;
  equipment: Equipment[];
  muscles: { primary: MuscleRef[]; secondary: MuscleRef[] };
  /** "Watch out for" */
  cues: string[];
  /** "Common mistakes" */
  mistakes: string[];
  images?: ExerciseImage[];
}

/** A complete list; every list of the API wraps its entries in `items`. */
export interface List<T> {
  items: T[];
}

/** One page of a longer list. */
export interface Page<T> extends List<T> {
  page: number;
  size: number;
  totalItems: number;
  totalPages: number;
}

/** What the 3D viewer reports when a mesh is clicked. */
export interface MeshSelection {
  meshName: string;
}
