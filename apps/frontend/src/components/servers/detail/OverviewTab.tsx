'use client';

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { useMemo, useState, type ReactNode } from 'react';
import {
  MetricTile,
  Panel,
  SegmentedControl,
  formatCores,
  formatDateTime,
  formatDuration,
  formatMegabytes,
  formatNumber,
  formatPercent,
  formatPing,
  formatPlayers,
  formatServerAddress,
  formatTime,
  hasLiveStats,
  pingTon,
} from '@/components/shared';
import { fetchStatsHistory } from '@/lib/api/servers';
import { useApiResource } from '@/lib/api/useApiResource';
import { type ServerStatsHistoryDto } from '@palantir/contracts';
import { formatBytes } from '../formatDetail';
import { StatsHistoryChart } from './StatsHistoryChart';

/**
 * Reiter „Übersicht" der Detailansicht (Lastenheft §3.3).
 *
 * Live-Monitoring: CPU, RAM, Speicher, Netzwerk, Spieleranzahl – dazu die
 * Verlaufsdarstellung, die Live-Konsole und die Stammdaten des Servers. Die
 * laufenden Werte kommen über den Live-Kanal; nur der Rückblick wird einmal
 * nachgeladen.
 *
 * Konsole und Stammdaten stehen nebeneinander (Mockup: 1.6 zu 1), auf schmalen
 * Bildschirmen untereinander.
 */

/**
 * Wählbare Zeitfenster der Verlaufsdarstellung (Fundpunkt 222).
 *
 * Das Fenster stand fest auf 60 Minuten, obwohl das Backend die Stichproben
 * `STATS_HISTORY_RETENTION_HOURS` lang aufhebt – vorgegeben 48 Stunden. Wer
 * wissen wollte, ob ein Server über Nacht vollgelaufen ist, konnte es an dieser
 * Stelle nicht sehen, obwohl die Zahlen dalagen. Die Route nimmt jedes Fenster
 * entgegen und kappt selbst an der Aufbewahrungsfrist.
 */
const HISTORY_WINDOWS = [
  { minutes: 60, label: '1 Std.' },
  { minutes: 360, label: '6 Std.' },
  { minutes: 1440, label: '24 Std.' },
  { minutes: 2880, label: '48 Std.' },
] as const;

const HISTORY_WINDOW_DEFAULT = 60;

/**
 * Wie alt darf die letzte festgehaltene Messung sein, um noch in die Kacheln zu
 * dürfen? (Nachtrag zu Fundpunkt 206.)
 *
 * Die Kacheln zeigen den **jetzigen** Zustand. Eine drei Stunden alte Messung
 * dort hinzuschreiben wäre eine andere Aussage, auch mit Zeitstempel daneben.
 * Der Wert hängt bewusst nicht am gewählten Verlaufsfenster: Sonst änderte ein
 * Klick auf „48 Std." nebenbei, was die Kacheln behaupten.
 *
 * Eine Stunde ist grosszügig – der Agent meldet im Sekundentakt, sobald er
 * verbunden ist.
 */
const FALLBACK_MAX_AGE_MS = 60 * 60 * 1000;

export interface OverviewTabProps {
  server: GameServerDto;
  stats: ServerLiveStats | null;
  /**
   * Die Live-Konsole. Sie steht wie im Mockup hier und nicht als eigener
   * Reiter; `null`, wenn das Konto sie nicht benutzen darf – dann nehmen die
   * Server-Details die volle Breite ein.
   */
  console?: ReactNode;
}

/**
 * Was unter den Kacheln aufgeklappt ist – immer nur eines.
 *
 * Vorbild hafenmeister: Der Verlauf hängt an der Kachel, zu der er gehört. Bei
 * uns stand er als eigener Block darunter, gleichzeitig für alle Kennzahlen;
 * wer die CPU ansehen wollte, bekam drei Diagramme, von denen zwei ihn nicht
 * interessierten.
 */
type AufgeklappteKachel = 'cpu' | 'ram' | 'netz';

export function OverviewTab({ server, stats, console: consolePanel = null }: OverviewTabProps) {
  const [offeneKachel, setOffeneKachel] = useState<AufgeklappteKachel | null>(null);
  const [historyWindow, setHistoryWindow] = useState<number>(HISTORY_WINDOW_DEFAULT);

  const klappe = (kachel: AufgeklappteKachel): void => {
    setOffeneKachel((aktuell) => (aktuell === kachel ? null : kachel));
  };

  /*
   * Der Verlauf wird beim Öffnen der Ansicht geladen, nicht erst beim Aufklappen
   * (Fundpunkt 206). Er ist der einzige Weg an Messwerte, die schon in der
   * Datenbank liegen: Der Live-Kanal sendet nur, wenn der Agent etwas meldet –
   * und meldet er nichts, blieben die Kacheln leer, während das Diagramm
   * darunter für denselben Server eine Kurve zeichnete. Ein Aufruf mehr je
   * Detailansicht; wer den Verlauf aufklappt, spart ihn dafür.
   */
  const history = useApiResource<ServerStatsHistoryDto>(
    (signal) => fetchStatsHistory(server.id, historyWindow, signal),
    [server.id, historyWindow],
  );

  const live = hasLiveStats(server.status) ? stats : null;

  /**
   * Letzte festgehaltene Messung – Ersatz, solange über den Live-Kanal nichts
   * kommt. Nur bei einem Server, der überhaupt Messwerte hat: Bei einem
   * gestoppten stünde dort sonst der Zustand von vorhin, als liefe er noch.
   *
   * Und nur, solange sie frisch genug ist (siehe {@link FALLBACK_MAX_AGE_MS}).
   */
  const letzteMessung = useMemo(() => {
    if (live !== null || !hasLiveStats(server.status)) return null;

    const juengste = history.data?.samples.at(-1) ?? null;
    if (juengste === null) return null;

    const alter = Date.now() - new Date(juengste.updatedAt).getTime();
    return Number.isFinite(alter) && alter <= FALLBACK_MAX_AGE_MS ? juengste : null;
  }, [live, server.status, history.data]);

  /** Was die Kacheln zeigen: der Live-Wert, sonst die letzte Messung. */
  const anzeige = live ?? letzteMessung;
  const address = formatServerAddress(server.address);

  /*
   * Laufzeit seit dem letzten erfolgreichen Start (Mockup „Laufzeit").
   * Nur wenn der Server auch laeuft: bei einem gestoppten Server stuende dort
   * sonst die Zeit seit dem letzten Start von irgendwann, was wie eine laufende
   * Uhr aussaehe. Gerechnet wird beim Rendern - die Anzeige aktualisiert sich
   * mit dem naechsten Messwert, das genuegt fuer eine Angabe in Stunden.
   */
  const uptimeSeconds =
    server.status === 'running' && server.lastStartedAt !== null
      ? (Date.now() - new Date(server.lastStartedAt).getTime()) / 1000
      : null;

  /**
   * CPU als Anteil der Node-Kerne (hafenmeister-Stil).
   *
   * `cpuPercent` zählt in Prozent **eines** Kerns: 250 heißt 2,5 ausgelastete
   * Kerne. Mit den Kernen der Node wird daraus ein Anteil - „31 % von 8 Kernen"
   * beantwortet die Frage, die „2,5 Kerne" offen lässt. Kennt der Eintrag die
   * Kerne nicht (älteres Backend, Node nicht sichtbar), bleibt es bei der
   * Kernzahl: lieber eine unschärfere Auskunft als ein erfundener Nenner.
   */
  const cpuAnzeige = useMemo(() => {
    const prozentJeKern = anzeige?.cpuPercent ?? null;
    if (prozentJeKern === null) return { wert: '—', anteil: null };

    const kerne = server.hostCpuCores ?? null;
    if (kerne === null || kerne <= 0) {
      return { wert: formatCores(Math.round(prozentJeKern) / 100), anteil: null };
    }

    const anteil = Math.min(100, prozentJeKern / kerne);
    return {
      wert: `${formatPercent(anteil)} von ${formatNumber(kerne)} Kernen`,
      anteil,
    };
  }, [anzeige?.cpuPercent, server.hostCpuCores]);

  /** Anteil am gebuchten Arbeitsspeicher – Füllstand des Balkens. */
  const ramAnteil =
    anzeige?.ramUsedMb == null || server.resourceLimits.ramMb <= 0
      ? null
      : (anzeige.ramUsedMb / server.resourceLimits.ramMb) * 100;

  /**
   * Gibt es überhaupt einen Verlauf zum Aufklappen?
   *
   * Eine Kachel, die sich als Schaltfläche anbietet und dann ein leeres Feld
   * öffnet, ist schlimmer als eine stille Kachel.
   */
  const hatVerlauf = (history.data?.samples.length ?? 0) > 1;

  const detailRows: Array<{ label: string; value: string }> = [
    { label: 'Spiel', value: server.gameTypeName },
    { label: 'Node', value: server.hostName ?? 'nicht sichtbar' },
    { label: 'Subdomain', value: server.subdomain },
    {
      label: 'Adresse',
      value: server.permissions.canViewAddress ? (address ?? '—') : 'nicht freigegeben',
    },
    {
      label: 'Ports',
      value: server.assignedPorts.length > 0 ? server.assignedPorts.join(', ') : 'keine',
    },
    { label: 'Arbeitsspeicher', value: formatMegabytes(server.resourceLimits.ramMb) },
    { label: 'Besitzer', value: server.ownerDisplayName ?? 'nicht sichtbar' },
    { label: 'Mitverwalter', value: String(server.memberCount) },
    { label: 'Angelegt', value: formatDateTime(server.createdAt) },
    { label: 'Zuletzt gestartet', value: formatDateTime(server.lastStartedAt) },
    {
      label: 'Automatisch abschalten',
      value: server.autoShutdownEnabled
        ? server.autoShutdownTimeoutMinutes === null
          ? 'an (Standard-Timeout)'
          : `an (nach ${server.autoShutdownTimeoutMinutes} min)`
        : 'aus',
    },
  ];

  /**
   * Warum eine Kachel leer ist – als Zusatz unter dem Strich.
   *
   * Vorbild hafenmeister: Dort steht unter jedem fehlenden Wert der Grund
   * („noch keine Messwerte", „Node nicht verbunden"). Bei uns stand in dem Fall
   * nur ein Strich, und ein Strich beantwortet nicht, ob gerade nichts gemessen
   * wird, der Server steht oder die Node weg ist. Die Sätze darüber und der
   * Verlauf darunter erklären es, aber eben nicht in der Kachel selbst.
   *
   * Die Reihenfolge ist die der Ursachen: Steht der Server, ist die Node
   * nebensächlich; ist die Node weg, wartet man nicht auf Messwerte, sondern
   * sieht nach ihr.
   */
  const fehlgrund = !hasLiveStats(server.status)
    ? 'Server läuft nicht'
    : server.hostStatus === 'offline'
      ? 'Node nicht verbunden'
      : server.hostStatus === 'maintenance'
        ? 'Node in Wartung'
        : 'noch keine Messwerte';

  return (
    <div className="flex flex-col gap-4">
      {/* Rasterregel wie im Mockup: die Kacheln verteilen sich selbst, statt
          bei einer festen Spaltenzahl umzubrechen. */}
      <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(140px,1fr))]">
        {/*
          `cpuPercent` zählt in Prozent **eines** Kerns: 250 heißt 2,5
          ausgelastete Kerne. Bis zum Wegfall der CPU-Zuweisung stand hier der
          Anteil am eigenen Kontingent; ohne Zuweisung gibt es diese
          Bezugsgröße nicht mehr.

          Die Kachel zeigt deshalb die Kerne selbst – eine absolute Zahl ohne
          erfundenen Nenner. Ein Prozentwert gegen die Kerne der Node wäre
          möglich, aber der DTO trägt sie nicht; sie steht in der
          Node-Übersicht, wo sie hingehört.
        */}
        <MetricTile
          label="CPU-Last"
          value={cpuAnzeige.wert}
          note={anzeige?.cpuPercent == null ? fehlgrund : undefined}
          {...(cpuAnzeige.anteil === null ? {} : { percent: cpuAnzeige.anteil })}
          {...(hatVerlauf
            ? { onClick: () => klappe('cpu'), expanded: offeneKachel === 'cpu' }
            : {})}
        />
        <MetricTile
          label="Arbeitsspeicher"
          value={
            anzeige?.ramUsedMb == null
              ? '—'
              : `${formatMegabytes(anzeige.ramUsedMb)} von ${formatMegabytes(server.resourceLimits.ramMb)}`
          }
          // Der Arbeitsspeicher trägt überall die zweite Markenfarbe – auf der
          // Kachel der Übersicht wie hier.
          tone={anzeige?.ramUsedMb == null ? undefined : 'brand'}
          note={anzeige?.ramUsedMb == null ? fehlgrund : undefined}
          {...(ramAnteil === null ? {} : { percent: ramAnteil })}
          {...(hatVerlauf
            ? { onClick: () => klappe('ram'), expanded: offeneKachel === 'ram' }
            : {})}
        />
        {/*
          Der gemessene Platzbedarf des Datenordners. Ein Anteil stand hier bis
          zum Wegfall der Speicherplatz-Zuweisung – gegen das Kontingent des
          Servers. Das gibt es nicht mehr: Ein Server darf wachsen, so weit die
          Platte der Node reicht. Wie voll die ist, steht in der
          Node-Übersicht.
        */}
        {/*
          Die Ping-Kachel klappt die Netzwerkzahlen auf, nicht eine Ping-Kurve:
          Beides gehört zur Anbindung des Servers, und ein gespeicherter Ping
          existiert nicht - er ist eine Eigenschaft der Verbindung, kein
          Messwert am Server. Vorbild hafenmeister.

          ⚠️ Der Ping gilt dem NODE, nicht diesem Server: Alle Server darauf
          teilen sich den Wert. Der Hinweis steht deshalb an der Kachel, sonst
          hält es jemand für eine Eigenschaft des Servers.
        */}
        <MetricTile
          label="Ping"
          value={formatPing(anzeige?.pingMs)}
          tone={pingTon(anzeige?.pingMs)}
          note={anzeige?.pingMs == null ? fehlgrund : undefined}
          {...(anzeige?.pingMs == null
            ? {}
            : // 200 ms als volle Skala: Darüber ist die Strecke ohnehin zu lang.
              { percent: Math.min(100, (anzeige.pingMs / 200) * 100) })}
          onClick={() => klappe('netz')}
          expanded={offeneKachel === 'netz'}
          toggleTitle={
            offeneKachel === 'netz' ? 'Netzwerkzahlen schließen' : 'Netzwerkzahlen anzeigen'
          }
        />
        {/*
          Kein Aufklapper: Den Plattenplatz misst der Agent in eigenem,
          langsamerem Takt - ein Verlauf aus so wenigen Messungen ist keine
          Kurve. Ohne Obergrenze auch kein Balken; ein Server darf wachsen, so
          weit die Platte der Node reicht.
        */}
        <MetricTile
          label="Platte"
          value={formatMegabytes(stats?.diskUsedMb)}
          note={stats?.diskUsedMb == null ? 'noch nicht gemessen' : 'Datenordner, ohne Obergrenze'}
        />
        <MetricTile
          label="Laufzeit"
          value={formatDuration(uptimeSeconds)}
          note={uptimeSeconds === null ? 'Server läuft nicht' : 'seit dem letzten Start'}
        />
      </div>

      {/*
        Fundpunkt 206: Woher die Zahlen kommen, wenn sie nicht live sind – und
        wenn gar keine da sind, warum. Vorher standen dort wortlos Striche,
        während das Diagramm eine Zeile tiefer eine Kurve zeichnete.
      */}
      {letzteMessung !== null ? (
        <p className="text-xs text-ink-faint">
          Keine laufenden Messwerte – gezeigt wird die letzte festgehaltene Messung von{' '}
          {formatTime(letzteMessung.updatedAt)} Uhr.
        </p>
      ) : live === null && hasLiveStats(server.status) && !history.loading ? (
        <p className="text-xs text-ink-faint">
          In der letzten Stunde hat dieser Server keine Messwerte gemeldet. Meldet sich die Node
          wieder, füllen sich die Kacheln von selbst; ältere Zahlen stehen im Verlauf.
        </p>
      ) : null}

      {/*
        Der Verlauf haengt an der Kachel, die ihn oeffnet - immer nur einer.
        Vorbild hafenmeister: Bis hierher stand er als eigener Block unter den
        Kacheln, gleichzeitig fuer alle Kennzahlen; wer die CPU ansehen wollte,
        bekam drei Diagramme, von denen zwei ihn nicht interessierten.
      */}
      {offeneKachel === 'cpu' || offeneKachel === 'ram' ? (
        <Panel variant="plain" className="flex animate-fade-up flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink-muted">
              {history.data === null
                ? 'Zeitraum'
                : `${formatNumber(history.data.samples.length)} Messpunkte`}
            </span>
            {/*
              Der gewaehlte Zeitraum gilt fuer jede Kurve dieser Seite - wer den
              CPU-Verlauf auf 24 Stunden stellt, meint nicht nur die CPU.
            */}
            <SegmentedControl
              label="Zeitraum des Verlaufs"
              value={String(historyWindow)}
              onChange={(wert) => setHistoryWindow(Number(wert))}
              items={HISTORY_WINDOWS.map((fenster) => ({
                key: String(fenster.minutes),
                label: fenster.label,
              }))}
            />
          </div>

          {history.loading ? (
            <p className="text-base text-ink-muted">Verlauf wird geladen …</p>
          ) : null}
          {history.error ? <p className="text-base text-danger">{history.error}</p> : null}

          {history.data === null ? null : offeneKachel === 'cpu' ? (
            <StatsHistoryChart
              samples={history.data.samples}
              metric="cpuPercent"
              label="CPU-Auslastung"
              // Keine feste Achsenobergrenze: Sie war das Kontingent des
              // Servers, und das gibt es seit dem Wegfall der CPU-Zuweisung
              // nicht. Der Verlauf skaliert auf seinen eigenen Hoechstwert -
              // so bleibt er lesbar, statt an einer geratenen Grenze zu kleben.
              max={null}
              formatValue={(wert) => formatCores(wert / 100)}
            />
          ) : (
            <StatsHistoryChart
              samples={history.data.samples}
              metric="ramUsedMb"
              label="Arbeitsspeicher"
              max={server.resourceLimits.ramMb}
              formatValue={formatMegabytes}
            />
          )}
        </Panel>
      ) : null}

      {/*
        Die Netzwerkzahlen haengen an der Ping-Kachel: Beides gehoert zur
        Anbindung des Servers. Vorher stand die Karte dauerhaft weiter unten,
        auch bei einem Server, der nie Verkehr hatte.
      */}
      {offeneKachel === 'netz' ? (
        <Panel variant="plain" className="flex animate-fade-up flex-col gap-2">
          <h3 className="text-base font-semibold">Netzwerkaktivität</h3>
          {anzeige === null ? (
            /*
             * Fundpunkt 207: Hier stand „Der Server läuft nicht." auch dann,
             * wenn er lief - die Bedingung fragte nach dem Messwert,
             * geantwortet hat sie über den Zustand. Das sind zwei Dinge.
             */
            <p className="text-sm text-ink-faint">
              {hasLiveStats(server.status)
                ? 'Noch keine Messwerte für diesen Server.'
                : 'Der Server läuft nicht.'}
            </p>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <MetricTile label="Eingehend" value={formatBytes(anzeige.networkRxBytes)} />
                <MetricTile label="Ausgehend" value={formatBytes(anzeige.networkTxBytes)} />
                {/*
                 * Paket-Zaehler wie im Entwurf (Abgleich 4.8). Sie stehen nur
                 * da, wenn die Runtime sie meldet - ein aelterer Agent laesst
                 * die Felder weg, und zwei Kacheln mit "—" waeren Fuellsel.
                 */}
                {anzeige.networkRxPackets === undefined ||
                anzeige.networkRxPackets === null ? null : (
                  <MetricTile
                    label="Pakete eingehend"
                    value={formatNumber(anzeige.networkRxPackets)}
                  />
                )}
                {anzeige.networkTxPackets === undefined ||
                anzeige.networkTxPackets === null ? null : (
                  <MetricTile
                    label="Pakete ausgehend"
                    value={formatNumber(anzeige.networkTxPackets)}
                  />
                )}
              </div>
              <p className="text-xs text-ink-faint">
                Die Summen zählen ab dem letzten Start des Servers. Weil aller Spiel-Verkehr über
                das Relay läuft, ist das zugleich der Verkehr durch die Panel-VPS.
              </p>
            </>
          )}
        </Panel>
      ) : null}

      {/*
        Spieler in einer eigenen Karte statt als sechste Kachel - wie bei
        hafenmeister. Die Zahl steht oben, die Namen darunter, soweit die
        Abfrage sie hergibt: Der generische Port-Connect-Test kennt keine, und
        manche Server geben nur einen Auszug heraus (Gefundener Punkt 51). Eine
        leere Liste hiesse „keine Angabe" - sie als „niemand da" darzustellen
        waere gelogen, deshalb traegt die Zahl die Karte.
      */}
      <Panel variant="plain" className="flex flex-col gap-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">Spieler online</h3>
          <span className="font-mono text-2xl font-semibold text-brand">
            {formatPlayers(anzeige?.playersOnline, anzeige?.playersMax)}
          </span>
        </div>

        {anzeige?.playersOnline == null ? (
          <p className="text-xs text-ink-faint">{fehlgrund}</p>
        ) : null}

        {live?.players && live.players.length > 0 ? (
          <>
            <ul className="flex flex-wrap gap-2">
              {live.players.map((spieler) => (
                <li
                  key={spieler.name}
                  className="rounded-md border border-line bg-surface-deep px-2.5 py-1 font-mono text-sm text-ink-muted"
                >
                  {spieler.name}
                </li>
              ))}
            </ul>
            {live.playersOnline !== null && live.playersOnline > live.players.length ? (
              <p className="text-xs text-ink-faint">
                {`${formatNumber(live.players.length)} von ${formatNumber(live.playersOnline)} Namen genannt - mehr gibt die Abfrage dieses Spiels nicht heraus.`}
              </p>
            ) : null}
          </>
        ) : null}
      </Panel>

      <div
        className={
          consolePanel === null
            ? 'grid grid-cols-1 gap-4'
            : 'grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]'
        }
      >
        {consolePanel === null ? null : <Panel variant="plain">{consolePanel}</Panel>}

        <Panel variant="plain">
          <h3 className="mb-2 text-base font-semibold">Server-Details</h3>
          <dl className="divide-y divide-line">
            {detailRows.map((row) => (
              <div key={row.label} className="flex justify-between gap-4 py-2">
                <dt className="text-sm text-ink-soft">{row.label}</dt>
                <dd className="text-right font-mono text-sm text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      </div>
    </div>
  );
}
