import { type ChartPoint } from '@/components/shared';

/**
 * Verlauf der Kopfzeilen-Werte, **im Browser gesammelt**.
 *
 * ⚠️ Für diese Zahlen gibt es keinen gespeicherten Verlauf. Sie entstehen bei
 * jedem Abruf frisch aus Servern und Nodes; abgelegt wird nur die Auslastung
 * **je Server** (`server_stats_samples`), nicht die der Maschinen und nicht die
 * Gesamt-Spielerzahl. Der Verlauf hier reicht deshalb bewusst nur so weit
 * zurück, wie die Seite offen ist – und das Fenster sagt es auch.
 *
 * Ein echter Verlauf über Tage wäre eine eigene Tabelle samt Schreibweg und
 * Aufräumen; das gehört in ein eigenes Arbeitspaket, nicht in ein Tooltip.
 *
 * Übernommen aus hafenmeister (`AppShell.tsx`), samt der Deckelung: Ohne sie
 * wüchse die Liste bei einem Fenster, das über Nacht offen bleibt, endlos.
 */

/** 180 Messungen – bei fünf Sekunden Takt eine Viertelstunde. */
export const STATUS_HISTORY_LIMIT = 180;

export interface StatusSample {
  /** Zeitpunkt in Millisekunden seit Epoch. */
  ts: number;
  /** Wert je Kennzahl, abgelegt unter ihrem `key`. */
  values: Readonly<Record<string, number>>;
}

/**
 * Hängt eine Messung an und wirft die ältesten weg.
 *
 * Rein gehalten, damit die Deckelung prüfbar ist, ohne eine Komponente zu
 * mieten.
 */
export function appendStatusSample(
  history: readonly StatusSample[],
  sample: StatusSample,
  limit = STATUS_HISTORY_LIMIT,
): StatusSample[] {
  const next = [...history, sample];
  return next.length > limit ? next.slice(next.length - limit) : next;
}

/** Die Punkte einer einzelnen Kennzahl aus dem Verlauf. */
export function statusSeries(history: readonly StatusSample[], key: string): ChartPoint[] {
  return history.flatMap<ChartPoint>((sample) => {
    const value = sample.values[key];
    return value === undefined ? [] : [{ ts: sample.ts, value }];
  });
}

/**
 * Wie weit der gesammelte Verlauf zurückreicht – als Satz für das Fenster.
 *
 * Ehrlich benannt: Es ist nicht „der Verlauf", sondern der Verlauf seit dem
 * Öffnen der Seite.
 */
export function statusSpanLabel(points: readonly ChartPoint[]): string {
  if (points.length < 2) return 'sammelt noch …';

  const spanMs = (points[points.length - 1]?.ts ?? 0) - (points[0]?.ts ?? 0);
  const minutes = Math.round(spanMs / 60_000);

  return minutes < 1 ? 'letzte Sekunden' : `letzte ${String(minutes)} Min.`;
}
