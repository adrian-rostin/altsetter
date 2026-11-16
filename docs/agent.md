# Agent-Leitfaden: Altsetter (Frontend)

Kurz und vollständig: Was diese App ist, wie sie aufgebaut ist und welche Regeln bei Änderungen
gelten. Für Menschen steht die Einführung im [README](../README.md).

## Idee

Altsetter ist ein Übungsfinder fürs Gym. Das Gerät ist besetzt, man will trotzdem denselben Muskel
trainieren: Man tippt den Muskel an einem anatomischen 3D-Körper an und bekommt alle Übungen, die
ihn trainieren, mit Fotos, Tipps und häufigen Fehlern.

- Live: <https://altsetter.adrianrostin.de>
- Backend: [altsetter-api](https://github.com/adrian-rostin/altsetter-api) (Spring Boot, liest
  nur). Unter derselben Domain, alles unter `/api` geht an die API, deshalb kein CORS.
- Sprachen: Deutsch (Standard) und Englisch.
- Kein Konto, keine Cookies, kein Tracking. Im Browser gespeichert wird nur die Sprache, und nur
  wenn man sie selbst umstellt (Local Storage `altsetter.lang`). Das steht so in der
  Datenschutzerklärung im Portfolio (`portfolio/src/app/pages/legal/datenschutz.ts`). Wer etwas
  daran ändert (Speicher, externe Dienste, neue Daten an die API), muss den Text dort mit anpassen.

## Was wo herkommt

| Daten                                      | Quelle                                                      |
| ------------------------------------------ | ----------------------------------------------------------- |
| Muskeln, Muskelgruppen, Mesh-Zuordnung     | fest in der App: `src/app/data/muscles.ts`                  |
| Übungen (Texte, Equipment, Muskeln, Tipps) | API, erst bei Bedarf geladen                                |
| Übungsfotos (WebP, KI-generiert)           | API, `GET /api/v1/exercises/{id}/images/{start\|end}`       |
| Oberflächentexte, Schwierigkeitsstufen     | `src/app/i18n/messages.ts`                                  |
| 3D-Modell                                  | `public/models/male-anatomy.glb` (Lizenz: `ATTRIBUTION.md`) |

Die Muskeln ändern sich nicht. Ist die API weg, bleibt der Körper klickbar, nur die Übungen fehlen
(mit „Erneut versuchen“). Eine neue Übung braucht nur einen Eintrag in der Datenbank, im Frontend
nichts. Nur ein ganz neuer Muskel muss auch in `muscles.ts`.

IDs sind englisch, klein, mit Bindestrichen (`upper-chest`, `lat-pulldown`) und in allen Sprachen
gleich. Dieselben IDs stehen in den URLs.

## Laden der Übungen

Beim Start wird keine Übung geladen. Alles läuft über `ExerciseService`:

- **Muskel antippen** (oder einen Teil-Tab wie „Obere Brust“ wählen): erste Seite von
  `GET /muscles/{id}/exercises?page=0&size=20`, mit allen Details. Die API liefert in der
  Reihenfolge der Karte (je Teil seine Hauptübungen, danach die mitarbeitenden).
- **Scrollen** nahe ans Ende der Liste: nächste Seite (`ExercisePanel.onScroll` →
  `ExerciseService.loadMore`).
- **Suche, ähnliche Übungen, Links** `/exercises/{id}`: laden einzelne Übungen.
- Alles Geladene landet in einem **Store nach ID** (`store`), die Listen je Muskel halten nur IDs
  (`subjectLists`). Details liegen in `details`.
- **Sprachwechsel:** Listen und Details werden verworfen und für den aktuellen Muskel und die
  offene Übung neu geladen. Die alten Texte bleiben sichtbar, bis die neuen da sind.

## Struktur

```
src/app/
├── app.ts / app.html            Grundgerüst: Viewer, Panel, Suche, Logo, Menü (Sprache, Impressum, Datenschutz)
├── app.config.ts                Provider (HttpClient mit fetch, echte Pfade statt Hash-URLs)
├── components/
│   ├── muscle-viewer/           Three.js-Körper: Laden des GLB, Picking (three-mesh-bvh), Hervorhebung,
│   │                            Kamerafahrt zum Muskel; placeholder-body.ts zeigt sich, bis das Modell da ist
│   ├── exercise-panel/          Karte rechts (Desktop) bzw. Bottom-Sheet (Handy): Überschrift, Tabs der
│   │                            Teile, Übungsliste, Detailseite, ähnliche Übungen; bottom-sheet.ts = Wischen
│   └── search/                  Suchfeld (Strg/Cmd+K), Ergebnisse seitenweise, ?q= in der URL
├── services/
│   ├── altsetter-api.ts         Einziger Zugriff auf die API (typisiert, Accept-Language je Aufruf)
│   ├── exercise.service.ts      Auswahl (Gruppe, Muskel, offene Übung) und alle geladenen Daten
│   └── url-state.ts             URL ↔ Auswahl, Seitentitel, Canonical-Link
├── data/muscles.ts              Muskelkatalog DE/EN
├── models/exercise.model.ts     Typen (gleich den API-DTOs)
├── i18n/                        i18n.ts (Sprach-Signal), messages.ts (alle Texte DE/EN)
├── layout/panel-layout.ts       Position und Größe des Panels am Desktop
└── shared/                      liquid-glass.ts (Glas-Effekt, Direktive appGlass), view-transition.ts,
                                 exercise-format.ts (Labels für Equipment und Schwierigkeit)
src/styles.css                   Tailwind v4, Farbpalette als --pf-*-Variablen (wie das Portfolio)
public/                          Modell, Draco-Decoder, Icons, robots.txt
tools/                           Modell beschneiden (prune-anatomy.mjs), Icons bauen
nginx/                           Konfiguration des Containers (SPA-Fallback, Security-Header)
k8s/                             Deployment, Service, Ingress (Kustomize), Namespace altsetter
```

## URLs

| Pfad                  | Bedeutung                                                                    |
| --------------------- | ---------------------------------------------------------------------------- |
| `/`                   | Startansicht                                                                 |
| `/muscle/{id}`        | Muskelgruppe oder einzelner Muskel ausgewählt                                |
| `/exercises/{id}`     | Übung offen (unter ihrem ersten Hauptmuskel, wenn man über einen Link kommt) |
| `/muscle/{…}/{übung}` | alte Links, werden gelesen und durch `/exercises/…` ersetzt                  |
| `?q=…`                | offene Suche, nur per `replaceState`                                         |

Jede Auswahl wird ein Eintrag im Verlauf, Zurück macht sie rückgängig. Unbekannte IDs führen zu `/`.

## Technik und Konventionen

- **Angular 21**, nur Standalone-Komponenten, Signals, `ChangeDetectionStrategy.OnPush`, zoneless (ohne Zone.js).
  Zustand in Services als `signal`/`computed`, kein RxJS außer für `HttpClient`.
- **Tailwind v4** über PostCSS; Farben nur über die Tokens in `styles.css` (`text-ink`, `bg-surface`,
  `text-accent` …), keine festen Farbwerte in Templates.
- **Animationen:** Öffnen und Schließen einer Übung per View Transitions API. Nur sichtbare Karten
  bekommen `view-transition-name` (sonst ruckelt es). Die 3D-Ansicht pausiert währenddessen
  (`cardAnimating`).
- **Handy zuerst denken:** Panel ist dort ein Bottom-Sheet mit Snap-Punkten, Tabs unten in
  Daumenreichweite. Jede UI-Änderung auf 375 px Breite und am Desktop prüfen.
- **Kommentare und Bezeichner auf Englisch**, Texte für Nutzer in `messages.ts` (DE und EN immer
  beide pflegen). README und `docs/` auf Deutsch.
- **KI-Fotos** müssen sichtbar gekennzeichnet bleiben (Label „KI-generiert“ unten rechts im Bild).
- Lint-Regeln, die oft greifen: `member-ordering` (private nach public), `consistent-type-imports`,
  `prefer-optional-chain`, `no-confusing-void-expression`, kein `$any` in Templates.

## Befehle

```bash
npm install
npm start               # http://localhost:4200, /api → localhost:8080 (proxy.conf.json)
npm run lint            # ESLint
npm run format:check    # Prettier (die Pipeline bricht sonst ab)
npm run format          # Prettier anwenden
npm run build
```

Für echte Daten muss die API lokal laufen (siehe README der API: DB-Tunnel und Profil `local`).
Ohne API startet die App trotzdem, nur ohne Übungen.

Vor jedem Commit: `npm run format:check`, `npm run lint` und `npm run build` müssen durchlaufen.

## CI/CD und Betrieb

`.github/workflows/ci-cd.yml`: Prettier und ESLint → Build → Docker-Image (nginx) nach
`ghcr.io/adrian-rostin/altsetter` → Deploy mit `kubectl apply -k k8s` (nur `main`).
**Ein Push auf `main` geht direkt live.**

## Regeln für die Zusammenarbeit

- Nur committen und pushen, wenn ausdrücklich darum gebeten wird.
- Commit-Nachrichten auf Deutsch, kurz, ohne `Co-Authored-By` oder sonstige KI-Hinweise.
- Ändert sich die API (neue Endpunkte, andere Felder), zuerst die API deployen, dann das Frontend.
- Keine neuen externen Dienste (CDNs, Fonts von Google, Analytics) ohne Rücksprache, wegen
  Datenschutz. Schriften sind selbst gehostet (Fontsource).
