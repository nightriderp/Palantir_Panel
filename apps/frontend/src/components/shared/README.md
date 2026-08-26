# Shared UI / Design-System (F2)

Gemeinsame Bausteine für alle Frontend-Arbeitspakete. **F3–F11 bauen hierauf auf** –
bevor eine eigene Variante entsteht, bitte zuerst hier nachsehen ([CLAUDE.md §6](../../../../../CLAUDE.md)).

Import immer über den Sammelpunkt:

```tsx
import { ServerCard, TextField, ConfirmDialog, useToast } from '@/components/shared';
```

## Grundregeln

- **Rein darstellend.** Jede Komponente bekommt ihre Daten per Props und meldet Aktionen
  per Callback nach oben. Kein Laden von Daten, kein Router-Zugriff, kein globaler Zustand.
- **Keine Berechtigungslogik im Frontend.** Ob eine Schaltfläche erscheint, entscheidet
  ausschließlich das `permissions`-Objekt aus dem DTO (Pflichtenheft §5.2). Nie aus einer
  Rolle ableiten.
- **Typen kommen aus `@palantir/contracts`.** Fehlt ein Typ, entsteht er dort in einem
  eigenen kleinen PR – nicht als lokale Parallelstruktur.
- **Oberflächensprache Deutsch** (Lastenheft §4), **Mobile-First** (Lastenheft §4).
- **Keine literalen Farb-, Radius- oder Schriftwerte** in Komponenten. Nur die Tokens aus
  [`tailwind.config.ts`](../../../tailwind.config.ts).

## Design-Tokens

Abgeleitet aus dem Referenz-Mockup (`docs/mockup/`), das die Werte noch literal im Markup
führt. Vollständige Liste mit Kommentaren in `apps/frontend/tailwind.config.ts`.

| Gruppe    | Tokens                                                                                          |
| --------- | ----------------------------------------------------------------------------------------------- |
| Flächen   | `canvas`, `surface`, `surface-muted`, `surface-deep`, `fill`, `fill-strong`                     |
| Text      | `ink`, `ink-muted`, `ink-soft`, `ink-faint`, `ink-disabled`                                     |
| Marke     | `brand`, `brand-bright`, `brand-soft`, `brand-line`, `accent`                                   |
| Zustände  | `success`, `warning`, `caution`, `danger` (je mit `-soft` / `-line`)                            |
| Linien    | `line`, `line-strong`                                                                           |
| Verläufe  | `bg-brand-gradient`, `bg-card-gradient`, `bg-app-glow`                                          |
| Schrift   | `font-sans` (Space Grotesk), `font-mono` (JetBrains Mono)                                       |
| Größen    | `text-3xs` … `text-5xl` – **`text-base` ist 13px**, nicht 16px                                  |
| Radien    | `rounded-sm` 6 · `rounded` 8 · `rounded-md` 10 · `rounded-tile` 11 · `rounded-xl` 14 · `2xl` 16 |
| Schatten  | `shadow-panel`, `shadow-modal`, `shadow-brand`                                                  |
| Animation | `animate-pulse-dot`, `animate-fade-up`, `animate-materialize`, `animate-startup-sweep`          |

Globale Grundlagen (Body-Farben, Fokus-Ring, Formular-Elemente, Scrollbalken,
`prefers-reduced-motion`) stehen in [`src/app/globals.css`](../../app/globals.css).

## Komponenten

### Server

| Komponente         | Zweck                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------- |
| `ServerCard`       | Zentrale Karte der Serverübersicht: Status, Kennzahlen, Adresse, Aktionen                      |
| `ServerStatusPill` | Statuspille mit Punkt – alle sieben Lifecycle-Zustände aus Pflichtenheft §9                    |
| `MetricRing`       | Ringförmige Kennzahl (CPU, RAM, Platte, Ping)                                                  |
| `serverStatus.ts`  | `SERVER_STATUS_META`, `startStopAction`, `isLifecycleActionBlocked`, `hasLiveStats` – getestet |

```tsx
<ServerCard
  server={server} // GameServerDto inkl. permissions
  stats={liveStats} // ServerLiveStats aus dem WS-Kanal, optional
  isOwn={server.ownerId === currentUserId}
  pinned={pinnedIds.includes(server.id)}
  onStart={(s) => startServer(s.id)}
  onStop={(s) => setConfirm({ type: 'stop', server: s })}
  onRestart={(s) => setConfirm({ type: 'restart', server: s })}
  onOpen={(s) => router.push(`/servers/${s.id}`)}
  onCopyAddress={(address) => {
    void navigator.clipboard.writeText(address);
    toast.success('Adresse kopiert.');
  }}
/>
```

Die Karte zeigt Start/Stopp, Neustart, Anheften und „Verwalten“ **nur**, wenn das
`permissions`-Objekt das jeweils hergibt. Während `creating`, `starting` und `stopping`
sind die Lifecycle-Schaltflächen gesperrt, weil bereits ein Übergang läuft; die
verbindliche Prüfung macht trotzdem das Backend.

**Bewusste Abweichung vom Mockup:** Dort haben RAM und Platte feste Farben. Hier färben
sich alle Auslastungsringe nach Schwellwert (bis 50 % Marke, bis 75 % Warnung, darüber
Gefahr), damit ein Engpass überall gleich aussieht.

### Rückmeldungen

| Komponente            | Zweck                                                             |
| --------------------- | ----------------------------------------------------------------- |
| `ToastProvider`       | Stellt die Einblendungen bereit – einmal im Dashboard-Layout      |
| `useToast()`          | `show` / `success` / `warning` / `error` / `dismiss`              |
| `Modal`               | Basis-Dialog: Escape, Hintergrundklick, Fokus, Scroll-Sperre      |
| `ConfirmDialog`       | Bestätigung für umkehrbare Aktionen (Neustart, Wiederherstellung) |
| `DangerConfirmDialog` | Endgültige Aktionen, optional mit abzutippendem Bestätigungstext  |
| `FormModal`           | Formulardialog samt Aktionsleiste und Fehlerzeile                 |

```tsx
const toast = useToast();
toast.success('Adresse kopiert.');

<DangerConfirmDialog
  open={open}
  onClose={close}
  title="Server löschen?"
  message={`„${server.name}“ wird endgültig gelöscht, inklusive aller Welten und Backups.`}
  confirmationPhrase={server.name}
  onConfirm={remove}
/>;
```

### Formulare

Die Bausteine, aus denen jedes Formular im Panel besteht. Sie sind der Grund, warum kein
Arbeitspaket mehr eigene Eingabefelder baut – F1 und F3 hatten das getan, jeweils leicht
anders, und stellen seit R4 auf diese Fassung um.

| Baustein      | Zweck                                                                      |
| ------------- | -------------------------------------------------------------------------- |
| `FieldShell`  | Rahmen aus Beschriftung, Feld und Hinweis- bzw. Fehlerzeile                |
| `TextField`   | Einzeiliges Feld (`text`, `password`, `email`), optional mit Zusatz rechts |
| `NumberField` | Zahlenfeld mit `min`/`max`/`step` – meldet eine Zahl, keinen Text          |
| `SelectField` | Auswahlliste, optional mit vorangestelltem Platzhalter-Eintrag             |
| `SliderField` | Schieberegler für Ressourcen – auf dem Smartphone gut zu treffen           |
| `Toggle`      | Schalter (`role="switch"`), wenn daneben schon Text steht                  |
| `ToggleRow`   | Zeile aus Titel, Erläuterung und Schalter                                  |
| `FormMessage` | Meldungszeile **im** Formular – nicht Toast, nicht Modal                   |

Alle Felder arbeiten kontrolliert: Wert per Prop hinein, neuer Wert per `onChange` hinaus.
`onChange` bekommt bereits den fertigen Wert (`string` bzw. `number`), nicht das Ereignis.

```tsx
<TextField
  label="Benutzername"
  value={username}
  onChange={setUsername}
  error={fieldErrors.username} // ersetzt den Hinweis, färbt den Rahmen, wird vorgelesen
  hint="Später nicht mehr änderbar."
  autoComplete="username"
  placeholder="z. B. alex"
/>
```

Wissenswertes:

- **Fehler statt Hinweis.** `error` verdrängt `hint`; das Feld bekommt `aria-invalid` und
  über `aria-describedby` einen Verweis auf die Meldung. Nie beides gleichzeitig zeigen.
- **`labelVariant`.** `plain` (Standard) für Dashboard-Formulare, `caps` für die
  Anmelde-Ansichten – dort steht die Beschriftung in Versalien über dem Feld.
- **`inputProps` und `inputClassName`** am `TextField` sind für Sonderfälle gedacht
  (`inputMode`, `maxLength`, zentrierter 2FA-Code). Alles, was mehr als eine Ansicht
  braucht, gehört stattdessen als benannte Prop in die Komponente.
- **`FormMessage` ist kein Toast.** Sie gehört zum Formular und bleibt stehen, solange der
  Zustand gilt. Für eine Rückmeldung zu einer abgeschlossenen Aktion ist `useToast()`
  zuständig, für eine Rückfrage `ConfirmDialog`.
- **Kein Formularzustand.** Die Bausteine halten nichts – Werte, Fehler und Absenden
  liegen im aufrufenden Arbeitspaket. Feldfehler kommen aus dem Fehlercode der Antwort,
  nie aus dem technischen Freitext (Pflichtenheft §5.1).

### Layout

| Komponente         | Zweck                                                                     |
| ------------------ | ------------------------------------------------------------------------- |
| `AppShell`         | Seitenrahmen: Seitenleiste (ab `md` fest, darunter Schublade), Kopfleiste |
| `SideNavSection`   | Gruppe von Navigationseinträgen, mit Zähler-Badge                         |
| `PageHeader`       | Titel, Untertitel, Seitenaktionen                                         |
| `Tabs`             | Reiter mit Unterstrich, inkl. gesperrtem Zustand samt Begründung          |
| `SegmentedControl` | Filterumschalter („Alle / Online / Offline“)                              |

### Bausteine

| Komponente                         | Zweck                                                    |
| ---------------------------------- | -------------------------------------------------------- |
| `Button`, `IconButton`             | `primary` · `secondary` · `success` · `danger` · `ghost` |
| `Badge`, `StatusDot`, `CountBadge` | Zustands- und Zählerhinweise über die `Tone`-Skala       |
| `Panel`, `MetricTile`              | Flächen für Karten, Popover und Kennzahlen               |
| `EmptyState`                       | Leerzustand mit optionaler Aktion                        |
| `Icon`, `LogoMark`                 | Icon-Set (24×24, `currentColor`) und Palantir-Signet     |
| `cn`, `utils/format.ts`            | Klassen-Helfer, deutsche Zahlen- und Datumsformate       |

### Phase-2/3-Platzhalter

`PhaseLockedPlaceholder` ist der **einzige** „Kommt später“-Zustand im Panel und wird von
F9 (Skins) und F11 (Templates, Bilder, Sticker, Arcade-Musik) genutzt:

```tsx
<PhaseLockedPlaceholder
  title="Skins"
  description="Skins lassen sich einrichten, sobald das erste Spiel vollständig unterstützt wird."
  phase={2}
  icon="palette"
/>
```

Für „hier ist gerade nichts“ (leere Liste, kein Suchtreffer) ist stattdessen `EmptyState`
zuständig.

## Navigation im eingeloggten Bereich

Das Layout unter `src/app/(dashboard)` (`layout.tsx`, `DashboardShell`, `DashboardNav`,
`SessionProvider`) gehört keinem Arbeitspaket aus [STRUKTUR.md](../../../../../STRUKTUR.md);
F3 hat es angelegt, weil die Serverübersicht die erste Ansicht darunter war. Damit F4–F11
das nicht jedes Mal neu herausfinden müssen, gilt folgende Regel.

**Die Seitenleiste kennt alle geplanten Einträge von Anfang an.** In
[`DashboardNav.tsx`](<../../app/(dashboard)/DashboardNav.tsx>) stehen sie als
`PlannedEntry`. Ein Eintrag ohne `href` führt nirgendwo hin und meldet beim Antippen, dass
die Ansicht noch entsteht – statt in eine 404-Seite zu laufen.

**Ein fertiges Arbeitspaket ändert genau eine Zeile:** `pending` raus, `href` rein.

```ts
// vorher
{ key: 'my-backups', label: 'Meine Backups', icon: 'database', pending: 'F4' },
// nachher
{ key: 'my-backups', label: 'Meine Backups', icon: 'database', href: '/my-backups' },
```

Dazu gehört die Seite selbst unter `src/app/(dashboard)/<pfad>/page.tsx`; die
Platzhalter-Ordner mit `.gitkeep` liegen bereits dort.

Was dabei **nicht** zu tun ist:

- **Keine neue Navigationsleiste.** Wer einen Bereich mit Unterseiten baut, nutzt `Tabs`
  innerhalb der Seite, nicht eine zweite Seitenleiste.
- **Keine Berechtigungslogik.** Ob ein Eintrag erscheint, entscheidet allein das Feld aus
  `AccountDto.permissions`, das in `requires` steht (Pflichtenheft §5.2, §8). Nie aus einer
  Rolle herleiten und nie eine eigene Prüfung danebenstellen. Ein Eintrag ohne `requires`
  ist für alle eingeloggten Konten sichtbar.
- **Kein Umsortieren.** Die Reihenfolge folgt dem Mockup (`docs/mockup/`).
- **Kein Entfernen fremder Einträge**, auch nicht vorübergehend – sie gehören anderen
  Sitzungen.

Ein neues Symbol für einen Eintrag kommt nach `icons/Icon.tsx` (24×24, reine Kontur).

## Tests

Zwei Arten, getrennt gehalten (siehe [`vitest.config.ts`](../../../vitest.config.ts)):

| Datei        | Umgebung | Wofür                                                     |
| ------------ | -------- | --------------------------------------------------------- |
| `*.test.ts`  | Node     | Reine Logik: Zuordnungen, Formatierungen, Zustandswechsel |
| `*.test.tsx` | jsdom    | Gerenderte Komponenten mit Testing Library                |

jsdom wird nur für `.tsx` hochgefahren, damit die Logiktests schnell bleiben. Aufräumen
nach jedem Test übernimmt [`vitest.setup.ts`](../../../vitest.setup.ts).

```bash
pnpm --filter @palantir/frontend test
```

Was ein Komponententest prüfen soll: was der Nutzer sieht und auslöst – also
`getByRole` / `getByLabelText` statt Klassennamen oder Testkennungen. Beispiele stehen in
`form/Fields.test.tsx`.

## Etwas ergänzen

1. Zuerst prüfen, ob ein vorhandener Baustein per Prop passt.
2. Neue Symbole in `icons/Icon.tsx` ergänzen – 24×24-Viewbox, reine Kontur, keine Füllung.
3. Neue Farb-/Größenwerte als Token in `tailwind.config.ts`, nie literal in der Komponente.
4. Neue Datei anlegen, in `index.ts` exportieren und hier in der Tabelle eintragen.
5. Reine Logik (Zuordnungen, Formatierungen) gehört in eine `.ts`-Datei mit Test daneben.
6. Für eine neue Komponente einen `.test.tsx` daneben legen – seit R4 gibt es dafür die
   Umgebung (siehe [Tests](#tests)), ein Baustein ohne Test hat hier nichts verloren.
