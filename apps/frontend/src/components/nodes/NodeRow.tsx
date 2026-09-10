import { type HostNodeDto } from '@palantir/contracts';
import { Icon, Panel, TONE_DOT_CLASSES, cn, formatDate, formatNumber } from '@/components/shared';
import { NodeStatusPill } from './NodeStatusPill';
import { type NodeMetric, nodeMetrics, nodeStatusMeta } from './nodeStatus';

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
      <div className="flex items-baseline justify-between gap-2 text-2xs text-ink-soft">
        <span className="truncate">
          {metric.label} ·{' '}
          <span className="font-mono text-ink-muted">
            {metric.usedLabel} / {metric.totalLabel}
          </span>
        </span>
        {/*
          Fundpunkt 209: Ist mehr gebucht als vorhanden, stand hier „0 GB frei" -
          dieselbe Auskunft wie bei einer exakt vollen Node. Wie viel zu viel
          gebucht ist, sagt jetzt der rote Text an derselben Stelle.
        */}
        <span
          className={cn(
            'shrink-0',
            metric.overbookedLabel === undefined ? 'text-ink-faint' : 'font-semibold text-danger',
          )}
        >
          {metric.percent === null
            ? 'Keine Angabe'
            : (metric.overbookedLabel ?? `${metric.freeLabel} frei`)}
        </span>
      </div>
      {metric.runningLabel === undefined ? null : (
        // Fundpunkt 203: Die zweite Zahl, gegen die ein Start tatsaechlich
        // geprueft wird - ohne sie wirkte die erste wie eine Absage.
        <div className="mt-0.5 text-2xs text-ink-faint">{metric.runningLabel}</div>
      )}
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
          className={cn('h-full rounded-sm', TONE_DOT_CLASSES[metric.tone])}
          style={{ width: `${width}%` }}
        />
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
  const metrics = nodeMetrics(node);

  const cpu = metrics.find((metric) => metric.key === 'cpu');
  const balken = metrics.filter((metric) => metric.key !== 'cpu');

  return (
    <Panel variant="raised" padding="sm" className={cn('flex flex-col gap-3', className)}>
      <div className="grid items-center gap-x-5 gap-y-3 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            aria-hidden
            className={cn(
              'inline-block h-2.5 w-2.5 shrink-0 rounded-full',
              TONE_DOT_CLASSES[meta.tone],
              meta.pulse && 'animate-pulse-dot',
            )}
          />
          <div className="min-w-0">
            <div className="truncate text-md font-semibold">{node.name}</div>
            {cpu ? (
              <div className="truncate text-2xs text-ink-faint">
                {cpu.label} ·{' '}
                <span className="font-mono">
                  {cpu.usedLabel} / {cpu.totalLabel}
                </span>
              </div>
            ) : null}
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
