import { DOCUMENT } from '@angular/common';
import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { MESSAGES, type Messages } from './messages';

export type Lang = keyof typeof MESSAGES;

/** `label` is shown in the switch, `name` is read out by screen readers. */
export const LANGUAGES: readonly { code: Lang; label: string; name: string }[] = [
  { code: 'de', label: 'DE', name: 'Deutsch' },
  { code: 'en', label: 'EN', name: 'English' },
];

const STORAGE_KEY = 'altsetter.lang';

/**
 * The language of the app. It starts with the last choice, otherwise the browser's preference
 * (German for German browsers, English for everyone else), and is remembered in the browser.
 * The paths are the same in every language; only texts change.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  readonly lang = signal<Lang>(initialLang(inject(DOCUMENT).defaultView));

  /** All texts in the current language, e.g. `i18n.t().menu.open`. */
  readonly t = computed<Messages>(() => MESSAGES[this.lang()]);

  private readonly document = inject(DOCUMENT);

  constructor() {
    effect(() => {
      const lang = this.lang();
      this.document.documentElement.lang = lang;
      this.document
        .querySelector('meta[name="description"]')
        ?.setAttribute('content', MESSAGES[lang].siteDescription);
    });
  }

  /**
   * Switches the language and remembers the choice for the next visit. Only an explicit choice is
   * stored (see the privacy policy); without one the browser language applies.
   */
  setLang(lang: Lang): void {
    this.lang.set(lang);
    try {
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Storage can be blocked (private mode, settings); the choice then lasts for this visit.
    }
  }
}

function initialLang(window: (Window & typeof globalThis) | null): Lang {
  try {
    const stored = window?.localStorage.getItem(STORAGE_KEY);
    if (stored === 'de' || stored === 'en') return stored;
  } catch {
    // See above: fall back to the browser language.
  }
  const preferred = window?.navigator.languages.find((l) => /^(de|en)\b/i.test(l)) ?? '';
  return preferred.toLowerCase().startsWith('de') ? 'de' : 'en';
}
