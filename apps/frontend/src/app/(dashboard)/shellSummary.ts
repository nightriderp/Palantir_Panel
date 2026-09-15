import {
  type GameServerDto,
  type HostNodeDto,
  type HostNodeUsageSource,
  type ServerLiveStats,
  isFaultedServerStatus,
  isTransitionalServerStatus,
} from '@palantir/contracts';
import {
  formatMegabytes,
  formatNumber,
  formatPercent,
  serverInitials,
} from '@/components/shared/utils/format';

/**
 * Rechnungen für den Rahmen des eingeloggten Bereichs: die Kennzahlen der
 * Gesamtstatus-Leiste (Mockup „Gesamtstatus"), die Serverliste der Seitenleiste
 * und die Auswahl des aktiven Navigationseintrags.
 *
 * Reine Funktionen ohne React, damit sie geprüft werden können – die Ansichten
 * (`GlobalStatus.tsx`, `DashboardNav.tsx`) rufen sie nur auf. Beschriftungen
 * sind Deutsch (Lastenheft §4), Zahlen laufen über die Formatierer des
 * Design-Systems.
 *
 * **Kein neuer Endpunkt:** Alle Werte entstehen aus Daten, die es schon gibt –
 * der Serverliste (`GET /servers`), der Node-Liste (`GET /admin/nodes`) und den
 * Live-Messwerten aus dem WebSocket-Kanal. Eine eigene Übersichts-Route hätte
 * eine Contracts-Änderung gebraucht (CLAUDE.md §3); die wäre für eine reine
 * Zusammenfassung bereits vorhandener Zahlen nicht zu rechtfertigen.
 */

/**
 * Farbe einer Kennzahl.
 *
 * Bewusst **nicht** der `Tone` aus `primitives/Badge`: das Mockup färbt RAM und
 * Nodes mit der zweiten Markenfarbe (`accent`), für die es keine Pille und
 * keinen `Tone`-Wert gibt. `tailwind.config.ts` nennt genau diesen Zweck
 * („nur im Verlauf und für RAM-Kennzahlen").
 */
export type StatusMetricTone = 'success' | 'brand' | 'warning' | 'accent' | 'danger';

export interface StatusMetric {
  key: string;
  /** Beschriftung rechts neben der Zahl, z. B. „Server online". */
  label: string;
  /** Fertig formatierter Wert, z. B. `4/7` oder `18,5 GB/32 GB`. */
  value: string;
  tone: StatusMetricTone;
  /**
   * Erklärt, worüber die Zahl gebildet wird – erscheint als Tooltip.
   *
   * Hier steht seit der Angleichung an hafenmeister auch die **Herkunft**
   * („gemessen", „gebucht", „teils gemessen", Fundpunkt 204). Sie stand bis
   * dahin als eigenes Wort in der Zeile; die Zeile zeigt jetzt Prozentwerte wie
   * das Schwesterprojekt, und ein viertes Wort je Kennzahl sprengte sie. Die
   * Auskunft bleibt: Wer wissen will, ob eine Zahl gemessen oder gebucht ist,
   * fährt darüber.
   */
  note: string;
  /**
   * Der Zahlenwert hinter der Anzeige – Grundlage der Kurve beim Überfahren.
   *
   * `null` heisst „gerade unbekannt" und wird **nicht** aufgezeichnet. Eine 0
   * einzutragen wäre dieselbe Unwahrheit wie ein „0 %" in der Kachel: Ein Node,
   * der nichts meldet, ist nicht ein Node bei null. Fehlt das Feld ganz, gibt
   * es für diese Kennzahl keine Kurve (etwa „mit Update": Die Zahl ändert sich
   * beim Ausrollen, nicht im Messtakt).
   */
  numeric?: number | null;
  /** Wie der Wert in der Kurve beschriftet wird. */
  format?: (value: number) => string;
}

export interface StatusSummaryInput {
  servers: readonly GameServerDto[];
  /**
   * Nodes des Kontos. `null`, wenn das Konto sie nicht sehen darf
   * (`permissions.canViewNodes`) – dann entfallen CPU, RAM, Platte und die
   * Node-Zahl, statt sie mit falschen Werten zu füllen.
   */
  nodes: readonly HostNodeDto[] | null;
  /** Live-Messwerte je Server-Id; leer, solange über den Kanal nichts kam. */
  statsById: Readonly<Record<string, ServerLiveStats>>;
}

/** Wie eine Prozentzahl in der Kurve beschriftet wird. */
const prozentFormat = (wert: number): string => `${String(Math.round(wert))} %`;

/** Wie eine Stückzahl in der Kurve beschriftet wird. */
const zahlFormat = (wert: number): string => formatNumber(Math.round(wert));

/**
 * Anteil in Prozent, `null` ohne brauchbaren Nenner.
 *
 * Die Kopfzeile zeigt seit der Angleichung an hafenmeister Prozentwerte statt
 * absoluter Zahlen: „18,5 GB/32 GB" beantwortet „wie voll" erst nach einer
 * Kopfrechnung, „58 %" sofort. Die absoluten Zahlen stehen weiterhin in der
 * Node-Übersicht, wo der Platz dafür da ist.
 */
function anteil(belegt: number | null, gesamt: number): number | null {
  if (belegt === null || gesamt <= 0) return null;
  return (belegt / gesamt) * 100;
}

/** Summe einer Zahl über alle Einträge, `null`-Werte übersprungen. */
function sumDefined(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}

/**
 * Herkunft der Zahlen einer Kennzahl (Fundpunkt 204).
 *
 * Die Auslastung einer Node ist entweder gemessen oder aus den Kontingenten der
 * angelegten Server gerechnet. Welcher Fall gilt, entscheidet das Backend je
 * Node und bei **jedem** Abruf neu: Ist die letzte Messung älter als fünf
 * Minuten (`MEASUREMENT_MAX_AGE_MS`), fällt es stillschweigend auf die
 * Buchungen zurück. In der Prüfung sprang dieselbe Kachel dadurch von 1,26 TB
 * auf 216 GB, ohne dass sich an der Anzeige irgendetwas änderte – wer das
 * sieht, sucht den Fehler bei sich statt bei der Node.
 *
 * Deshalb steht die Herkunft jetzt am Tooltip der Kennzahl. Fehlt `source` –
 * der Vertrag führt es als optional –, bleibt sie ungenannt statt geraten.
 *
 * Bis zur Angleichung an hafenmeister stand zusätzlich ein Kurzwort
 * („gemessen", „gebucht") in der Zeile selbst. Die Zeile zeigt jetzt
 * Prozentwerte wie das Schwesterprojekt, und ein viertes Wort je Kennzahl
 * sprengte sie; der Satz hier trägt dieselbe Auskunft.
 */
function herkunftssatz(quellen: readonly (HostNodeUsageSource | undefined)[]): string {
  if (quellen.length === 0 || quellen.some((quelle) => quelle === undefined)) {
    return '';
  }

  const gemessen = quellen.filter((quelle) => quelle === 'measured').length;

  if (gemessen === quellen.length) {
    return ' Vom Agent auf der Node gemessen.';
  }

  if (gemessen === 0) {
    return ' Keine frische Messung – gerechnet aus den Kontingenten der angelegten Server.';
  }

  return ` Gemessen auf ${String(gemessen)} von ${String(quellen.length)} Nodes; die übrigen zählen ihre Kontingente.`;
}

/**
 * Kennzahlen in der Reihenfolge des Mockups.
 *
 * Die letzten drei („in Bewegung", „mit Fehler", „mit Update") erscheinen nur,
 * wenn sie größer als null sind – eine Leiste voller Nullen sagt nichts aus.
 */
export function buildStatusMetrics({
  servers,
  nodes,
  statsById,
}: StatusSummaryInput): StatusMetric[] {
  const metrics: StatusMetric[] = [];

  const running = servers.filter((server) => server.status === 'running');

  metrics.push({
    key: 'servers',
    label: 'Server online',
    value: `${String(running.length)}/${String(servers.length)}`,
    tone: 'success',
    note: 'Anteil laufender Server insgesamt.',
    numeric: running.length,
    format: zahlFormat,
  });

  // Spielerzahlen kommen ausschließlich über den Live-Kanal und fehlen, solange
  // kein Server läuft oder das Spiel sie nicht meldet.
  const players = sumDefined(running.map((server) => statsById[server.id]?.playersOnline));
  metrics.push({
    key: 'players',
    label: 'Spieler',
    value: players === null ? '—' : formatNumber(players),
    tone: 'brand',
    note: 'Summe über alle laufenden Server, die Zahlen melden.',
    numeric: players,
    format: zahlFormat,
  });

  if (nodes !== null) {
    const online = nodes.filter((node) => node.status === 'online');

    /*
     * Gemessene Kennzahlen zählen nur Nodes, für die auch eine Messung vorliegt
     * (Fundpunkt frontend-app-05). `HostNodeDto.usage` ist `null`, solange der
     * Agent nichts gemeldet hat; einzelne Felder darin können ebenfalls fehlen.
     * Zähler und Nenner müssen deshalb aus **derselben** Menge stammen – sonst
     * misst der Bruch zwei verschiedene Grundgesamtheiten gegeneinander.
     */
    const cpuNodes = online.filter((node) => node.usage?.cpuPercent != null);
    const cpuSum = sumDefined(cpuNodes.map((node) => node.usage?.cpuPercent));
    const cpuHerkunft = herkunftssatz(cpuNodes.map((node) => node.usage?.source));
    metrics.push({
      key: 'cpu',
      label: 'CPU',
      value: cpuSum === null ? '—' : formatPercent(cpuSum / cpuNodes.length),
      tone: 'warning',
      note: `Durchschnitt über die Maschinen der verbundenen Nodes, die Messwerte melden – nicht über einzelne Container.${cpuHerkunft}`,
      numeric: cpuSum === null ? null : cpuSum / cpuNodes.length,
      format: prozentFormat,
    });

    // RAM ist der **gebuchte** Anteil (Summe der Server-Limits), nicht der
    // gemessene: er sagt, wie viel Platz für weitere Server bleibt. Buchungen
    // kennt jede Node, auch eine offline stehende – deshalb geht diese Zahl
    // bewusst über alle Nodes, anders als CPU und Platte darüber.
    const ramUsed = nodes.reduce((total, node) => total + node.capacity.allocated.ramMb, 0);
    const ramTotal = nodes.reduce((total, node) => total + node.capacity.total.ramMb, 0);
    const ramAnteil = anteil(ramUsed, ramTotal);
    metrics.push({
      key: 'ram',
      label: 'RAM',
      value: ramAnteil === null ? '—' : formatPercent(ramAnteil),
      tone: 'accent',
      /*
        Die Herkunft steht hier fest, nicht aus `usage.source`: Diese Kennzahl
        liest `capacity.allocated` und wechselt nie die Bedeutung. Seit die
        Zeile Prozente zeigt, nennt der Tooltip auch die absoluten Zahlen -
        sonst wäre mit dem Nenner die Grösse der Instanz verschwunden.
      */
      note: `Summe des gebuchten Arbeitsspeichers über alle Nodes – gebucht, nicht gemessen. ${formatMegabytes(ramUsed)} von ${formatMegabytes(ramTotal)}.`,
      numeric: ramAnteil,
      format: prozentFormat,
    });

    /*
     * Platte dagegen ist die **belegte**, nicht die gebuchte: Daten liegen auch
     * dann auf der Node, wenn der Server gestoppt ist. Der Nenner ist deshalb
     * nur der Platz der Nodes, die eine Belegung nennen. Zählte er alle mit,
     * zeigte eine Node ohne Zahl ihren gesamten Platz als „frei" – zwei Nodes à
     * 500 GB, eine ohne Zahl, ergäben „100 GB/1000 GB" statt „100 GB/500 GB".
     *
     * Der Filter wählt **nicht** die gemessenen Nodes aus (Fundpunkt 204): Das
     * Backend liefert für jede Node eine Zahl und schaltet nur intern von der
     * Messung auf die Kontingente um. Was hier steht, sagt `usage.source` –
     * und seit dem Audit auch die Kachel selbst.
     */
    const mitZahl = nodes.filter((node) => node.usage?.diskUsedMb != null);
    const diskUsed = sumDefined(mitZahl.map((node) => node.usage?.diskUsedMb));
    const diskTotal = mitZahl.reduce((total, node) => total + node.capacity.total.diskMb, 0);
    const diskHerkunft = herkunftssatz(mitZahl.map((node) => node.usage?.source));
    const diskAnteil = anteil(diskUsed, diskTotal);
    metrics.push({
      key: 'disk',
      label: 'Disk',
      value: diskAnteil === null ? '—' : formatPercent(diskAnteil),
      tone: 'warning',
      note: `Summe der Plattenbelegung über die Nodes, die eine Zahl nennen. ${
        diskUsed === null ? '' : `${formatMegabytes(diskUsed)} von ${formatMegabytes(diskTotal)}. `
      }${diskHerkunft.trim()}`,
      numeric: diskAnteil,
      format: prozentFormat,
    });

    metrics.push({
      key: 'nodes',
      label: 'Nodes',
      value: `${online.length}/${nodes.length}`,
      tone: online.length === nodes.length ? 'accent' : 'warning',
      note: 'Verbundene Nodes gegenüber allen registrierten.',
      numeric: online.length,
      format: zahlFormat,
    });
  }

  const inMotion = servers.filter((server) => isTransitionalServerStatus(server.status)).length;
  if (inMotion > 0) {
    metrics.push({
      key: 'motion',
      label: 'in Bewegung',
      value: formatNumber(inMotion),
      tone: 'warning',
      // Weiter gefasst als im Mockup, das nur Starten und Stoppen zählt: der
      // Lifecycle kennt mit `creating` einen dritten Übergang, und die Leiste
      // soll keinen davon verschweigen.
      note: 'Server, die gerade angelegt werden, starten oder stoppen.',
      numeric: inMotion,
      format: zahlFormat,
    });
  }

  const faulted = servers.filter((server) => isFaultedServerStatus(server.status)).length;
  if (faulted > 0) {
    metrics.push({
      key: 'faulted',
      label: 'mit Fehler',
      value: formatNumber(faulted),
      tone: 'danger',
      note: 'Server im Fehlerzustand oder abgestürzt.',
      numeric: faulted,
      format: zahlFormat,
    });
  }

  const withUpdate = servers.filter((server) => server.updateAvailable).length;
  if (withUpdate > 0) {
    metrics.push({
      key: 'update',
      label: 'mit Update',
      value: formatNumber(withUpdate),
      tone: 'warning',
      /*
        Bewusst OHNE `numeric`: Eine Kurve „wie viele Updates lagen in den
        letzten Minuten an" beantwortet keine Frage - die Zahl ändert sich beim
        Ausrollen einer neuen Image-Fassung, nicht im Messtakt.
      */
      note: 'Server mit verfügbarem Image-Update.',
    });
  }

  return metrics;
}

export interface SidebarServer {
  id: string;
  name: string;
  /** Kürzel für die Kachel vor dem Namen – dieselbe Bildung wie auf der Karte. */
  initials: string;
  status: GameServerDto['status'];
}

/**
 * Eigene Server für den Abschnitt „Deine Server" in der Seitenleiste.
 *
 * Nur die eigenen – im Mockup steht dort `mineServers`. Server, auf die man nur
 * Zugriff hat, erscheinen weiterhin allein auf der Übersicht, damit die
 * Seitenleiste nicht mit fremden Einträgen volläuft.
 */
export function ownServersForNav(
  servers: readonly GameServerDto[],
  currentUserId: string | null,
): SidebarServer[] {
  if (currentUserId === null) return [];

  return servers
    .filter((server) => server.ownerId === currentUserId)
    .map((server) => ({
      id: server.id,
      name: server.name,
      initials: serverInitials(server.name),
      status: server.status,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/**
 * Welcher Navigationseintrag gilt als aktiv?
 *
 * Es gewinnt der **längste** passende Pfad. Ohne diese Regel wäre auf
 * `/servers/neu` sowohl „Übersicht" (`/servers`) als auch „Server erstellen"
 * markiert, und ein geöffneter Server (`/servers/<id>`) würde die Übersicht
 * hervorheben statt seinen eigenen Eintrag in der Seitenleiste.
 */
export function activeNavHref(pathname: string, hrefs: readonly string[]): string | null {
  let best: string | null = null;

  for (const href of hrefs) {
    const matches = pathname === href || pathname.startsWith(`${href}/`);
    if (!matches) continue;
    if (best === null || href.length > best.length) best = href;
  }

  return best;
}
