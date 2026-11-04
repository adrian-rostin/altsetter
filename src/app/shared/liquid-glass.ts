import { DOCUMENT } from '@angular/common';
import { DestroyRef, Directive, ElementRef, afterNextRender, inject } from '@angular/core';

/** How far the background is bent at the glass edge (px), per colour channel for a fine fringe. */
const REFRACTION = { r: 26, g: 29, b: 32 };
/** Width of the curved edge (px); the middle stays clear. */
const MAX_BEZEL = 18;

let nextId = 0;

/**
 * "Liquid glass" like the navigation of the portfolio (adrianrostin.de): frosted, slightly tinted
 * glass with a light edge; in Chromium the background is also refracted at the rounded edge.
 * Looks come from .glass in styles.css; this directive adds the refraction filter that matches the
 * element's size and corner radius.
 *
 * Usage: <button appGlass class="rounded-full …">
 */
@Directive({
  selector: '[appGlass]',
  host: { class: 'glass' },
})
export class Glass {
  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly document = inject(DOCUMENT);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const win = this.document.defaultView;
      if (!win || !supportsRefraction(win)) return;

      const id = `glass-${++nextId}`;
      const svg = this.createFilter(id);
      this.document.body.appendChild(svg);
      let size = '';
      const update = () => {
        const w = this.element.offsetWidth;
        const h = this.element.offsetHeight;
        if (!w || !h || `${w}x${h}` === size) return;
        size = `${w}x${h}`;
        const radius = parseFloat(win.getComputedStyle(this.element).borderTopLeftRadius) || 0;
        const r = Math.min(radius, w / 2, h / 2);
        const map = createDisplacementMap(this.document, w, h, r, Math.min(MAX_BEZEL, r));
        const filter = svg.firstElementChild;
        filter?.setAttribute('width', String(w));
        filter?.setAttribute('height', String(h));
        for (const image of Array.from(svg.querySelectorAll('feImage'))) {
          image.setAttribute('href', map);
          image.setAttribute('width', String(w));
          image.setAttribute('height', String(h));
        }
        this.element.classList.add('refract');
        this.element.style.setProperty('--glass-filter', `url(#${id})`);
      };
      const observer = new ResizeObserver(update);
      observer.observe(this.element);
      update();

      destroyRef.onDestroy(() => {
        observer.disconnect();
        svg.remove();
      });
    });
  }

  /** Bends red, green and blue slightly differently and adds them up again. */
  private createFilter(id: string): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg';
    const el = <K extends keyof SVGElementTagNameMap>(name: K, attrs: Record<string, string>) => {
      const node = this.document.createElementNS(ns, name);
      for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
      return node;
    };
    const svg = el('svg', { 'aria-hidden': 'true', style: 'position:absolute;width:0;height:0' });
    const filter = el('filter', {
      id,
      x: '0',
      y: '0',
      filterUnits: 'userSpaceOnUse',
      'color-interpolation-filters': 'sRGB',
    });
    filter.appendChild(
      el('feImage', { x: '0', y: '0', preserveAspectRatio: 'none', result: 'map' }),
    );
    const channels = [
      ['r', REFRACTION.r, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['g', REFRACTION.g, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'],
      ['b', REFRACTION.b, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0'],
    ] as const;
    for (const [channel, scale, matrix] of channels) {
      filter.appendChild(
        el('feDisplacementMap', {
          in: 'SourceGraphic',
          in2: 'map',
          scale: String(scale),
          xChannelSelector: 'R',
          yChannelSelector: 'G',
          result: `d${channel}`,
        }),
      );
      filter.appendChild(
        el('feColorMatrix', { in: `d${channel}`, values: matrix, result: channel }),
      );
    }
    filter.appendChild(el('feBlend', { in: 'r', in2: 'g', mode: 'screen', result: 'rg' }));
    filter.appendChild(el('feBlend', { in: 'rg', in2: 'b', mode: 'screen' }));
    svg.appendChild(filter);
    return svg;
  }
}

/**
 * Displacement map for the glass edge: near the edge of a rounded rectangle the background is bent
 * inwards like through a curved glass rim; the middle stays clear.
 * Encoding for feDisplacementMap: red = shift in x, green = shift in y (128 = none).
 */
function createDisplacementMap(
  doc: Document,
  width: number,
  height: number,
  radius: number,
  bezel: number,
): string {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const r = Math.min(radius, w / 2, h / 2);
  const canvas = doc.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const img = ctx.createImageData(w, h);
  const px = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      // Distance to the inner rectangle (the area without the rounding) → direction and depth.
      const cx = x + 0.5;
      const cy = y + 0.5;
      const vx = cx - Math.min(Math.max(cx, r), w - r);
      const vy = cy - Math.min(Math.max(cy, r), h - r);
      const len = Math.hypot(vx, vy);
      const edge = r - len; // distance to the edge, positive inside
      let dx = 0;
      let dy = 0;
      if (edge > 0 && edge < bezel && len > 0) {
        const t = 1 - edge / bezel; // 1 right at the edge, 0 where the rim ends
        const m = t * t * (3 - 2 * t); // smooth, like a curved rim
        dx = (-vx / len) * m;
        dy = (-vy / len) * m;
      }
      const i = (y * w + x) * 4;
      px[i] = 128 + dx * 127;
      px[i + 1] = 128 + dy * 127;
      px[i + 2] = 128;
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** Only Chromium applies SVG filters as backdrop-filter; everyone else gets frosted glass. */
function supportsRefraction(win: Window): boolean {
  return /Chrome\/\d+/.test(win.navigator.userAgent);
}
