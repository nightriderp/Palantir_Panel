import {
  type GameServerDto,
  type HostNodeDto,
  type ServerLiveStats,
  isFaultedServerStatus,
  isTransitionalServerStatus,
} from '@palantir/contracts';
import { formatMegabytes, formatNumber, serverInitials } from '@/components/shared/utils/format';

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
  /** Erklärt, worüber die Zahl gebildet wird – erscheint als Tooltip. */
  note: string;
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

/** Summe einer Zahl über alle Einträge, `null`-Werte übersprungen. */
function sumDefined(values: readonly (number | null | undefined)[]): number | null {
  const known = values.filter((value): value is number => value != null);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
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
    value: `${running.length}/${servers.length}`,
    tone: 'success',
    note: 'Anteil laufender Server insgesamt.',
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
  });

  if (nodes !== null) {
    const online = nodes.filter((node) => node.status === 'online');

    const cpuValues = online.map((node) => node.usage?.cpuPercent);
    const cpuSum = sumDefined(cpuValues);
    const cpuCount = cpuValues.filter((value) => value != null).length;
    metrics.push({
      key: 'cpu',
      label: 'CPU',
      value: cpuSum === null ? '—' : `${Math.round(cpuSum / cpuCount)}%`,
      tone: 'warning',
      note: 'Durchschnitt über die Maschinen aller verbundenen Nodes – nicht über einzelne Container.',
    });

    // RAM ist der **gebuchte** Anteil (Summe der Server-Limits), nicht der
    // gemessene: er sagt, wie viel Platz für weitere Server bleibt.
    const ramUsed = nodes.reduce((total, node) => total + node.capacity.allocated.ramMb, 0);
    const ramTotal = nodes.reduce((total, node) => total + node.capacity.total.ramMb, 0);
    metrics.push({
      key: 'ram',
      label: 'RAM',
      value: `${formatMegabytes(ramUsed)}/${formatMegabytes(ramTotal)}`,
      tone: 'accent',
      note: 'Summe des gebuchten Arbeitsspeichers über alle Nodes.',
    });

    // Platte dagegen ist die **gemessene** Belegung: Daten liegen auch dann auf
    // der Node, wenn der Server gestoppt ist.
    const diskUsed = sumDefined(nodes.map((node) => node.usage?.diskUsedMb));
    const diskTotal = nodes.reduce((total, node) => total + node.capacity.total.diskMb, 0);
    metrics.push({
      key: 'disk',
      label: 'Platte',
      value: diskUsed === null ? '—' : `${formatMegabytes(diskUsed)}/${formatMegabytes(diskTotal)}`,
      tone: 'warning',
      note: 'Summe der gemessenen Plattenbelegung über alle Nodes.',
    });

    metrics.push({
      key: 'nodes',
      label: 'Nodes',
      value: `${online.length}/${nodes.length}`,
      tone: online.length === nodes.length ? 'accent' : 'warning',
      note: 'Verbundene Nodes gegenüber allen registrierten.',
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
    });
  }

  const withUpdate = servers.filter((server) => server.updateAvailable).length;
  if (withUpdate > 0) {
    metrics.push({
      key: 'update',
      label: 'mit Update',
      value: formatNumber(withUpdate),
      tone: 'warning',
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
