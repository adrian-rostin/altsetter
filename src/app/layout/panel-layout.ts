/**
 * Where the exercise panel goes and where the body should move to make room for it.
 * Used by the app (panel position) and the 3D viewer (camera offset), so both always agree.
 *
 * Desktop: body column + gap + panel form one block that is centred on screen.
 * Phone:   the panel is a bottom sheet; the body shrinks into the space above it.
 */
export const MOBILE_BREAKPOINT = 768;

const PANEL_MAX_WIDTH = 1000;
const PANEL_WIDTH_RATIO = 0.6;
const BODY_COLUMN_MAX = 380;
const BODY_COLUMN_RATIO = 0.34;
const GAP = 48;
const EDGE = 24;

/** Share of the height the bottom sheet covers on phones (keep in sync with h-[55dvh] in app.html). */
export const SHEET_RATIO = 0.55;
/** Space the app name takes at the top on phones. */
export const MOBILE_HEADER_HEIGHT = 64;

export interface SidePanelLayout {
  mode: 'side';
  panelLeft: number;
  panelWidth: number;
  /**
   * The free area left of the panel (from the screen edge to the gap before the panel), in px.
   * The selected muscle group is centred and framed in here.
   */
  freeLeft: number;
  freeRight: number;
  /** Where the body's / selected group's centre goes: the middle of the free area. */
  bodyCenterX: number;
}

export interface SheetLayout {
  mode: 'sheet';
}

/**
 * Phones: the free space between the app name and the bottom sheet, and the camera zoom that
 * scales the whole picture into it.
 */
export function sheetFrame(height: number): { freeTop: number; freeBottom: number; zoom: number } {
  const freeTop = MOBILE_HEADER_HEIGHT;
  const freeBottom = height * (1 - SHEET_RATIO);
  return { freeTop, freeBottom, zoom: ((freeBottom - freeTop) / height) * 0.95 };
}

export function panelLayout(width: number): SidePanelLayout | SheetLayout {
  if (width < MOBILE_BREAKPOINT) return { mode: 'sheet' };
  const bodyColumn = Math.min(BODY_COLUMN_MAX, width * BODY_COLUMN_RATIO);
  // As wide as allowed, but never past the right edge.
  const panelWidth = Math.min(
    PANEL_MAX_WIDTH,
    width * PANEL_WIDTH_RATIO,
    width - 2 * EDGE - bodyColumn - GAP,
  );
  const total = bodyColumn + GAP + panelWidth;
  const start = Math.max(EDGE, (width - total) / 2);
  const panelLeft = start + bodyColumn + GAP;
  const freeLeft = EDGE;
  const freeRight = panelLeft - GAP;
  return {
    mode: 'side',
    panelLeft,
    panelWidth,
    freeLeft,
    freeRight,
    bodyCenterX: (freeLeft + freeRight) / 2,
  };
}
