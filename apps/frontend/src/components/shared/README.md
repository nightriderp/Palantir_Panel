# Shared UI / Design-System (F2)

Gemeinsame Bausteine für alle Frontend-Arbeitspakete. **F3–F11 bauen hierauf auf** –
bevor eine eigene Variante entsteht, bitte zuerst hier nachsehen ([CLAUDE.md §6](../../../../../CLAUDE.md)).

Import immer über den Sammelpunkt:

```tsx
import { ServerCard, ConfirmDialog, useToast } from '@/components/shared';
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
| `cn`, `utils/format.ts`            | Klassen-Helfer und deutsche Anzeigeformate – getestet    |

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

## Etwas ergänzen

1. Zuerst prüfen, ob ein vorhandener Baustein per Prop passt.
2. Neue Symbole in `icons/Icon.tsx` ergänzen – 24×24-Viewbox, reine Kontur, keine Füllung.
3. Neue Farb-/Größenwerte als Token in `tailwind.config.ts`, nie literal in der Komponente.
4. Neue Datei anlegen, in `index.ts` exportieren und hier in der Tabelle eintragen.
5. Reine Logik (Zuordnungen, Formatierungen) gehört in eine `.ts`-Datei mit Test daneben.
