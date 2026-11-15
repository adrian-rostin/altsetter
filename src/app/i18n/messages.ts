import { type Difficulty } from '../models/exercise.model';

/**
 * All texts of the app. German is the reference: `Messages` is derived from it, so the English
 * dictionary must have exactly the same keys (the compiler checks it). Exercise and muscle texts
 * come from the API in the selected language.
 */
const de = {
  siteDescription:
    'Tippe einen Muskel am 3D-Körper an und finde passende Übungen fürs Gym – mit Ausführungstipps und häufigen Fehlern.',

  retry: 'Erneut versuchen',

  menu: {
    open: 'Menü öffnen',
    label: 'Menü',
    close: 'Menü schließen',
    language: 'Sprache',
    imprint: 'Impressum',
    privacy: 'Datenschutz',
    noticeTitle: 'Hinweis',
    notice:
      'Die Übungen und Hinweise dienen der allgemeinen Information und ersetzen keine ärztliche, physiotherapeutische oder trainerische Beratung. Training auf eigene Verantwortung – bei Schmerzen oder Vorerkrankungen bitte vorher fachlichen Rat einholen.',
    sourcesTitle: 'Quellen & Lizenzen',
    model: '3D-Modell:',
    modelLicense:
      '(CC BY-SA 4.0), basierend auf BodyParts3D © The Database Center for Life Science (CC BY-SA 2.1 JP). Für Altsetter bearbeitet; das bearbeitete Modell steht ebenfalls unter',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.de',
    software: 'Software: Angular, Three.js, three-mesh-bvh, Tailwind CSS (MIT-Lizenz).',
    photos: 'Übungsfotos: mit KI erstellt (ChatGPT).',
  },

  panel: {
    shrink: 'Liste verkleinern',
    expand: 'Liste auf Vollbild vergrößern',
    close: 'Schließen',
    all: 'Alle',
    exerciseCount: (n: number) => `${n} ${n === 1 ? 'Übung' : 'Übungen'}`,
    alsoTrains: (name: string) => `Trainiert auch: ${name}`,
    noExercisesFor: 'Noch keine Übungen für',
    back: 'Zurück zu den Übungen',
    focus: 'Fokus',
    alsoTrainsLabel: 'Trainiert auch',
    cues: 'Darauf achten',
    mistakes: 'Häufige Fehler',
    detailFailed: 'Hinweise zur Ausführung konnten gerade nicht geladen werden.',
    detailLoading: 'Hinweise werden geladen …',
    similar: 'Ähnliche Übungen',
    exercisesFailed: 'Die Übungen konnten gerade nicht geladen werden.',
    exercisesLoading: 'Übungen werden geladen …',
    photo: (name: string, moving: boolean) =>
      moving ? `${name}: Start- und Endposition im Wechsel` : `${name}: Ausführung`,
    /** Label under every photo; AI images must be marked as such. */
    aiGenerated: 'KI-generiert',
  },

  search: {
    placeholder: 'Übung suchen',
    open: 'Suche öffnen',
    close: 'Suche schließen',
    noResults: 'Keine passende Übung gefunden.',
    count: (n: number) => `${n} Treffer`,
    loadingMore: 'Weitere werden geladen …',
    failed: 'Die Suche ist gerade nicht erreichbar.',
  },

  difficulty: {
    beginner: 'Anfänger',
    intermediate: 'Mittel',
    advanced: 'Fortgeschritten',
  } satisfies Record<Difficulty, string>,

  viewer: {
    loading: (percent: number) => `Modell wird geladen … ${percent} %`,
    placeholderTitle: 'Platzhalter-Figur.',
    placeholderBefore: 'Lege das Anatomie-Modell unter',
    placeholderAfter: 'ab, um sie zu ersetzen.',
  },
};

export type Messages = typeof de;

const en: Messages = {
  siteDescription:
    'Tap a muscle on the 3D body and find matching gym exercises – with form tips and common mistakes.',

  retry: 'Try again',

  menu: {
    open: 'Open menu',
    label: 'Menu',
    close: 'Close menu',
    language: 'Language',
    imprint: 'Legal notice',
    privacy: 'Privacy',
    noticeTitle: 'Disclaimer',
    notice:
      "The exercises and tips are for general information only and don't replace advice from a doctor, physiotherapist or trainer. Train at your own risk – if you have pain or pre-existing conditions, please get professional advice first.",
    sourcesTitle: 'Sources & licences',
    model: '3D model:',
    modelLicense:
      '(CC BY-SA 4.0), based on BodyParts3D © The Database Center for Life Science (CC BY-SA 2.1 JP). Modified for Altsetter; the modified model is also licensed under',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/deed.en',
    software: 'Software: Angular, Three.js, three-mesh-bvh, Tailwind CSS (MIT licence).',
    photos: 'Exercise photos: AI-generated (ChatGPT).',
  },

  panel: {
    shrink: 'Shrink list',
    expand: 'Expand list to full screen',
    close: 'Close',
    all: 'All',
    exerciseCount: (n: number) => `${n} ${n === 1 ? 'exercise' : 'exercises'}`,
    alsoTrains: (name: string) => `Also trains: ${name}`,
    noExercisesFor: 'No exercises yet for',
    back: 'Back to the exercises',
    focus: 'Focus',
    alsoTrainsLabel: 'Also trains',
    cues: 'Watch out for',
    mistakes: 'Common mistakes',
    detailFailed: "The form tips couldn't be loaded right now.",
    detailLoading: 'Loading tips …',
    similar: 'Similar exercises',
    exercisesFailed: "The exercises couldn't be loaded right now.",
    exercisesLoading: 'Loading exercises …',
    photo: (name: string, moving: boolean) =>
      moving ? `${name}: start and end position, alternating` : `${name}: how it's done`,
    aiGenerated: 'AI-generated',
  },

  search: {
    placeholder: 'Search exercises',
    open: 'Open search',
    close: 'Close search',
    noResults: 'No matching exercise found.',
    count: (n: number) => `${n} ${n === 1 ? 'match' : 'matches'}`,
    loadingMore: 'Loading more …',
    failed: "Search isn't available right now.",
  },

  difficulty: {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
  },

  viewer: {
    loading: (percent: number) => `Loading model … ${percent} %`,
    placeholderTitle: 'Placeholder figure.',
    placeholderBefore: 'Put the anatomy model at',
    placeholderAfter: 'to replace it.',
  },
};

export const MESSAGES = { de, en } as const;
