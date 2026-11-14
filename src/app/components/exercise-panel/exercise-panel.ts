import {
  ApplicationRef,
  DestroyRef,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { I18n } from '../../i18n/i18n';
import {
  type Difficulty,
  type ExerciseImage,
  type ExerciseSummary,
  type Muscle,
} from '../../models/exercise.model';
import { ExerciseService } from '../../services/exercise.service';
import { difficultyClass, equipmentLabel, meshLabel } from '../../shared/exercise-format';
import { runViewTransition } from '../../shared/view-transition';
import { Glass } from '../../shared/liquid-glass';
import { BottomSheet } from './bottom-sheet';

interface Section {
  /** Part name in the "All" view, "Also trains: …" for the secondary list, else null. */
  title: string | null;
  /** Exercises where the muscle only works along. */
  secondary: boolean;
  exercises: { exercise: ExerciseSummary; number: number }[];
}

/** Position and size of a family tab inside its glass selection (px). */
interface TabBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Large screens: where the tab selection sticks while the card scrolls (md:top-6). */
const STICKY_TOP = 24;

/**
 * Longest wait for the details and the photo before opening an exercise anyway. Short, so a tap
 * reacts right away; usually the hover (or the touch itself) has already loaded them.
 */
const PREPARE_TIMEOUT_MS = 300;

/**
 * The card with the selected muscle (or muscle family), its exercises and the exercise detail page.
 * On phones it is a draggable bottom sheet (see BottomSheet).
 */
@Component({
  selector: 'app-exercise-panel',
  imports: [NgTemplateOutlet, Glass],
  templateUrl: './exercise-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Positioned (absolute) by the parent, which also anchors the close button.
    class: 'flex min-h-0 flex-col',
    // Everything moving during the exercise transition is nested in (and clipped to) this card.
    style: 'view-transition-name: ex-panel; view-transition-group: contain',
    '[style.height]': 'sheet.height()',
    '[style.transition]': 'sheet.transition()',
    '(window:resize)': 'sheet.onResize()',
    '(transitionend)': 'onSheetResized($event)',
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ExercisePanel {
  protected readonly exercises = inject(ExerciseService);
  protected readonly t = inject(I18n).t;
  protected readonly sheet: BottomSheet;

  /** What the heading shows: the selected part / muscle, or the whole family. */
  protected readonly heading = computed(() => {
    const muscle = this.exercises.selectedMuscle();
    const family = this.exercises.selectedFamily();
    const subject = muscle ?? family;
    if (!subject) return null;
    return { name: subject.name };
  });

  /** Family tabs: 0 is "All", then one per part. */
  protected readonly activeTab = computed(() => {
    const muscle = this.exercises.selectedMuscle();
    return muscle ? this.exercises.familyParts().findIndex((p) => p.id === muscle.id) + 1 : 0;
  });
  protected readonly hoveredTab = signal(-1);
  /** Where the glass lens sits: on the hovered tab, else on the selected one. */
  protected readonly lens = computed<TabBox | undefined>(() => {
    const hovered = this.hoveredTab();
    return this.tabBoxes()[hovered >= 0 ? hovered : this.activeTab()];
  });

  /**
   * Single muscle / part: its exercises, then the ones it only works along in.
   * Whole family: one section per part, then the ones any part only works along in.
   * Each exercise appears once, numbered across all sections.
   */
  protected readonly sections = computed<Section[]>(() => {
    const muscle = this.exercises.selectedMuscle();
    const parts: Muscle[] = muscle ? [muscle] : this.exercises.familyParts();
    const seen = new Set<string>();
    let n = 0;
    const take = (list: ExerciseSummary[]) =>
      list
        .filter((e) => !seen.has(e.id) && seen.add(e.id))
        .map((exercise) => ({ exercise, number: ++n }));

    const sections: Section[] = parts.map((g) => ({
      title: muscle ? null : g.name,
      secondary: false,
      exercises: take(this.exercises.listFor([g.id]).primary),
    }));
    const subject = muscle ?? this.exercises.selectedFamily();
    const secondary = take(this.exercises.listFor(parts.map((g) => g.id)).secondary);
    if (secondary.length && subject) {
      sections.push({
        title: this.t().panel.alsoTrains(subject.name),
        secondary: true,
        exercises: secondary,
      });
    }
    return sections.filter((s) => s.exercises.length);
  });

  protected readonly exerciseCount = computed(() =>
    this.sections()
      .filter((s) => !s.secondary)
      .reduce((sum, s) => sum + s.exercises.length, 0),
  );

  /** The exercise whose details are shown, with its notes and trained muscles. */
  protected readonly openExercise = computed(() => {
    const open = this.exercises.openExercise();
    if (!open) return null;
    const { exercise, muscles, detail, detailFailed } = open;
    const named = (ids: string[]) =>
      ids.map((id) => this.exercises.muscleById(id)).filter((m): m is Muscle => m !== null);
    return {
      exercise,
      focus: named(muscles.focus),
      also: named(muscles.also),
      detail,
      detailFailed,
    };
  });

  /** Minimum height of the detail page: the full card, so it fills the card when at the top. */
  protected readonly detailHeight = signal(0);

  /**
   * True once the opening animation is over: everything except the detail page is hidden, so you
   * can neither scroll up to the heading nor down to other exercises (that's what "back" is for).
   */
  protected readonly isolated = signal(false);

  protected readonly difficultyClass = difficultyClass;
  protected readonly equipmentLabel = equipmentLabel;
  protected readonly meshLabel = meshLabel;

  private readonly appRef = inject(ApplicationRef);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');

  /** Scroll positions of the list before an exercise was opened, restored when going back. */
  private savedScroll = { scroller: 0, list: 0 };

  private readonly tabs = viewChildren<ElementRef<HTMLElement>>('tab');
  private readonly tabBoxes = signal<TabBox[]>([]);
  private readonly tabBlock = viewChild<ElementRef<HTMLElement>>('tabBlock');
  private readonly headingText = viewChild<ElementRef<HTMLElement>>('headingText');

  /** What the card shows: a family, a single muscle or an unknown mesh, and the selected part. */
  private readonly subjectKey = computed(
    () =>
      this.exercises.selectedFamilyId() ??
      this.exercises.selectedMuscle()?.id ??
      this.exercises.unknownMeshName(),
  );
  private shown: { subject: string | null; part: string | null } | null = null;
  /** The exercise being opened from its card; its page appears through the transition instead. */
  private openingByClick: string | null = null;
  private readonly injector = inject(Injector);
  /**
   * Cards that take part in the open/close animation: those in view when opening (closing brings
   * the same ones back). Every named element is captured and animated on its own, and the "All"
   * list can hold over 50 cards with three names each; cards out of view don't need to move.
   */
  private readonly animatedCards = signal<ReadonlySet<string>>(new Set());
  /** End photos already requested by prefetch(). */
  private readonly preloaded = new Set<string>();

  constructor() {
    this.sheet = new BottomSheet(this.host.nativeElement, () => {
      this.exercises.clear();
    });

    // Measure the tabs whenever one changes size (other family, language, line break), so the lens
    // knows where to go.
    const tabObserver = new ResizeObserver(() => {
      this.tabBoxes.set(
        this.tabs().map(({ nativeElement: tab }) => ({
          left: tab.offsetLeft,
          top: tab.offsetTop,
          width: tab.offsetWidth,
          height: tab.offsetHeight,
        })),
      );
    });
    effect(() => {
      const tabs = this.tabs();
      tabObserver.disconnect();
      for (const { nativeElement } of tabs) tabObserver.observe(nativeElement);
      const block = this.tabBlock()?.nativeElement;
      if (block) tabObserver.observe(block);
    });
    inject(DestroyRef).onDestroy(() => {
      tabObserver.disconnect();
    });

    // Whenever no exercise is open (closed, other muscle picked, card closed), show the full list.
    effect(() => {
      if (!this.exercises.openExercise()) this.isolated.set(false);
    });

    // An exercise opened from outside the card (a link, reload, back/forward button) has no card
    // to grow from: show its page right away, scrolled to the top.
    effect(() => {
      const id = this.exercises.openExercise()?.exercise.id ?? null;
      untracked(() => {
        if (id === null || id === this.openingByClick) return;
        this.isolated.set(true);
        afterNextRender(
          () => {
            this.scrollDetailToTop();
          },
          { injector: this.injector },
        );
      });
    });

    // Another muscle starts at the very top. Another part of the open family (tabs): phones also
    // go to the top; large screens keep the card where it is, and if the tabs stick at the top,
    // the new list starts right below them.
    effect(() => {
      const subject = this.subjectKey();
      const part = this.exercises.selectedMuscle()?.id ?? null;
      untracked(() => {
        const previous = this.shown;
        this.shown = { subject, part };
        if (!previous || subject === null) return;
        if (subject !== previous.subject || this.sheet.active()) this.scrollToTop();
        else if (part !== previous.part) this.keepPlaceOnTabSwitch();
      });
    });
  }

  /**
   * Opens an exercise. The detail page replaces its card in the list and is scrolled to the top:
   * the card grows into the page, the heading, category titles and earlier exercises move up and
   * the later exercises are pushed down (shared-element View Transition). Afterwards the rest of
   * the list is hidden.
   */
  protected async open(exerciseId: string): Promise<void> {
    await this.prepareDetail(exerciseId);
    this.savedScroll = {
      scroller: this.scroller()?.nativeElement.scrollTop ?? 0,
      list: this.list()?.nativeElement.scrollTop ?? 0,
    };
    this.detailHeight.set(this.host.nativeElement.clientHeight);
    this.openingByClick = exerciseId;
    // Names must be in place before the browser captures the old state.
    this.animatedCards.set(this.cardsInView());
    this.appRef.tick();
    this.transition(
      () => {
        this.exercises.openExerciseById(exerciseId);
      },
      () => {
        this.scrollDetailToTop();
      },
      () => {
        this.openingByClick = null;
        if (this.exercises.openExercise()?.exercise.id !== exerciseId) return; // closed meanwhile
        this.isolated.set(true);
        this.appRef.tick();
        this.scrollDetailToTop();
      },
    );
  }

  /** Back to the list: the page shrinks into its card and everything moves back into place. */
  protected closeDetail(): void {
    // Bring the hidden list back first (same frame, so nothing flashes), with the page at the top
    // exactly like at the end of opening — that is the starting point of the back animation.
    if (this.isolated()) {
      this.isolated.set(false);
      this.appRef.tick();
      this.scrollDetailToTop();
    }
    this.transition(
      () => {
        this.exercises.closeExercise();
      },
      () => {
        const scroller = this.scroller()?.nativeElement;
        const list = this.list()?.nativeElement;
        if (scroller) scroller.scrollTop = this.savedScroll.scroller;
        if (list) list.scrollTop = this.savedScroll.list;
      },
    );
  }

  /** Jump from an open exercise to one of the muscles it trains (its card starts at the top). */
  protected showMuscle(muscleId: string): void {
    this.exercises.selectMuscle(muscleId);
  }

  /** Esc closes the open exercise first, then the whole card. */
  protected onEscape(): void {
    if (this.exercises.openExercise()) this.closeDetail();
    else this.exercises.clear();
  }

  /** An open exercise page fills the card; keep that true after the sheet changed size. */
  protected onSheetResized(event: TransitionEvent): void {
    const isOwnHeight = event.target === this.host.nativeElement && event.propertyName === 'height';
    if (isOwnHeight && this.exercises.openExercise()) {
      this.detailHeight.set(this.host.nativeElement.clientHeight);
    }
  }

  protected difficultyLabel(difficulty: Difficulty): string {
    return this.t().difficulty[difficulty];
  }

  /**
   * view-transition-name shared by a list card and the detail page, e.g. "ex-title-lat-pulldown".
   * Only for the cards in view when opening and the open exercise (see animatedCards); all others
   * get none.
   */
  protected vtName(part: 'card' | 'title' | 'photo', exerciseId: string): string {
    const named =
      this.animatedCards().has(exerciseId) ||
      this.exercises.openExercise()?.exercise.id === exerciseId;
    return named ? `ex-${part}-${exerciseId}` : 'none';
  }

  /** A photo that can't load (API down) leaves its dark frame instead of a broken-image icon. */
  protected hideBroken(event: Event): void {
    (event.target as HTMLElement).style.visibility = 'hidden';
  }

  protected photo(exercise: ExerciseSummary, position: ExerciseImage['position']) {
    return exercise.images?.find((image) => image.position === position) ?? null;
  }

  /**
   * Loads the details while the pointer is on a card, so opening it needs no waiting; the end photo
   * too, so the detail page can switch to it right away.
   */
  protected prefetch(exerciseId: string): void {
    this.exercises.loadDetail(exerciseId).catch(() => undefined);
    const exercise = this.exercises.allExercises().find((e) => e.id === exerciseId);
    const end = exercise && this.photo(exercise, 'end');
    if (end && !this.preloaded.has(end.url)) {
      this.preloaded.add(end.url);
      new Image().src = end.url;
    }
  }

  protected retryDetail(exerciseId: string): void {
    this.prefetch(exerciseId);
  }

  protected tabClass(index: number): string {
    const highlighted = this.hoveredTab() >= 0 ? this.hoveredTab() : this.activeTab();
    return index === highlighted ? 'text-ink' : 'text-ink-muted';
  }

  /**
   * Applies a change as a View Transition. The 3D view pauses meanwhile (cardAnimating), so the
   * GPU is free for the card animation; `afterRender` fixes scroll positions inside the update.
   */
  private transition(change: () => void, afterRender: () => void, afterAnimation?: () => void) {
    this.exercises.cardAnimating.set(true);
    void runViewTransition(() => {
      change();
      this.appRef.tick();
      afterRender();
    }).then(() => {
      this.exercises.cardAnimating.set(false);
      afterAnimation?.();
    });
  }

  /**
   * Loads the details before the transition starts, so the page appears complete instead of
   * popping in. Gives up after a short time; the page then fills in as soon as the data arrives
   * (or shows its error note).
   */
  private async prepareDetail(exerciseId: string): Promise<void> {
    const details = this.exercises.loadDetail(exerciseId);
    // Decode the photo up front: an undecoded image would pop in during the animation.
    const exercise = this.exercises.allExercises().find((e) => e.id === exerciseId);
    const start = exercise && this.photo(exercise, 'start');
    const photo = start ? decodeImage(start.url) : Promise.resolve();
    const ready = Promise.all([details, photo]);
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, PREPARE_TIMEOUT_MS));
    await Promise.race([ready, timeout]).catch(() => undefined);
  }

  /** Scrolls the card so the detail page starts at its top edge. */
  private scrollDetailToTop(): void {
    const scroller = this.scroller()?.nativeElement;
    const detail = scroller?.querySelector<HTMLElement>('[data-exercise-detail]');
    if (scroller && detail) {
      scroller.scrollTop +=
        detail.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    }
  }

  /** Ids of the exercise cards visible in the card right now (with a little margin). */
  private cardsInView(): ReadonlySet<string> {
    const scroller = this.scroller()?.nativeElement;
    if (!scroller) return new Set();
    const view = scroller.getBoundingClientRect();
    const margin = 80;
    const ids = new Set<string>();
    for (const card of scroller.querySelectorAll<HTMLElement>('[data-card-id]')) {
      const box = card.getBoundingClientRect();
      if (box.bottom > view.top - margin && box.top < view.bottom + margin) {
        ids.add(card.dataset['cardId'] ?? '');
      }
    }
    return ids;
  }

  /**
   * Very top of the card: heading and list from the start. Again once the new list is rendered,
   * since the browser keeps the old position while the content is swapped (scroll anchoring).
   */
  private scrollToTop(): void {
    const toTop = () => {
      const list = this.list()?.nativeElement;
      const scroller = this.scroller()?.nativeElement;
      if (list) list.scrollTop = 0;
      if (scroller) scroller.scrollTop = 0;
    };
    toTop();
    afterNextRender(toTop, { injector: this.injector });
  }

  /**
   * Large screens, switching tabs: if the tabs stick at the top, the card goes to the point where
   * they start sticking, so the new list begins right below them. Otherwise it stays exactly where
   * it is. Measured before and set after rendering, since the heading of the new part may be
   * longer or shorter and the browser would otherwise shift the position (scroll anchoring).
   */
  private keepPlaceOnTabSwitch(): void {
    const scroller = this.scroller()?.nativeElement;
    const stickPoint = this.stickPoint();
    if (!scroller || stickPoint === null) return;
    const before = scroller.scrollTop;
    const stuck = before >= stickPoint - 1;
    afterNextRender(
      () => {
        const target = stuck ? this.stickPoint() : before;
        if (target !== null) scroller.scrollTop = target;
      },
      { injector: this.injector },
    );
  }

  /** Large screens: scroll position at which the tabs start to stick (null without tabs). */
  private stickPoint(): number | null {
    const scroller = this.scroller()?.nativeElement;
    const heading = this.headingText()?.nativeElement;
    const block = this.tabBlock()?.nativeElement;
    if (!scroller || !heading || !block) return null;
    // Where the tabs sit without sticking: right after the heading (plus their own margin).
    // Layout offsets (both relative to the card) ignore scrolling and running animations.
    const naturalTop =
      heading.offsetTop +
      heading.offsetHeight -
      scroller.offsetTop +
      parseFloat(getComputedStyle(block).marginTop);
    return Math.max(0, naturalTop - STICKY_TOP);
  }
}

/** Loads and decodes an image; resolves either way, a broken image just isn't ready earlier. */
function decodeImage(url: string): Promise<void> {
  const image = new Image();
  image.src = url;
  return image.decode().catch(() => undefined);
}
