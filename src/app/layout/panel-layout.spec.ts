import { describe, it, expect } from 'vitest';
import { MOBILE_BREAKPOINT, panelLayout, sheetFrame, type SidePanelLayout } from './panel-layout';

describe('panelLayout', () => {
  it('is a bottom sheet below the mobile breakpoint', () => {
    expect(panelLayout(MOBILE_BREAKPOINT - 1)).toEqual({ mode: 'sheet' });
    expect(panelLayout(375)).toEqual({ mode: 'sheet' });
  });

  it('is a side panel at the breakpoint and above', () => {
    expect(panelLayout(MOBILE_BREAKPOINT).mode).toBe('side');
    expect(panelLayout(1440).mode).toBe('side');
  });

  it('never lets the panel run past the right edge (24px gutter)', () => {
    for (const width of [768, 1024, 1440, 1920, 3440]) {
      const l = panelLayout(width) as SidePanelLayout;
      expect(l.panelLeft + l.panelWidth).toBeLessThanOrEqual(width - 24 + 0.001);
      expect(l.panelWidth).toBeGreaterThan(0);
      expect(l.panelWidth).toBeLessThanOrEqual(1000 + 0.001);
    }
  });

  it('centres the body in the free area left of the panel', () => {
    const l = panelLayout(1440) as SidePanelLayout;
    expect(l.bodyCenterX).toBeCloseTo((l.freeLeft + l.freeRight) / 2);
    expect(l.freeLeft).toBeLessThan(l.freeRight);
  });
});

describe('sheetFrame', () => {
  it('leaves room for the header on top and the sheet below', () => {
    const { freeTop, freeBottom, zoom } = sheetFrame(800);
    expect(freeTop).toBe(64);
    expect(freeBottom).toBeLessThan(800);
    expect(freeBottom).toBeGreaterThan(freeTop);
    expect(zoom).toBeGreaterThan(0);
    expect(zoom).toBeLessThan(1);
  });
});
