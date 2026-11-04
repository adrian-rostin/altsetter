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
import { type Difficulty, type ExerciseSummary, type Muscle } from '../../models/exercise.model';
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

/** Top padding of the desktop list (md:py-6) and the fade at its top edge without tabs (px). */
const LIST_PADDING_TOP = 24;
const FADE = 20;
/** Where the tab selection sticks on phones, level with the close button (max-md:top-4). */
const STICKY_TOP = 16;

/** Longest wait for the details before opening an exercise anyway. */
const PREPARE_TIMEOUT_MS = 1500;

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
    return { name: subject.name, latinName: subject.latinName, summary: subject.summary };
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

  /**
   * Desktop list: the list scrolls up behind the tab selection and fades out there, so the
   * exercises show through the glass instead of ending at a hard line. Without tabs it just fades
   * at the top edge.
   */
  protected readonly listUnderHeading = computed(() => {
    if (this.sheet.active() || this.openExercise()) return null;
    const { overlap, height } = this.pillArea();
    return {
      marginTop: -overlap,
      paddingTop: overlap + LIST_PADDING_TOP,
      mask: `linear-gradient(to bottom, transparent, black ${height || FADE}px)`,
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
  /** Phones: whether the tab selection sticks at the top right now (see trackStuck). */
  private tabsStuck = false;
  private readonly tabPill = viewChild<ElementRef<HTMLElement>>('tabPill');
  /** From the top of the tab selection to the end of its block, and its height (px). */
  private readonly pillArea = signal({ overlap: 0, height: 0 });

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

  constructor() {
    this.sheet = new BottomSheet(this.host.nativeElement, () => {
      this.exercises.clear();
    });

    // Measure the tabs whenever one changes size (other family, language, line break), so the lens
    // knows where to go.
    const tabObserver = new ResizeObserver(() => {
      const block = this.tabBlock()?.nativeElement;
      const pill = this.tabPill()?.nativeElement;
      this.pillArea.set(
        block && pill
          ? {
              overlap: block.getBoundingClientRect().bottom - pill.getBoundingClientRect().top,
              height: pill.offsetHeight,
            }
          : { overlap: 0, height: 0 },
      );
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

    // A different muscle starts at the top of the card. Switching between the parts of the open
    // family (tabs) keeps the heading with the tabs and only starts the list from the beginning.
    effect(() => {
      const subject = this.subjectKey();
      const part = this.exercises.selectedMuscle()?.id ?? null;
      untracked(() => {
        const previous = this.shown;
        this.shown = { subject, part };
        if (!previous || subject === null) return;
        if (subject !== previous.subject) this.scrollToTop();
        else if (part !== previous.part) this.scrollToList();
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

  /** view-transition-name shared by a list card and the detail page, e.g. "ex-title-lat-pulldown". */
  protected vtName(part: 'card' | 'title', exerciseId: string): string {
    return `ex-${part}-${exerciseId}`;
  }

  /** Loads the details while the pointer is on a card, so opening it needs no waiting. */
  protected prefetch(exerciseId: string): void {
    this.exercises.loadDetail(exerciseId).catch(() => undefined);
  }

  protected retryDetail(exerciseId: string): void {
    this.prefetch(exerciseId);
  }

  /** Phones: remembers on every scroll whether the tab selection currently sticks at the top. */
  protected trackStuck(): void {
    const stickPoint = this.stickPoint();
    const scroller = this.scroller()?.nativeElement;
    this.tabsStuck = stickPoint !== null && !!scroller && scroller.scrollTop >= stickPoint - 1;
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
    const ready = this.exercises.loadDetail(exerciseId);
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

  /** Very top of the card: heading and list from the start. */
  private scrollToTop(): void {
    const list = this.list()?.nativeElement;
    const scroller = this.scroller()?.nativeElement;
    if (list) list.scrollTop = 0;
    if (scroller) scroller.scrollTop = 0;
  }

  /**
   * Desktop: the list starts from the top again. Phones: heading and list scroll together. While
   * the heading is still visible the card stays where it is, so you can click quickly through the
   * parts; once the selection sticks, the card goes back to the point where it starts sticking,
   * so the new list begins right below it.
   */
  private scrollToList(): void {
    const list = this.list()?.nativeElement;
    if (list) list.scrollTop = 0;
    if (!this.sheet.active() || !this.tabsStuck) return;
    afterNextRender(
      () => {
        // The heading of the new part may be longer or shorter, so measure after rendering.
        const stickPoint = this.stickPoint();
        const scroller = this.scroller()?.nativeElement;
        if (stickPoint !== null && scroller) scroller.scrollTop = stickPoint;
      },
      { injector: this.injector },
    );
  }

  /** Phones: scroll position at which the tab selection starts to stick (null without tabs). */
  private stickPoint(): number | null {
    const scroller = this.scroller()?.nativeElement;
    const heading = this.headingText()?.nativeElement;
    const block = this.tabBlock()?.nativeElement;
    if (!this.sheet.active() || !scroller || !heading || !block) return null;
    // Where the selection sits without sticking: right after the heading (plus its own margin).
    // Layout offsets (both relative to the card) ignore scrolling and running animations.
    const naturalTop =
      heading.offsetTop +
      heading.offsetHeight -
      scroller.offsetTop +
      parseFloat(getComputedStyle(block).marginTop);
    return Math.max(0, naturalTop - STICKY_TOP);
  }
}
