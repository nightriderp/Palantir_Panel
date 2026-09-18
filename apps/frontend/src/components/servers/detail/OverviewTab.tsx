'use client';

import { type GameServerDto, type ServerLiveStats } from '@palantir/contracts';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  type ChartPoint,
  MetricChart,
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
  formatUptimeClock,
  formatTime,
  hasLiveStats,
  lastTon,
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
  // Die Viertelstunde ist der Blick auf „was passiert gerade" - bei einem
  // Messpunkt je Minute sind das fuenfzehn Punkte, genug fuer eine Linie.
  { minutes: 15, label: '15 Min.' },
  { minutes: 60, label: '1 Std.' },
  { minutes: 360, label: '6 Std.' },
  { minutes: 1440, label: '24 Std.' },
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
 * Kennzahlen, unter denen sich ein Verlauf aufklappen laesst.
 *
 * Genau die vier, die der Messwert-Verlauf festhaelt
 * (`server_stats_samples`). Fuer alles andere gaebe es nichts zu zeichnen: Die
 * Platte misst der Agent in eigenem, langsamem Takt, und die Laufzeit ist eine
 * Uhr, keine Messreihe.
 */
const VERLAUFS_KACHELN = ['cpu', 'ram', 'ping', 'spieler'] as const;

type VerlaufsKachel = (typeof VERLAUFS_KACHELN)[number];

export function OverviewTab({ server, stats, console: consolePanel = null }: OverviewTabProps) {
  /**
   * Welcher Verlauf offen ist – immer genau einer.
   *
   * Ein Klick auf eine andere Kachel TAUSCHT: Der bisherige Verlauf schliesst
   * sich, der neue geht auf. Kurz standen mehrere zugleich offen; in der Praxis
   * sammelte sich damit untereinander, was man laengst angesehen hatte, und die
   * Seite wuchs mit jedem Klick (Wunsch des Betreibers, 15.09.2026).
   */
  const [offeneKachel, setOffeneKachel] = useState<VerlaufsKachel | null>(null);
  const [historyWindow, setHistoryWindow] = useState<number>(HISTORY_WINDOW_DEFAULT);

  const klappe = (kachel: VerlaufsKachel): void => {
    setOffeneKachel((aktuell) => (aktuell === kachel ? null : kachel));
  };

  const istOffen = (kachel: VerlaufsKachel): boolean => offeneKachel === kachel;

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

  /*
   * „Jetzt" als Zustand, nicht als `Date.now()` im Rendern: Das Rendern soll
   * rein bleiben (React-Compiler-Regel `purity`). Die Uhr darunter tickt den
   * Wert im Sekundentakt weiter; das Alter der letzten Messung rechnet mit
   * demselben Wert.
   */
  const [jetzt, setJetzt] = useState(() => Date.now());

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

    const alter = jetzt - new Date(juengste.updatedAt).getTime();
    return Number.isFinite(alter) && alter <= FALLBACK_MAX_AGE_MS ? juengste : null;
  }, [live, server.status, history.data, jetzt]);

  /** Was die Kacheln zeigen: der Live-Wert, sonst die letzte Messung. */
  const anzeige = live ?? letzteMessung;
  const address = formatServerAddress(server.address);

  /*
   * Laufzeit der laufenden Sitzung - als tickende Uhr.
   *
   * Nur wenn der Server auch laeuft: Bei einem gestoppten stuende dort sonst
   * die Zeit seit dem letzten Start von irgendwann, was wie eine laufende Uhr
   * aussaehe.
   *
   * Der Sekundenzeiger laeuft ueber einen eigenen Takt, nicht ueber die
   * Messwerte: Die kommen im Minutentakt, und eine Uhr, die minutenweise
   * springt, ist keine. Der Takt haengt am Zustand - ein gestoppter Server
   * laesst nichts ticken.
   */
  useEffect(() => {
    if (server.status !== 'running') return;

    const takt = window.setInterval(() => {
      setJetzt(Date.now());
    }, 1000);

    return () => {
      window.clearInterval(takt);
    };
  }, [server.status]);

  const uptimeSeconds =
    server.status === 'running' && server.lastStartedAt !== null
      ? (jetzt - new Date(server.lastStartedAt).getTime()) / 1000
      : null;

  /**
   * Gesamtlaufzeit: die gebuchten Laeufe plus die laufende Sitzung.
   *
   * Der Zaehler im Vertrag endet mit dem letzten abgeschlossenen Lauf - die
   * laufende Sitzung steht noch nicht darin, sonst muesste sie jede Sekunde in
   * die Datenbank. Addiert wird deshalb hier.
   */
  const gesamtLaufzeit =
    server.totalUptimeSeconds === undefined
      ? null
      : server.totalUptimeSeconds + (uptimeSeconds ?? 0);

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
    if (prozentJeKern === null) return { wert: '—', bezug: null, anteil: null };

    const kerne = server.hostCpuCores ?? null;
    if (kerne === null || kerne <= 0) {
      return { wert: formatCores(Math.round(prozentJeKern) / 100), bezug: null, anteil: null };
    }

    const anteil = Math.min(100, prozentJeKern / kerne);
    return {
      wert: formatPercent(anteil),
      // Der Bezug steht klein daneben, nicht in derselben Groesse: Die Zahl
      // traegt die Kachel, „von 8 Kernen" erklaert sie nur (Entwurf des
      // Betreibers).
      bezug: `von ${formatNumber(kerne)} Kernen`,
      anteil,
    };
  }, [anzeige?.cpuPercent, server.hostCpuCores]);

  /**
   * Zahl und Einheit trennen: „4,4" gross, „GB" klein daneben.
   *
   * `formatMegabytes` liefert beides in einer Zeichenkette; getrennt wird am
   * letzten Leerzeichen. Vorbild ist der Entwurf des Betreibers, in dem die
   * Zahl die Kachel traegt und die Einheit nur danebensteht.
   */
  const zahlUndEinheit = (formatiert: string): { zahl: string; einheit: string | null } => {
    const schnitt = formatiert.lastIndexOf(' ');
    return schnitt < 0
      ? { zahl: formatiert, einheit: null }
      : { zahl: formatiert.slice(0, schnitt), einheit: formatiert.slice(schnitt + 1) };
  };

  /** Wert gross, Bezug klein daneben - das Muster aller Kacheln mit Nenner. */
  const mitBezug = (wert: string, bezug: string | null): ReactNode =>
    bezug === null ? (
      wert
    ) : (
      <>
        {wert} <span className="text-base font-normal text-ink-soft">{bezug}</span>
      </>
    );

  /** Anteil am gebuchten Arbeitsspeicher – Füllstand des Balkens. */
  const ramAnteil =
    anzeige?.ramUsedMb == null || server.resourceLimits.ramMb <= 0
      ? null
      : (anzeige.ramUsedMb / server.resourceLimits.ramMb) * 100;

  /**
   * Die vier Netzwerk-Kurven: Rate statt Summe.
   *
   * Der Agent meldet **Zaehler** - Bytes und Pakete seit dem Start des
   * Containers. Eine Kurve daraus stiege nur monoton an und saehe fuer jeden
   * Server gleich aus; interessant ist, wie viel je Zeiteinheit dazukommt.
   * Gerechnet wird deshalb die Steigung zwischen zwei Messpunkten.
   *
   * Ein Neustart setzt die Zaehler zurueck. Ein negativer Sprung ist also kein
   * negativer Verkehr, sondern der Schnitt zwischen zwei Laeufen - solche
   * Paare fallen heraus, statt einen Ausschlag nach unten zu zeichnen.
   */
  const netzKurven = useMemo(() => {
    const samples = history.data?.samples ?? [];

    const reihe = (lies: (sample: ServerLiveStats) => number | null | undefined): ChartPoint[] => {
      const punkte: ChartPoint[] = [];

      for (let i = 1; i < samples.length; i += 1) {
        const vorher = samples[i - 1];
        const jetzt = samples[i];
        if (vorher === undefined || jetzt === undefined) continue;

        const a = lies(vorher);
        const b = lies(jetzt);
        if (a == null || b == null || b < a) continue;

        const sekunden = (Date.parse(jetzt.updatedAt) - Date.parse(vorher.updatedAt)) / 1000;
        if (!Number.isFinite(sekunden) || sekunden <= 0) continue;

        punkte.push({ ts: Date.parse(jetzt.updatedAt), value: (b - a) / sekunden });
      }

      return punkte;
    };

    const proSekunde = (formatiere: (wert: number) => string) => (wert: number) =>
      `${formatiere(wert)}/s`;

    /** Die Summe seit dem letzten Start - der letzte Zaehlerstand. */
    const summe = (
      lies: (sample: ServerLiveStats) => number | null | undefined,
      formatiere: (wert: number) => string,
    ): string => {
      const letzter = samples.at(-1);
      const wert = letzter === undefined ? null : lies(letzter);
      return wert == null ? '—' : formatiere(wert);
    };

    const zahl = (wert: number): string => formatNumber(Math.round(wert));

    return [
      {
        label: 'Eingehend',
        punkte: reihe((sample) => sample.networkRxBytes),
        summe: summe((sample) => sample.networkRxBytes, formatBytes),
        formatiere: proSekunde(formatBytes),
        leerHinweis: 'Noch kein Verkehr gemessen.',
      },
      {
        label: 'Ausgehend',
        punkte: reihe((sample) => sample.networkTxBytes),
        summe: summe((sample) => sample.networkTxBytes, formatBytes),
        formatiere: proSekunde(formatBytes),
        leerHinweis: 'Noch kein Verkehr gemessen.',
      },
      {
        label: 'Pakete eingehend',
        punkte: reihe((sample) => sample.networkRxPackets),
        summe: summe((sample) => sample.networkRxPackets, zahl),
        formatiere: proSekunde(zahl),
        leerHinweis: 'Dieser Agent meldet keine Paketzahlen.',
      },
      {
        label: 'Pakete ausgehend',
        punkte: reihe((sample) => sample.networkTxPackets),
        summe: summe((sample) => sample.networkTxPackets, zahl),
        formatiere: proSekunde(zahl),
        leerHinweis: 'Dieser Agent meldet keine Paketzahlen.',
      },
    ];
  }, [history.data]);

  /** Ueberschrift des aufgeklappten Verlaufs - Kennzahl und Einheit. */
  const verlaufsTitel = useMemo(() => {
    switch (offeneKachel) {
      case 'cpu':
        return {
          titel: 'CPU-Verlauf',
          einheit:
            server.hostCpuCores == null || server.hostCpuCores <= 0
              ? 'in Kernen'
              : `in Prozent von ${formatNumber(server.hostCpuCores)} Kernen`,
        };
      case 'ram':
        return { titel: 'Arbeitsspeicher-Verlauf', einheit: 'belegt' };
      case 'spieler':
        return { titel: 'Spieler-Verlauf', einheit: 'verbundene Spieler' };
      case 'ping':
        return { titel: 'Netzwerk-Verlauf', einheit: 'Rate je Sekunde' };
      default:
        return { titel: 'Verlauf', einheit: '' };
    }
  }, [offeneKachel, server.hostCpuCores]);

  /**
   * Wie viele Messpunkte der gewaehlte Zeitraum hergibt.
   *
   * ⚠️ Das entscheidet **nicht** mehr, ob sich eine Kachel aufklappen laesst.
   * Genau das tat es bis hierher - und machte die Funktion unsichtbar, sobald
   * das Fenster leer war: Ein Server, der eine Stunde stand und seit zwanzig
   * Sekunden laeuft, hat in der letzten Stunde genau einen Messpunkt, in
   * vierundzwanzig Stunden aber hundertelf. Die Kacheln boten dann gar keinen
   * Aufklapper an, und der Nutzer sah eine Seite ohne die Funktion, die es
   * geben sollte (gemeldet vom Betreiber, 15.09.2026).
   *
   * Jetzt klappt jede der vier Kacheln immer auf; der Bereich darunter sagt,
   * wenn fuer diesen Zeitraum nichts vorliegt - und die Zeitraum-Wahl steht
   * genau dort, wo man sie dann braucht.
   */
  const messpunkte = history.data?.samples.length ?? 0;

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
          value={mitBezug(cpuAnzeige.wert, cpuAnzeige.bezug)}
          /*
            Ampel wie im Entwurf: gruen heisst „alles im gruenen Bereich", gelb
            „wird langsam knapp", rot „wird knapp". Die Schwellen stehen an
            einer Stelle fuer das ganze Panel (`lastTon`: ab 55 % gelb, ab 82 %
            rot) - derselbe Messwert soll auf der Kachel der Uebersicht nicht
            anders heissen als hier.
          */
          tone={lastTon(cpuAnzeige.anteil)}
          note={anzeige?.cpuPercent == null ? fehlgrund : undefined}
          {...(cpuAnzeige.anteil === null ? {} : { percent: cpuAnzeige.anteil })}
          onClick={() => klappe('cpu')}
          expanded={istOffen('cpu')}
        />
        <MetricTile
          label="Arbeitsspeicher"
          value={
            anzeige?.ramUsedMb == null
              ? '—'
              : mitBezug(
                  zahlUndEinheit(formatMegabytes(anzeige.ramUsedMb)).zahl,
                  zahlUndEinheit(formatMegabytes(anzeige.ramUsedMb)).einheit,
                )
          }
          /*
            Der gebuchte Wert steht nicht mehr als „von 4 GB" daneben - das
            sagt schon der Balken darunter, und die Kachel liest sich als Zahl
            statt als Satz (Entwurf des Betreibers). Die genaue Buchung steht
            in den Server-Details.
          */
          /*
            Auch der Arbeitsspeicher traegt jetzt die Ampel statt der festen
            Markenfarbe: Er ist ein Fuellstand gegen das gebuchte Kontingent,
            und genau dort ist „wird knapp" die Auskunft, auf die es ankommt.
          */
          tone={lastTon(ramAnteil)}
          note={anzeige?.ramUsedMb == null ? fehlgrund : undefined}
          {...(ramAnteil === null ? {} : { percent: ramAnteil })}
          onClick={() => klappe('ram')}
          expanded={istOffen('ram')}
        />
        {/*
          Der gemessene Platzbedarf des Datenordners. Ein Anteil stand hier bis
          zum Wegfall der Speicherplatz-Zuweisung – gegen das Kontingent des
          Servers. Das gibt es nicht mehr: Ein Server darf wachsen, so weit die
          Platte der Node reicht. Wie voll die ist, steht in der
          Node-Übersicht.
        */}
        {/*
          ⚠️ Der Ping gilt dem NODE, nicht diesem Server: Alle Server darauf
          teilen sich den Wert - dieselbe Strecke, dieselbe Zahl. Der Hinweis
          steht am Titel der Kachel, sonst hält es jemand für eine Eigenschaft
          dieses einen Servers.

          Anders als bei hafenmeister klappt hier ein Ping-VERLAUF auf: Unsere
          Messwerte halten ihn fest (`server_stats_samples.ping_ms`), dort gibt
          es ihn nur als Momentaufnahme. Die Netzwerkzahlen stehen deshalb
          wieder in einer eigenen Karte weiter unten.
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
          onClick={() => klappe('ping')}
          expanded={istOffen('ping')}
        />
        {/*
          Die Spielerzahl steht wieder in der Reihe (Wunsch des Betreibers,
          15.09.2026). Ihr Verlauf ist die Kurve, die am meisten ueber den Tag
          erzaehlt: Wann war etwas los, wann stand der Server leer.
        */}
        <MetricTile
          label="Spieler"
          value={
            anzeige?.playersOnline == null
              ? '—'
              : mitBezug(
                  formatNumber(anzeige.playersOnline),
                  anzeige.playersMax == null ? null : `/ ${formatNumber(anzeige.playersMax)}`,
                )
          }
          // Eine volle Runde ist keine Warnung, sondern der Normalfall - hier
          // gibt es keine Ampel, nur „es laeuft".
          tone={anzeige?.playersOnline == null ? undefined : 'success'}
          note={anzeige?.playersOnline == null ? fehlgrund : undefined}
          {...(anzeige?.playersOnline == null ||
          anzeige.playersMax == null ||
          anzeige.playersMax <= 0
            ? {}
            : { percent: (anzeige.playersOnline / anzeige.playersMax) * 100 })}
          onClick={() => klappe('spieler')}
          expanded={istOffen('spieler')}
        />
        {/*
          Kein Aufklapper: Den Plattenplatz misst der Agent in eigenem,
          langsamerem Takt - ein Verlauf aus so wenigen Messungen ist keine
          Kurve. Ohne Obergrenze auch kein Balken; ein Server darf wachsen, so
          weit die Platte der Node reicht.
        */}
        <MetricTile
          label="Platte"
          value={
            stats?.diskUsedMb == null
              ? '—'
              : mitBezug(
                  zahlUndEinheit(formatMegabytes(stats.diskUsedMb)).zahl,
                  zahlUndEinheit(formatMegabytes(stats.diskUsedMb)).einheit,
                )
          }
          note={stats?.diskUsedMb == null ? 'noch nicht gemessen' : 'Datenordner, ohne Obergrenze'}
        />
        <MetricTile
          label="Laufzeit"
          value={formatUptimeClock(uptimeSeconds)}
          tone={uptimeSeconds === null ? undefined : 'success'}
          {...(uptimeSeconds === null ? {} : { percent: 100 })}
          /*
            Gross die laufende Sitzung, klein die Gesamtlaufzeit (Wunsch des
            Betreibers, 15.09.2026). Ohne den Zaehler - aelteres Backend -
            bleibt es bei der bisherigen Auskunft.
          */
          note={
            gesamtLaufzeit === null
              ? uptimeSeconds === null
                ? 'Server läuft nicht'
                : 'seit dem letzten Start'
              : `insgesamt ${formatDuration(gesamtLaufzeit)}${
                  uptimeSeconds === null ? ' · Server läuft nicht' : ''
                }`
          }
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
        Der Verlauf der angeklickten Kachel - und nur dieser.

        Der gewaehlte Zeitraum gilt fuer alle: Wer die CPU auf 24 Stunden
        stellt und dann auf den Arbeitsspeicher wechselt, meint denselben
        Zeitraum.
      */}
      {offeneKachel === null ? null : (
        <Panel variant="plain" className="flex animate-fade-up flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-ink-muted">
              {history.data === null ? 'Zeitraum' : `${formatNumber(messpunkte)} Messpunkte`}
            </span>
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

          {/*
            Der leere Zeitraum sagt es selbst, statt ein leeres Feld zu zeigen.
            Genau hier ging die Funktion frueher verloren: Ein Server, der eine
            Stunde stand, hat in der letzten Stunde nichts - in vierundzwanzig
            aber alles. Die Zeitraum-Wahl steht gleich darueber.
          */}
          {history.data !== null && messpunkte < 2 && !history.loading ? (
            <p className="text-base text-ink-muted">
              In diesem Zeitraum liegt {messpunkte === 0 ? 'keine Messung' : 'nur eine Messung'} vor
              – für eine Linie braucht es zwei. Ein größerer Zeitraum hilft, sobald der Server eine
              Weile lief.
            </p>
          ) : history.data === null ? null : offeneKachel === 'cpu' ? (
            <StatsHistoryChart
              samples={history.data.samples}
              metric="cpuPercent"
              label="CPU-Auslastung"
              // Keine feste Achsenobergrenze: Sie war das Kontingent des
              // Servers, und das gibt es seit dem Wegfall der CPU-Zuweisung
              // nicht. Der Verlauf skaliert auf seinen eigenen Hoechstwert -
              // so bleibt er lesbar, statt an einer Grenze zu kleben.
              max={null}
              formatValue={(wert) =>
                server.hostCpuCores == null || server.hostCpuCores <= 0
                  ? formatCores(wert / 100)
                  : formatPercent(Math.min(100, wert / server.hostCpuCores))
              }
            />
          ) : offeneKachel === 'ram' ? (
            <StatsHistoryChart
              samples={history.data.samples}
              metric="ramUsedMb"
              label="Arbeitsspeicher"
              max={server.resourceLimits.ramMb}
              formatValue={formatMegabytes}
            />
          ) : offeneKachel === 'spieler' ? (
            <StatsHistoryChart
              samples={history.data.samples}
              metric="playersOnline"
              label="Spieler online"
              max={anzeige?.playersMax ?? null}
              formatValue={(wert) => formatNumber(Math.round(wert))}
            />
          ) : (
            /*
              Die Ping-Kachel oeffnet die Netzwerkaktivitaet - vier Kurven
              statt der Karte, die frueher dauerhaft weiter unten stand
              (Wunsch des Betreibers, 15.09.2026). Beides gehoert zur
              Anbindung des Servers: Wie schnell die Strecke antwortet und was
              ueber sie laeuft.
            */
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {netzKurven.map((kurve) => (
                <div key={kurve.label} className="flex flex-col gap-1.5">
                  {/*
                    Beschriftung ueber dem Bild, nicht darin: Sie steht auch
                    dann da, wenn es fuer eine Linie noch nicht reicht - sonst
                    haette man ein namenloses Feld mit einem Hinweis darin.
                  */}
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-2xs uppercase tracking-[0.08em] text-ink-soft">
                      {kurve.label}
                    </span>
                    <span className="font-mono text-2xs text-ink-muted">{kurve.summe}</span>
                  </div>
                  <MetricChart
                    points={kurve.punkte}
                    label={kurve.label}
                    formatValue={kurve.formatiere}
                    emptyHint={kurve.leerHinweis}
                  />
                </div>
              ))}
            </div>
          )}

          {offeneKachel === 'ping' ? (
            <p className="text-xs text-ink-faint">
              Rate je Messpunkt, gerechnet aus den Zaehlern des Agents. Die Summen seit dem letzten
              Start stehen in der Kachel-Beschriftung; weil aller Spiel-Verkehr ueber das Relay
              laeuft, ist das zugleich der Verkehr durch die Panel-VPS.
            </p>
          ) : null}
        </Panel>
      )}

      {/*
        Die Namen der verbundenen Spieler (Gefundener Punkt 51).

        Die ZAHL steht wieder in ihrer Kachel oben; diese Karte traegt nur, was
        dort nicht hinpasst. Sie erscheint nur, wenn die Abfrage Namen hergibt:
        Der generische Port-Connect-Test kennt keine, und manche Server geben
        nur einen Auszug heraus. Eine leere Liste hiesse "keine Angabe" - sie
        als "niemand da" darzustellen waere gelogen.
      */}
      {live?.players && live.players.length > 0 ? (
        <Panel variant="plain" className="flex flex-col gap-2">
          <h3 className="text-base font-semibold">Verbundene Spieler</h3>
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
        </Panel>
      ) : null}

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
