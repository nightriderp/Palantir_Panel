import {
  type GameResourceEstimate,
  type GameTypeDto,
  type HostNodeDto,
  type HostNodeStatus,
} from '@palantir/contracts';
import {
  type Tone,
  formatCores,
  formatDateTime,
  formatMegabytes,
  formatNumber,
  formatPercent,
  percentOf,
} from '@/components/shared';

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
    description: 'Die Node ist verbunden und nimmt Serverstarts an.',
    tone: 'success',
    pulse: true,
    acceptsStarts: true,
  },
  offline: {
    label: 'Offline',
    description:
      'Die Node ist gerade nicht erreichbar. Bereits laufende Server sind währenddessen nicht spielbar, und neue Server lassen sich nicht starten.',
    tone: 'danger',
    pulse: false,
    acceptsStarts: false,
  },
  maintenance: {
    label: 'Wartung',
    description:
      'Die Node wurde bewusst stillgelegt, zum Beispiel für ein Update. Neue Server lassen sich so lange nicht starten.',
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

export type NodeMetricKey = 'ram' | 'disk';

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
  /**
   * Füllgrad 0–100; `null`, wenn die Node keine Ausstattung oder – beim RAM
   * und bei der Platte – keine Messung meldet.
   *
   * Die Zusätze „davon … laufend" (Fundpunkt 203) und „… überbucht"
   * (Fundpunkt 209) sind seit der weichen RAM-Zuweisung (2026-09-18) entfallen:
   * Beide verglichen Buchungen, und Buchungen sagen nicht mehr, wie voll die
   * Node ist.
   */
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

/**
 * Die drei Balken einer Node-Karte.
 *
 * Der Balken zeigt `allocated` – die Summe der Limits **aller** dort angelegten
 * Server. Das ist die Zahl, an der `available` hängt: Was die Node bereithalten
 * muss, wenn alles gleichzeitig läuft.
 *
 * Darunter steht seit dem Audit vom 2026-09-10 (Fundpunkt 203) die zweite
 * Zahl: `running`, gegen die Anlegen und Starten tatsächlich geprüft werden.
 * Vorher stand hier der Satz, `capacity` und `usage` enthielten „dieselbe
 * Zahl" – das stimmte nie, und genau diese Verwechslung führte dazu, dass die
 * Seite „2 GB frei" auswies, während `POST /api/servers` einen 6-GB-Server
 * annahm. Zwei Zahlen mit Namen sind besser als eine ohne.
 *
 * Die gemessene Auslastung (`usage`) bleibt hier bewusst aussen vor: Sie
 * wechselt nach fünf Minuten ohne Messwert selbst auf die Reservierungsrechnung
 * (Fundpunkt 204) und gehört erst dann in die Karte, wenn sie ihre Herkunft
 * mitnennt.
 */
/**
 * Die CPU-Zeile der Node-Karte.
 *
 * Bis zum Wegfall der CPU-Zuweisung stand hier „Kerne gebucht · 3 / 8" – die
 * Summe der zugewiesenen Anteile gegen die Kerne der Maschine. Zugewiesen wird
 * nichts mehr, die Summe wäre dauerhaft null.
 *
 * Was bleibt, ist die **echte** Auslastung: Die Node meldet ihre Systemlast
 * (`cpuLoad1m`), das Backend rechnet sie auf die Kerne um und liefert sie als
 * `usage.cpuPercent`. Fehlt die Messung – Node offline, Agent gerade neu
 * gestartet –, steht nur noch die Ausstattung da. Eine erfundene Null wäre die
 * schlechtere Antwort: Sie sähe aus wie eine ruhige Node statt wie eine, über
 * die man nichts weiß.
 */
export function nodeCpuLabel(node: HostNodeDto): string {
  const kerne = formatCores(node.capacity.total.cpuCores);
  const last = node.usage?.cpuPercent;

  return last == null ? kerne : `${kerne} · ${formatPercent(last)} Last`;
}

// ---------------------------------------------------------------------------
// Agent-Version
// ---------------------------------------------------------------------------

export interface NodeAgentHint {
  /** Kurzform für die Unterzeile, z. B. „Agent 1.4.2". */
  label: string;
  /** Warnung im Klartext, wenn der Agent nicht zu dieser Version des Panels passt; sonst `null`. */
  warning: string | null;
}

/**
 * Was die Übersicht über den Agent der Node sagt (Review 2026-09-16, Befund
 * 11.3).
 *
 * Ein Agent mit falscher Protokollversion wird vom Backend abgewiesen und
 * versucht es endlos erneut; die Node stand dabei schlicht „offline". Hier
 * bekommt der Betreiber den Grund und den Handgriff – ohne ins Backend-Log
 * schauen zu müssen. `null`, solange sich nie ein Agent gemeldet hat.
 *
 * Bei einer Node, die gerade **nicht** online ist, trägt die Zeile zusätzlich
 * den Zeitpunkt der Meldung (Gefundener Punkt 321). Die Version stammt dann aus
 * der gespeicherten letzten Meldung, nicht aus einer offenen Verbindung – und
 * eine Version ohne Datum wäre in dem Fall irreführend: Sie sagt nicht, ob die
 * Node vor fünf Minuten oder vor zwei Wochen zuletzt etwas von sich hören ließ.
 * Genau daran hing der Vorfall vom 15.09.2026, bei dem der Homeserver zwei Tage
 * auf einer alten Version stand, ohne dass es jemandem auffiel.
 *
 * Bewusst der absolute Zeitpunkt und keine Angabe wie „vor zwei Tagen": Die
 * Zeile steht neben „zuletzt gesehen" im selben Format, und {@link
 * formatRelativeTime} hängt an der Uhr des Browsers.
 */
export function nodeAgentHint(node: HostNodeDto): NodeAgentHint | null {
  const agent = node.agent;

  if (agent === undefined || agent === null) {
    return null;
  }

  const label =
    node.status === 'online'
      ? `Agent ${agent.version}`
      : `Agent ${agent.version}, gemeldet ${formatDateTime(agent.reportedAt)}`;

  if (agent.compatible) {
    return { label, warning: null };
  }

  return {
    label,
    warning: `Der Agent ${agent.version} passt nicht zu dieser Version des Panels (Protokoll ${formatNumber(agent.protocolVersion)}, erwartet ${formatNumber(agent.expectedProtocolVersion)}). Bitte den Agent auf dem Homeserver aktualisieren – bis dahin bleibt die Node offline.`,
  };
}

export function nodeMetrics(node: HostNodeDto): NodeMetric[] {
  const { total } = node.capacity;

  /*
   * RAM aus der **Messung** (Betreiber-Entscheidung 2026-09-18): Die
   * Zuweisungen sind weiche Grenzen; „gebucht" sagte nichts mehr darueber, wie
   * voll die Maschine ist. Ohne Messung ein Gedankenstrich, keine Buchung.
   */
  const ramUsedMb = node.usage?.ramUsedMb ?? null;
  const ramPercent = ramUsedMb === null ? null : percentOf(ramUsedMb, total.ramMb);

  /*
   * Die Platte kommt aus der **Messung**, nicht aus Zuweisungen (siehe
   * `nodeDiskMetric`): Zugewiesen wird kein Speicherplatz mehr, und die alte
   * Summe hatte mit dem belegten Platz ohnehin nichts zu tun.
   */
  const diskUsedMb = node.usage?.diskUsedMb ?? null;
  const diskPercent = diskUsedMb === null ? null : percentOf(diskUsedMb, total.diskMb);

  return [
    {
      key: 'ram',
      label: 'RAM belegt',
      usedLabel: formatMegabytes(ramUsedMb),
      totalLabel: formatMegabytes(total.ramMb),
      freeLabel: formatMegabytes(ramUsedMb === null ? null : total.ramMb - ramUsedMb),
      percent: ramPercent,
      tone: toneForFill(ramPercent),
    },
    {
      key: 'disk',
      label: 'Platte belegt',
      usedLabel: formatMegabytes(diskUsedMb),
      totalLabel: formatMegabytes(total.diskMb),
      // `formatMegabytes(null)` ergibt „—": ohne Messung steht dort ein
      // Gedankenstrich statt einer erfundenen Zahl.
      freeLabel: formatMegabytes(diskUsedMb === null ? null : total.diskMb - diskUsedMb),
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
  /**
   * Farbe der Zahl. Die vier Kacheln zeigen vier verschiedene Größen, und ohne
   * Farbe liest sich die Zeile als ein Block weißer Zahlen. Die Zuordnung ist
   * dieselbe wie überall im Panel: erreichbar = grün, Belegung = Markenfarbe,
   * freier Platz = gelb.
   */
  tone: Tone;
}

/**
 * Kopfzeile der Übersicht (Mockup, Seite „Nodes").
 *
 * Zählt bewusst nur über die Nodes, die der Aufrufer sehen darf – eine
 * ausgeblendete Node darf sich nicht über eine Summe verraten.
 *
 * Beim RAM steht bewusst das **gebuchte** und beim Platz das **freie** – so wie
 * im Entwurf. Beides beantwortet eine andere Frage: „Wie viel ist schon
 * vergeben?" gegenüber „Wie viel passt noch drauf?". Die Beschriftung sagt
 * jeweils, welche der beiden gemeint ist.
 */
export function nodesSummary(nodes: HostNodeDto[]): NodesSummaryEntry[] {
  const online = nodes.filter((node) => node.status === 'online').length;
  const servers = nodes.reduce((sum, node) => sum + node.serverCount, 0);
  // Gemessen belegt ueber die Nodes mit Messwerten (weiche Zuweisung, 2026-09-18).
  const usedRamMb = nodes.reduce((sum, node) => sum + (node.usage?.ramUsedMb ?? 0), 0);
  /*
   * Freier Platz nur aus den Nodes, die gerade messen. Eine Node ohne Messung
   * geht mit 0 in die Summe – sie hat nicht null frei, sie sagt es nur nicht.
   * Das untertreibt eher, und das ist bei „wie viel ist noch frei" die
   * richtige Richtung.
   */
  const freeDiskMb = nodes.reduce(
    (sum, node) =>
      node.usage?.diskUsedMb == null
        ? sum
        : sum + Math.max(0, node.capacity.total.diskMb - node.usage.diskUsedMb),
    0,
  );

  return [
    {
      key: 'online',
      label: 'Nodes online',
      value: `${formatNumber(online)}/${formatNumber(nodes.length)}`,
      note: 'Erreichbare Nodes gegenüber allen eingerichteten.',
      tone: online === nodes.length ? 'success' : online === 0 ? 'danger' : 'warning',
    },
    {
      key: 'servers',
      label: 'Server verteilt',
      value: formatNumber(servers),
      note: 'Angelegte Gameserver auf allen Nodes zusammen.',
      tone: 'neutral',
    },
    {
      key: 'ram',
      label: 'RAM belegt',
      value: formatMegabytes(usedRamMb),
      note: 'Gemessen auf den Nodes – die Server nehmen sich, was frei ist.',
      tone: 'brand',
    },
    {
      key: 'disk',
      label: 'Platte frei',
      value: formatMegabytes(freeDiskMb),
      note: 'Platz für Weltdaten und Backups.',
      tone: 'warning',
    },
  ];
}

// ---------------------------------------------------------------------------
// Reicht es noch für einen neuen Server?
// ---------------------------------------------------------------------------

export interface SmallestGameType {
  name: string;
  /** RAM-Vorschlag und geschätzter Platzbedarf des Spiels. */
  bedarf: GameResourceEstimate;
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

  return { name: smallest.name, bedarf: smallest.resourceDefaults };
}

export interface StartCapacityHint {
  /** Kurzer Titel des Hinweisfelds. */
  title: string;
  /** Erklärung samt Handlungsempfehlung. */
  description: string;
}

/**
 * Passt der Bedarf auf diese Node?
 *
 * Der Arbeitsspeicher wird gegen die freie Zuweisung gehalten, die Platte gegen
 * die **Messung** – zugewiesen wird sie nicht mehr. Ohne Messung zählt die
 * Platte nicht mit: Fehlt die Auskunft, soll der Hinweis nicht behaupten, es
 * passe nichts mehr.
 */
export function nodeHasRoomFor(node: HostNodeDto, needed: GameResourceEstimate): boolean {
  if (node.capacity.available.ramMb < needed.ramMb) return false;

  const belegt = node.usage?.diskUsedMb;
  if (belegt == null) return true;

  return node.capacity.total.diskMb - belegt >= needed.diskMb;
}

/**
 * Hinweis, wenn ein Serverstart mangels Node-Kapazität nicht möglich wäre
 * (Arbeitspaket F7, zweite Prüfung aus Pflichtenheft §10).
 *
 * `null` heißt: es passt noch etwas – dann steht bewusst kein Kasten da. Der
 * Hinweis erscheint nur, wenn er etwas zu sagen hat.
 *
 * Das eigene Kontingent des Nutzers (Pflichtenheft §10, erste Prüfung) bleibt
 * hier außen vor: Diese Ansicht beschreibt die Nodes, nicht das Konto. Den
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
        ? 'Alle Nodes sind in Wartung. Sobald die Wartung beendet ist, funktionieren Starts wieder von allein – du musst nichts tun.'
        : 'Keine Node ist gerade erreichbar. Solange das so ist, nimmt Palantir keine Serverstarts an. Meist genügt es, später erneut nachzusehen.',
    };
  }

  const smallest = smallestGameType(gameTypes);
  if (smallest === null) return null;

  if (onlineNodes.some((node) => nodeHasRoomFor(node, smallest.bedarf))) return null;

  return {
    title: 'Der Platz reicht für keinen weiteren Server',
    description: `Selbst der sparsamste Spieltyp („${smallest.name}") braucht ${formatMegabytes(
      smallest.bedarf.ramMb,
    )} Arbeitsspeicher und rund ${formatMegabytes(
      smallest.bedarf.diskMb,
    )} Speicherplatz – so viel ist auf keiner verbundenen Node mehr frei. Ein nicht mehr genutzter Server, den du löschst, gibt seinen Platz sofort wieder frei.`,
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
 * derselben Version auf.
 *
 * Keiner dieser Texte nennt Interna – keine Tunnel-Adressen, keine Schlüssel,
 * keine Zugangs-Tokens. Wer eine Node einrichtet, tut das in der
 * Node-Verwaltung (F10) und nicht hier.
 */
export const NODE_EXPLAINERS: NodeExplainer[] = [
  {
    title: 'Was ist eine „Node"?',
    body: 'Eine Node ist ein Rechner, auf dem deine Gameserver tatsächlich laufen – im Regelfall der Homeserver bei dir zu Hause. Palantir selbst ist nur die Bedienoberfläche: Du drückst hier auf „Starten", die Arbeit macht die Node. Diese Seite zeigt dir, wie es ihr geht.',
  },
  {
    title: 'Was bedeutet der Zustand?',
    body: `„${NODE_STATUS_META.online.label}" heißt: alles läuft, Server lassen sich starten. „${NODE_STATUS_META.maintenance.label}" heißt: die Node wurde absichtlich stillgelegt, etwa für ein Update – das geht vorbei. „${NODE_STATUS_META.offline.label}" heißt: sie meldet sich nicht, zum Beispiel wegen eines Strom- oder Internetausfalls zu Hause. In beiden Fällen sind Server so lange nicht spielbar.`,
  },
  {
    title: 'Was zeigen die Balken?',
    body: 'Sie zeigen, wie viel von der Ausstattung der Node bereits für Gameserver reserviert ist – nicht, wie stark sie in diesem Moment arbeitet. Reserviert bleibt reserviert, auch wenn ein Server gerade gestoppt ist: Der Platz steht für ihn bereit, sobald er wieder startet.',
  },
  {
    title: 'Warum ist der Platz manchmal alle?',
    body: 'Jeder Gameserver bekommt feste Obergrenzen für Arbeitsspeicher, Rechenleistung und Speicherplatz. Ist die Summe aller Obergrenzen erreicht, nimmt die Node keinen weiteren Server mehr an – auch dann nicht, wenn dein eigenes Kontingent noch Luft hätte. Lösche dann einen Server, den du nicht mehr brauchst, oder wende dich an die Administration.',
  },
  {
    title: 'Kann ich hier etwas kaputt machen?',
    body: 'Nein. Diese Ansicht zeigt nur an. Nodes einrichten, pausieren oder entfernen kann ausschließlich die Administration.',
  },
];
