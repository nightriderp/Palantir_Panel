/**
 * Anzeigeformate der Server-Detailansicht.
 *
 * Ergänzt `components/shared/utils/format.ts` um das, was nur hier gebraucht
 * wird: Byte-Größen, Dauern und die Klartext-Beschreibung eines Cron-Ausdrucks.
 * Datum und Uhrzeit stehen seit R4 im Design-System (`formatDate`,
 * `formatDateTime`, `formatTime`) – hier steht bewusst keine zweite Fassung.
 * Reine Funktionen, deshalb daneben getestet. Sprache ist Deutsch
 * (Lastenheft §4).
 */

const NUMBER_FORMAT = new Intl.NumberFormat('de-DE');

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Byte-Größe lesbar machen, Basis 1024 – wie überall sonst im Projekt.
 *
 * Verzeichnisse und unbekannte Größen liefern `—` statt „0 B", damit eine
 * fehlende Angabe nicht wie eine leere Datei aussieht.
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${NUMBER_FORMAT.format(Math.round(bytes))} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${NUMBER_FORMAT.format(Math.round(value * 10) / 10)} ${BYTE_UNITS[unit]}`;
}

/** Dauer in Sekunden als `2 h 15 min`; `—` bei fehlender Angabe. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds) || seconds < 0) return '—';

  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${total} s`;
}

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
