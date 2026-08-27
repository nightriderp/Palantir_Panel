/**
 * Anzeigeformate der Server-Detailansicht.
 *
 * Nur noch das, was allein hier gebraucht wird: die Klartext-Beschreibung eines
 * Cron-Ausdrucks. Byte-Größen und Dauern sind mit F10 ins Design-System gezogen
 * (`formatBytes`, `formatDuration` in `components/shared/utils/format.ts`) und
 * werden von dort re-exportiert, damit die bestehenden Importe unverändert
 * bleiben – keine zweite Fassung daneben („Gefundener Punkt" 67). Datum und
 * Uhrzeit stehen seit R4 ebenfalls im Design-System.
 * Reine Funktionen, deshalb daneben getestet. Sprache ist Deutsch
 * (Lastenheft §4).
 */

export { formatBytes, formatDuration } from '@/components/shared';

const WEEKDAYS = [
  'sonntags',
  'montags',
  'dienstags',
  'mittwochs',
  'donnerstags',
  'freitags',
  'samstags',
];

/**
 * Cron-Ausdruck in einen Satz übersetzen.
 *
 * Deckt die Muster ab, die im Aufgaben-Dialog entstehen (täglich, wöchentlich,
 * stündlich, alle N Minuten). Alles andere bleibt als Ausdruck stehen – lieber
 * die rohe Angabe als eine falsche Beschreibung.
 */
export function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [minute = '', hour = '', dayOfMonth = '', month = '', dayOfWeek = ''] = parts;
  const everyDate = dayOfMonth === '*' && month === '*';
  const time =
    /^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour)
      ? `${hour.padStart(2, '0')}:${minute.padStart(2, '0')} Uhr`
      : null;

  if (everyDate && dayOfWeek === '*' && time) return `täglich um ${time}`;

  if (everyDate && time && /^[0-6]$/.test(dayOfWeek)) {
    return `${WEEKDAYS[Number(dayOfWeek)]} um ${time}`;
  }

  if (everyDate && dayOfWeek === '*' && hour === '*' && /^\d{1,2}$/.test(minute)) {
    return `stündlich zur Minute ${Number(minute)}`;
  }

  const everyMinutes = /^\*\/(\d+)$/.exec(minute);
  if (everyDate && dayOfWeek === '*' && hour === '*' && everyMinutes) {
    return `alle ${everyMinutes[1]} Minuten`;
  }

  return expression;
}
