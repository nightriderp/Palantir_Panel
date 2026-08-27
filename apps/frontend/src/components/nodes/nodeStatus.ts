import {
  type GameTypeDto,
  type HostNodeDto,
  type HostNodeStatus,
  type ServerResourceLimits,
} from '@palantir/contracts';
import { type Tone, formatMegabytes, formatNumber } from '@/components/shared';

/**
 * Ableitungen für die Node-Ansicht aus Nutzersicht (Lastenheft §3.7).
 *
 * Alles hier ist reine Funktion ohne React und deshalb direkt testbar
 * (`nodeStatus.test.ts`). Die Ansichten daneben stellen nur dar, was hier
 * entschieden wird – Text und Farbe eines Zustands stehen genau einmal.
 *
 * Oberflächensprache ist Deutsch (Lastenheft §4). Die Texte richten sich
 * ausdrücklich an Nutzer ohne technisches Vorwissen (Lastenheft §4,
 * „Bedienbarkeit"): keine Fachbegriffe ohne Erklärung, keine Interna.
 */

// ---------------------------------------------------------------------------
// Zustand einer Node
// ---------------------------------------------------------------------------

export interface NodeStatusMeta {
  /** Kurzform für die Statuspille. */
  label: string;
  /** Was der Zustand für den Nutzer bedeutet – eine Zeile, kein Fachjargon. */
  description: string;
  tone: Tone;
  /** Punkt pulsiert, solange die Node tatsächlich verbunden ist. */
  pulse: boolean;
  /** Nimmt diese Node gerade neue Serverstarts an? */
  acceptsStarts: boolean;
}

/**
 * Einzige Stelle im Frontend, an der ein {@link HostNodeStatus} in Text und
 * Farbe übersetzt wird – analog zu `SERVER_STATUS_META` aus F2 für Server.
 *
 * `maintenance` ist bewusst `warning` und nicht `danger`: eine Wartung ist ein
 * geplanter Zustand, kein Ausfall. Beides sieht für den Nutzer zunächst gleich
 * aus („mein Server startet nicht"), der Unterschied gehört deshalb in den
 * Erklärtext.
 */
export const NODE_STATUS_META: Record<HostNodeStatus, NodeStatusMeta> = {
  online: {
    label: 'Online',
    description: 'Der Homeserver ist verbunden und nimmt Serverstarts an.',
    tone: 'success',
    pulse: true,
    acceptsStarts: true,
  },
  offline: {
    label: 'Offline',
    description:
      'Der Homeserver ist gerade nicht erreichbar. Bereits laufende Server sind währenddessen nicht spielbar, und neue Server lassen sich nicht starten.',
    tone: 'danger',
    pulse: false,
    acceptsStarts: false,
  },
  maintenance: {
    label: 'Wartung',
    description:
      'Der Homeserver wurde bewusst stillgelegt, zum Beispiel für ein Update. Neue Server lassen sich so lange nicht starten.',
    tone: 'warning',
    pulse: false,
    acceptsStarts: false,
  },
};

export function nodeStatusMeta(status: HostNodeStatus): NodeStatusMeta {
  return NODE_STATUS_META[status];
}

// ---------------------------------------------------------------------------
// Auslastung und freie Kapazität
// ---------------------------------------------------------------------------

export type NodeMetricKey = 'cpu' | 'ram' | 'disk';

export interface NodeMetric {
  key: NodeMetricKey;
  /** Beschriftung in Alltagssprache, nicht der Feldname aus dem DTO. */
  label: string;
  /** Belegter Anteil, z. B. `12,5 GB`. */
  usedLabel: string;
  /** Gesamtausstattung, z. B. `16 GB`. */
  totalLabel: string;
  /** Was davon noch frei ist, z. B. `3,5 GB`. */
  freeLabel: string;
  /** Füllgrad 0–100; `null`, wenn die Node keine Ausstattung meldet. */
  percent: number | null;
  tone: Tone;
}

/** Ab diesem Füllgrad wird die Anzeige gelb, ab {@link CRITICAL_PERCENT} rot. */
const WARN_PERCENT = 80;
const CRITICAL_PERCENT = 95;

function toneForFill(percent: number | null): Tone {
  if (percent === null) return 'neutral';
  if (percent >= CRITICAL_PERCENT) return 'danger';
  if (percent >= WARN_PERCENT) return 'warning';
  return 'brand';
}

/** Anteil in Prozent; `null`, wenn die Bezugsgröße fehlt oder 0 ist. */
export function percentOf(used: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((used / total) * 100);
}

/** CPU-Kerne mit deutschem Dezimalkomma, z. B. `7,5 Kerne`. */
export function formatCores(cores: number): string {
  const rounded = Math.round(cores * 10) / 10;
  return `${formatNumber(rounded)} ${rounded === 1 ? 'Kern' : 'Kerne'}`;
}

/**
 * Die drei Balken einer Node-Karte.
 *
 * Grundlage ist ausschließlich `capacity` (Gesamt, vergeben, frei) und **nicht**
 * zusätzlich `usage`: Beide Felder enthalten laut Pflichtenheft §10 derzeit
 * dieselbe Zahl – die reservierten Limits der Server, nicht den vom
 * Betriebssystem gemessenen Verbrauch. Zwei Anzeigen für einen Wert würden nur
 * so aussehen, als gäbe es zwei Messungen. Was die Zahl bedeutet, sagt der
 * Erklärtext (siehe {@link NODE_EXPLAINERS}).
 */
export function nodeMetrics(node: HostNodeDto): NodeMetric[] {
  const { total, allocated, available } = node.capacity;

  const cpuPercent = percentOf(allocated.cpuCores, total.cpuCores);
  const ramPercent = percentOf(allocated.ramMb, total.ramMb);
  const diskPercent = percentOf(allocated.diskMb, total.diskMb);

  return [
    {
      key: 'cpu',
      label: 'Rechenleistung',
      usedLabel: formatCores(allocated.cpuCores),
      totalLabel: formatCores(total.cpuCores),
      freeLabel: formatCores(available.cpuCores),
      percent: cpuPercent,
      tone: toneForFill(cpuPercent),
    },
    {
      key: 'ram',
      label: 'Arbeitsspeicher',
      usedLabel: formatMegabytes(allocated.ramMb),
      totalLabel: formatMegabytes(total.ramMb),
      freeLabel: formatMegabytes(available.ramMb),
      percent: ramPercent,
      tone: toneForFill(ramPercent),
    },
    {
      key: 'disk',
      label: 'Speicherplatz',
      usedLabel: formatMegabytes(allocated.diskMb),
      totalLabel: formatMegabytes(total.diskMb),
      freeLabel: formatMegabytes(available.diskMb),
      percent: diskPercent,
      tone: toneForFill(diskPercent),
    },
  ];
}

// ---------------------------------------------------------------------------
// Kennzahlen über alle Nodes
// ---------------------------------------------------------------------------

export interface NodesSummaryEntry {
  key: string;
  label: string;
  value: string;
  note: string;
}

/**
 * Kopfzeile der Übersicht (Mockup, Seite „Nodes").
 *
 * Zählt bewusst nur über die Nodes, die der Aufrufer sehen darf – eine
 * ausgeblendete Node darf sich nicht über eine Summe verraten.
 */
export function nodesSummary(nodes: HostNodeDto[]): NodesSummaryEntry[] {
  const online = nodes.filter((node) => node.status === 'online').length;
  const servers = nodes.reduce((sum, node) => sum + node.serverCount, 0);
  const freeRamMb = nodes.reduce((sum, node) => sum + node.capacity.available.ramMb, 0);
  const freeDiskMb = nodes.reduce((sum, node) => sum + node.capacity.available.diskMb, 0);

  return [
    {
      key: 'online',
      label: 'Verbunden',
      value: `${formatNumber(online)}/${formatNumber(nodes.length)}`,
      note: 'Erreichbare Homeserver gegenüber allen eingerichteten.',
    },
    {
      key: 'servers',
      label: 'Server',
      value: formatNumber(servers),
      note: 'Angelegte Gameserver auf allen Homeservern zusammen.',
    },
    {
      key: 'ram',
      label: 'Freier Arbeitsspeicher',
      value: formatMegabytes(freeRamMb),
      note: 'Was für weitere Server noch reserviert werden kann.',
    },
    {
      key: 'disk',
      label: 'Freier Speicherplatz',
      value: formatMegabytes(freeDiskMb),
      note: 'Platz für Weltdaten und Backups.',
    },
  ];
}

// ---------------------------------------------------------------------------
// Reicht es noch für einen neuen Server?
// ---------------------------------------------------------------------------

export interface SmallestGameType {
  name: string;
  limits: ServerResourceLimits;
}

/**
 * Der sparsamste Spieltyp, den man aktuell überhaupt anlegen kann.
 *
 * Er ist der Maßstab für „ginge jetzt noch ein Server?": Passt nicht einmal er,
 * passt keiner. Gesperrte Spieltypen (`available === false`, Phase 2/3) zählen
 * nicht mit – sie lassen sich ohnehin nicht wählen.
 *
 * Sortiert wird nach Arbeitsspeicher, weil das in der Praxis die knappe Größe
 * ist; bei Gleichstand entscheidet der Speicherplatz.
 */
export function smallestGameType(gameTypes: GameTypeDto[]): SmallestGameType | null {
  const candidates = gameTypes.filter((type) => type.available);
  if (candidates.length === 0) return null;

  const smallest = candidates.reduce((best, current) => {
    const a = current.resourceDefaults;
    const b = best.resourceDefaults;
    if (a.ramMb !== b.ramMb) return a.ramMb < b.ramMb ? current : best;
    return a.diskMb < b.diskMb ? current : best;
  });

  return { name: smallest.name, limits: smallest.resourceDefaults };
}

export interface StartCapacityHint {
  /** Kurzer Titel des Hinweisfelds. */
  title: string;
  /** Erklärung samt Handlungsempfehlung. */
  description: string;
}

/** Passt der Bedarf in die freie Kapazität dieser Node? */
export function nodeHasRoomFor(node: HostNodeDto, needed: ServerResourceLimits): boolean {
  const free = node.capacity.available;
  return (
    free.ramMb >= needed.ramMb && free.cpuCores >= needed.cpuCores && free.diskMb >= needed.diskMb
  );
}

/**
 * Hinweis, wenn ein Serverstart mangels Node-Kapazität nicht möglich wäre
 * (Arbeitspaket F7, zweite Prüfung aus Pflichtenheft §10).
 *
 * `null` heißt: es passt noch etwas – dann steht bewusst kein Kasten da. Der
 * Hinweis erscheint nur, wenn er etwas zu sagen hat.
 *
 * Das eigene Kontingent des Nutzers (Pflichtenheft §10, erste Prüfung) bleibt
 * hier außen vor: Diese Ansicht beschreibt die Homeserver, nicht das Konto. Den
 * Kontingent-Teil beantwortet der Erstellungs-Wizard in F3.
 */
export function startCapacityHint(
  nodes: HostNodeDto[],
  gameTypes: GameTypeDto[],
): StartCapacityHint | null {
  if (nodes.length === 0) return null;

  const onlineNodes = nodes.filter((node) => nodeStatusMeta(node.status).acceptsStarts);
  if (onlineNodes.length === 0) {
    const inMaintenance = nodes.every((node) => node.status === 'maintenance');
    return {
      title: 'Zurzeit lässt sich kein Server starten',
      description: inMaintenance
        ? 'Alle Homeserver sind in Wartung. Sobald die Wartung beendet ist, funktionieren Starts wieder von allein – du musst nichts tun.'
        : 'Kein Homeserver ist gerade erreichbar. Solange das so ist, nimmt Palantir keine Serverstarts an. Meist genügt es, später erneut nachzusehen.',
    };
  }

  const smallest = smallestGameType(gameTypes);
  if (smallest === null) return null;

  if (onlineNodes.some((node) => nodeHasRoomFor(node, smallest.limits))) return null;

  return {
    title: 'Der Platz reicht für keinen weiteren Server',
    description: `Selbst der sparsamste Spieltyp („${smallest.name}") braucht ${formatMegabytes(
      smallest.limits.ramMb,
    )} Arbeitsspeicher, ${formatCores(smallest.limits.cpuCores)} und ${formatMegabytes(
      smallest.limits.diskMb,
    )} Speicherplatz – so viel ist auf keinem verbundenen Homeserver mehr frei. Ein nicht mehr genutzter Server, den du löschst, gibt seinen Platz sofort wieder frei.`,
  };
}

// ---------------------------------------------------------------------------
// Erklärtexte
// ---------------------------------------------------------------------------

export interface NodeExplainer {
  title: string;
  body: string;
}

/**
 * „Was ist das hier überhaupt?" – die Erklärhinweise aus dem Arbeitspaket F7.
 *
 * Bewusst hier als Daten und nicht als Markup in der Ansicht: So stehen sie an
 * einer Stelle, lassen sich prüfen und tauchen im Dialog wie im Seitenkopf in
 * derselben Fassung auf.
 *
 * Keiner dieser Texte nennt Interna – keine Tunnel-Adressen, keine Schlüssel,
 * keine Zugangs-Tokens. Wer eine Node einrichtet, tut das in der
 * Node-Verwaltung (F10) und nicht hier.
 */
export const NODE_EXPLAINERS: NodeExplainer[] = [
  {
    title: 'Was ist ein Homeserver („Node")?',
    body: 'Ein Homeserver ist der Rechner, auf dem deine Gameserver tatsächlich laufen. Palantir selbst ist nur die Bedienoberfläche: Du drückst hier auf „Starten", die Arbeit macht der Homeserver. Diese Seite zeigt dir, wie es ihm geht.',
  },
  {
    title: 'Was bedeutet der Zustand?',
    body: `„${NODE_STATUS_META.online.label}" heißt: alles läuft, Server lassen sich starten. „${NODE_STATUS_META.maintenance.label}" heißt: der Homeserver wurde absichtlich stillgelegt, etwa für ein Update – das geht vorbei. „${NODE_STATUS_META.offline.label}" heißt: er meldet sich nicht, zum Beispiel wegen eines Strom- oder Internetausfalls zu Hause. In beiden Fällen sind Server so lange nicht spielbar.`,
  },
  {
    title: 'Was zeigen die Balken?',
    body: 'Sie zeigen, wie viel von der Ausstattung des Homeservers bereits für Gameserver reserviert ist – nicht, wie stark er in diesem Moment arbeitet. Reserviert bleibt reserviert, auch wenn ein Server gerade gestoppt ist: Der Platz steht für ihn bereit, sobald er wieder startet.',
  },
  {
    title: 'Warum ist der Platz manchmal alle?',
    body: 'Jeder Gameserver bekommt feste Obergrenzen für Arbeitsspeicher, Rechenleistung und Speicherplatz. Ist die Summe aller Obergrenzen erreicht, nimmt der Homeserver keinen weiteren Server mehr an – auch dann nicht, wenn dein eigenes Kontingent noch Luft hätte. Lösche dann einen Server, den du nicht mehr brauchst, oder wende dich an die Administration.',
  },
  {
    title: 'Kann ich hier etwas kaputt machen?',
    body: 'Nein. Diese Ansicht zeigt nur an. Homeserver einrichten, pausieren oder entfernen kann ausschließlich die Administration.',
  },
];
