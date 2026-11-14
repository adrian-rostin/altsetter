import { computed, signal } from '@angular/core';
import { MOBILE_BREAKPOINT, SHEET_GAP, SHEET_RATIO } from '../../layout/panel-layout';

/** Smallest height while dragging, and how far a drag must move before it counts. */
const MIN_HEIGHT = 120;
const DRAG_THRESHOLD = 4;
/** Released below this share of the half height, the sheet closes. */
const CLOSE_RATIO = 0.7;
/** The speed at release is measured over the last moves within this time (ms). */
const VELOCITY_WINDOW_MS = 100;
/**
 * How strongly a flick slows down (px/ms²). On release the sheet snaps to where it would come to
 * rest from its release speed with this braking: a fast flick carries far, a slow pull hardly.
 * 1000 px/s → about 125 px further, 2000 px/s → about 500 px.
 */
const DECELERATION = 0.004;

/** The sheet's resting states, from low to high. */
const SNAPS = ['closed', 'half', 'full'] as const;

/**
 * The exercise card as a bottom sheet on phones: drag its handle up to full screen, down to half
 * height, or far down to close it; a tap toggles between half and full. A quick flick counts like
 * a longer pull (see DECELERATION), but moves at most one step: from full, even a hard flick down
 * only goes to half.
 */
export class BottomSheet {
  /** True on phones, where the card is a bottom sheet. */
  readonly active = signal(window.innerWidth < MOBILE_BREAKPOINT);
  readonly full = signal(false);

  /** Inline height for the sheet; null keeps the CSS default (half height, or the desktop card). */
  readonly height = computed(() => {
    if (!this.active()) return null;
    const drag = this.dragHeight();
    if (drag !== null) return `${drag}px`;
    return this.full() ? `calc(100dvh - ${2 * SHEET_GAP}px)` : null;
  });

  /** Animate snapping, but follow the finger directly while dragging. */
  readonly transition = computed(() =>
    this.dragHeight() === null ? 'height 320ms cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none',
  );

  /** Current height in px while the handle is being dragged, else null. */
  private readonly dragHeight = signal<number | null>(null);
  private drag: {
    startY: number;
    startHeight: number;
    moved: boolean;
    /** Recent heights with their time (ms), to measure the speed at release. */
    samples: { t: number; height: number }[];
  } | null = null;

  constructor(
    private readonly element: HTMLElement,
    private readonly onClose: () => void,
  ) {}

  onResize(): void {
    this.active.set(window.innerWidth < MOBILE_BREAKPOINT);
  }

  toggle(): void {
    this.full.update((full) => !full);
  }

  onPointerDown(event: PointerEvent): void {
    try {
      // Keep receiving moves when the finger leaves the small handle.
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    } catch {
      // Pointer already gone; the drag still works while over the handle.
    }
    const height = this.element.clientHeight;
    this.drag = {
      startY: event.clientY,
      startHeight: height,
      moved: false,
      samples: [{ t: event.timeStamp, height }],
    };
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true;
    if (!drag.moved) return;
    const height = Math.min(this.fullHeight(), Math.max(MIN_HEIGHT, drag.startHeight - dy));
    this.dragHeight.set(height);
    drag.samples.push({ t: event.timeStamp, height });
    while (drag.samples.length > 2 && event.timeStamp - drag.samples[0].t > VELOCITY_WINDOW_MS) {
      drag.samples.shift();
    }
  }

  /**
   * Snaps to closed, half or full: to the one nearest to where the sheet would come to rest, at
   * most one step away from where the drag started. A tap toggles. `event` is missing when the
   * pointer was cancelled; then the release speed doesn't count.
   */
  onPointerUp(event?: PointerEvent): void {
    const drag = this.drag;
    const height = this.dragHeight();
    this.drag = null;
    this.dragHeight.set(null);
    if (!drag) return;
    if (!drag.moved || height === null) {
      this.toggle();
      return;
    }
    const velocity = event ? releaseVelocity(drag.samples, event.timeStamp) : 0; // px/ms, + = up
    const travel = (Math.sign(velocity) * velocity * velocity) / (2 * DECELERATION);
    const from = this.snapIndex(drag.startHeight);
    const nearest = this.snapIndex(height + travel);
    const target = SNAPS[Math.min(from + 1, Math.max(from - 1, nearest))];
    if (target === 'closed') this.onClose();
    else this.full.set(target === 'full');
  }

  /** Index in SNAPS of the resting state nearest to a height. */
  private snapIndex(height: number): number {
    const half = window.innerHeight * SHEET_RATIO;
    if (height < half * CLOSE_RATIO) return SNAPS.indexOf('closed');
    return SNAPS.indexOf(height > (half + this.fullHeight()) / 2 ? 'full' : 'half');
  }

  private fullHeight(): number {
    return window.innerHeight - 2 * SHEET_GAP; // same gap above as below
  }
}

/**
 * Speed of the sheet's edge at release (px/ms, positive while growing), from the moves in the last
 * VELOCITY_WINDOW_MS. A finger that rested before letting go has no speed left.
 */
function releaseVelocity(samples: { t: number; height: number }[], releasedAt: number): number {
  const last = samples.at(-1);
  if (!last || releasedAt - last.t > VELOCITY_WINDOW_MS) return 0;
  const first = samples.find((s) => last.t - s.t <= VELOCITY_WINDOW_MS) ?? samples[0];
  const dt = last.t - first.t;
  return dt > 0 ? (last.height - first.height) / dt : 0;
}
