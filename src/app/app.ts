import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MuscleViewer } from './components/muscle-viewer/muscle-viewer';
import { ExercisePanel } from './components/exercise-panel/exercise-panel';
import { Search } from './components/search/search';
import { I18n, LANGUAGES } from './i18n/i18n';
import { type MeshSelection } from './models/exercise.model';
import { ExerciseService } from './services/exercise.service';
import { UrlState } from './services/url-state';
import { panelLayout } from './layout/panel-layout';

@Component({
  selector: 'app-root',
  imports: [MuscleViewer, ExercisePanel, Search],
  templateUrl: './app.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(window:resize)': 'onResize()',
    '(document:keydown.escape)': 'onEscape($event)',
  },
})
export class App {
  protected readonly exercises = inject(ExerciseService);

  protected readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly languages = LANGUAGES;

  protected readonly legalLinks = computed(() => [
    { label: this.t().menu.imprint, href: 'https://adrianrostin.de/impressum' },
    { label: this.t().menu.privacy, href: 'https://adrianrostin.de/datenschutz' },
  ]);

  protected readonly viewportWidth = signal(window.innerWidth);
  /** Desktop panel position; null on phones, where CSS makes it a bottom sheet. */
  protected readonly sidePanel = computed(() => {
    const layout = panelLayout(this.viewportWidth());
    return layout.mode === 'side' ? layout : null;
  });

  /** Muscles that belong to no family – listed on their own in the accessible muscle nav. */
  protected readonly loneMuscles = computed(() =>
    this.exercises.muscles().filter((m) => m.familyId === null),
  );

  constructor() {
    // Address bar ↔ selection (reload, shared links, back button).
    inject(UrlState);
  }

  /** The app is a single page, so the title link just returns to the start view. */
  protected goHome(event: Event): void {
    event.preventDefault();
    this.exercises.clear();
  }

  /** Esc closes the side menu first; only when it is closed does Esc reach the exercise card. */
  protected onEscape(event: Event): void {
    if (!this.exercises.menuOpen()) return;
    this.exercises.menuOpen.set(false);
    event.stopImmediatePropagation();
  }

  protected onResize(): void {
    this.viewportWidth.set(window.innerWidth);
  }

  protected onMuscleSelected(selection: MeshSelection): void {
    this.exercises.selectByMesh(selection.meshName);
  }

  /** Accessible muscle nav: select a whole muscle family (same as clicking it on the body). */
  protected selectFamily(familyId: string): void {
    this.exercises.selectFamily(familyId);
  }

  /** Accessible muscle nav: select a muscle that has no family. */
  protected selectMuscle(muscleId: string): void {
    this.exercises.selectMuscle(muscleId);
  }
}
