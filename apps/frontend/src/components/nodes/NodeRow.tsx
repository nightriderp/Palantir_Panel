import { type HostNodeDto } from '@palantir/contracts';
import {
  Icon,
  Panel,
  TONE_DOT_CLASSES,
  TONE_TEXT_CLASSES,
  cn,
  formatDate,
  formatDateTime,
  formatNumber,
} from '@/components/shared';
import { NodeStatusPill } from './NodeStatusPill';
import { type NodeMetric, nodeCpuLabel, nodeMetrics, nodeStatusMeta } from './nodeStatus';

export interface NodeRowProps {
  node: HostNodeDto;
  className?: string;
}

/**
 * Ein Balken je Ressource (RAM, Platte).
 *
 * Über dem Balken steht links „Beschriftung · belegt / gesamt" und rechts der
 * freie Rest – die für den Nutzer entscheidende Zahl bleibt damit im Klartext,
 * der Balken bebildert sie nur. Die Breite kommt als Inline-Wert (0–100 %),
 * weil ein dynamischer Anteil sich nicht als Utility-Klasse ausdrücken lässt;
 * Farbe und Radius bleiben Tokens.
 */
function MeterBar({ metric }: { metric: NodeMetric }) {
  const width = Math.min(100, metric.percent ?? 0);

  return (
    <div>
      {/*
        Beschriftung links, Zahl rechts – und die Zahl in der Farbe des
        Balkens. Vorher standen Beschriftung, Belegung und Rest als ein Band
        aus Text über dem Balken; welche Zahl zu welchem Balken gehörte, musste
        man sich zusammensuchen.
      */}
      <div className="flex items-baseline justify-between gap-2 text-2xs text-ink-soft">
        <span className="truncate">{metric.label}</span>
        <span className={cn('shrink-0 font-mono', TONE_TEXT_CLASSES[metric.tone])}>
          {metric.usedLabel} / {metric.totalLabel}
        </span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-sm bg-fill-strong"
        role="progressbar"
        aria-label={metric.label}
        aria-valuemin={0}
        aria-valuemax={100}
        // Ueber 100 waere fuer eine Vorlesehilfe ausserhalb des Bereichs; wie
        // weit darueber, steht als Text daneben (Fundpunkt 209).
        aria-valuenow={metric.percent === null ? undefined : Math.min(100, metric.percent)}
      >
        <div
          className={cn(
            'h-full rounded-sm transition-[width] duration-500',
            TONE_DOT_CLASSES[metric.tone],
          )}
          style={{ width: `${width}%` }}
        />
      </div>

      {/*
        Unter dem Balken der Rest – und die beiden Sonderfälle:

        Fundpunkt 209: Ist mehr gebucht als vorhanden, stand hier „0 GB frei",
        dieselbe Auskunft wie bei einer exakt vollen Node. Wie viel zu viel
        gebucht ist, sagt jetzt der rote Text.

        Fundpunkt 203: Daneben die zweite Zahl, gegen die ein Start tatsächlich
        geprüft wird – ohne sie wirkte die erste wie eine Absage.
      */}
      <div className="mt-1 flex flex-wrap items-baseline gap-x-2 text-2xs">
        <span
          className={
            metric.overbookedLabel === undefined ? 'text-ink-faint' : 'font-semibold text-danger'
          }
        >
          {metric.percent === null
            ? 'Keine Angabe'
            : (metric.overbookedLabel ?? `${metric.freeLabel} frei`)}
        </span>
        {metric.runningLabel === undefined ? null : (
          <span className="text-ink-faint">{metric.runningLabel}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Eine Node als kompakte Zeile (Lastenheft §3.7, Mockup „Nodes").
 *
 * Aufbau wie im Entwurf: links Zustandspunkt, Name und die gebuchten Kerne,
 * daneben je ein Balken für RAM und Platte, rechts Serveranzahl und
 * Einrichtungsdatum. Die Kerne stehen als Text statt als dritter Balken – so
 * bleibt die Zeile eine Zeile, ohne dass die Angabe verlorengeht.
 *
 * Unter `md` klappt alles untereinander (Lastenheft §4, Mobile-First); die
 * Balken behalten dabei ihre volle Breite.
 *
 * Rein darstellend. Zeigt bewusst **keine** sicherheitsrelevanten Interna: die
 * WireGuard-Adresse aus dem DTO bleibt außen vor (Vorgabe F7) – anders als im
 * Entwurf, der sie neben den Namen setzt. Verwalten, Pausieren und Löschen
 * gehören zur Node-Verwaltung (F10) und tauchen hier nicht auf, unabhängig von
 * den Rechten des Betrachters.
 */
export function NodeRow({ node, className }: NodeRowProps) {
  const meta = nodeStatusMeta(node.status);
  const balken = nodeMetrics(node);

  return (
    <Panel variant="raised" padding="sm" className={cn('flex flex-col gap-3', className)}>
      <div className="grid items-center gap-x-5 gap-y-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-2.5">
          {/*
            Der Zustandspunkt leuchtet (Vorbild hafenmeister): ein Schein in
            seiner eigenen Farbe. In einer Liste aus drei, vier Zeilen ist das
            die Angabe, die man zuerst sucht – als flacher 10-px-Punkt ging sie
            neben Namen und Balken unter.
          */}
          <span
            aria-hidden
            className={cn(
              'inline-block h-2.5 w-2.5 shrink-0 rounded-full bg-current shadow-[0_0_8px_currentColor]',
              TONE_TEXT_CLASSES[meta.tone],
              meta.pulse && 'animate-pulse-dot',
            )}
          />
          {/* Symbolkachel vor dem Namen – sie macht aus der Zeile eine Node
              statt einer weiteren Textzeile. */}
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-fill text-ink-soft"
          >
            <Icon name="server" size={17} />
          </span>
          <div className="min-w-0">
            <div className="truncate font-mono text-md font-semibold">{node.name}</div>
            <div className="truncate text-2xs text-ink-faint">
              <span className="font-mono">{nodeCpuLabel(node)}</span>
              {node.lastSeenAt === null ? null : (
                <> · zuletzt gesehen {formatDateTime(node.lastSeenAt)}</>
              )}
            </div>
          </div>
        </div>

        {balken.map((metric) => (
          <MeterBar key={metric.key} metric={metric} />
        ))}

        <div className="flex items-center justify-between gap-3 md:flex-col md:items-end md:gap-1">
          <NodeStatusPill status={node.status} />
          <span className="text-2xs text-ink-faint">
            {formatNumber(node.serverCount)} Server · seit {formatDate(node.createdAt)}
          </span>
        </div>
      </div>

      {node.status === 'online' ? null : (
        <p className="text-sm text-ink-muted">{meta.description}</p>
      )}

      {node.statusMessage ? (
        <div className="flex items-start gap-2 rounded-lg border border-line bg-fill px-3 py-2 text-sm text-ink-muted">
          <Icon name="warning" size={14} className="mt-0.5 shrink-0 text-warning" />
          <span>{node.statusMessage}</span>
        </div>
      ) : null}
    </Panel>
  );
}
