import { computed, signal } from '@angular/core';
import { MOBILE_BREAKPOINT, SHEET_GAP, SHEET_RATIO } from '../../layout/panel-layout';

/** Smallest height while dragging, and how far a drag must move before it counts. */
const MIN_HEIGHT = 120;
const DRAG_THRESHOLD = 4;
/** Released below this share of the half height, the sheet closes. */
const CLOSE_RATIO = 0.7;

/**
 * The exercise card as a bottom sheet on phones: drag its handle up to full screen, down to half
 * height, or far down to close it; a tap toggles between half and full.
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
  private drag: { startY: number; startHeight: number; moved: boolean } | null = null;

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
    this.drag = { startY: event.clientY, startHeight: this.element.clientHeight, moved: false };
  }

  onPointerMove(event: PointerEvent): void {
    const drag = this.drag;
    if (!drag) return;
    const dy = event.clientY - drag.startY;
    if (Math.abs(dy) > DRAG_THRESHOLD) drag.moved = true;
    if (!drag.moved) return;
    this.dragHeight.set(Math.min(this.fullHeight(), Math.max(MIN_HEIGHT, drag.startHeight - dy)));
  }

  /** Snap to half or full height, close when pulled well below half; a tap toggles. */
  onPointerUp(): void {
    const drag = this.drag;
    const height = this.dragHeight();
    this.drag = null;
    this.dragHeight.set(null);
    if (!drag) return;
    if (!drag.moved || height === null) {
      this.toggle();
      return;
    }
    const half = window.innerHeight * SHEET_RATIO;
    if (height < half * CLOSE_RATIO) this.onClose();
    else this.full.set(height > (half + this.fullHeight()) / 2);
  }

  private fullHeight(): number {
    return window.innerHeight - 2 * SHEET_GAP; // same gap above as below
  }
}
