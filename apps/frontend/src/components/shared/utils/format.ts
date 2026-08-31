import { type ServerAddress } from '@palantir/contracts';

/**
 * Anzeige-Formatierungen des Design-Systems.
 *
 * Alles hier ist reine Funktion ohne React – deshalb direkt testbar
 * (siehe `format.test.ts`). Oberflächensprache ist Deutsch (Lastenheft §4),
 * Zahlen werden entsprechend mit `de-DE` formatiert.
 */

const NUMBER_FORMAT = new Intl.NumberFormat('de-DE');

/** Ganze Zahl mit deutschem Tausenderpunkt, z. B. `1.024`. */
export function formatNumber(value: number): string {
  return NUMBER_FORMAT.format(value);
}

/**
 * Speichergröße aus Megabyte in eine lesbare Angabe.
 *
 * Basis 1024, wie überall sonst im Projekt bei Container-Limits.
 */
export function formatMegabytes(valueMb: number | null | undefined): string {
  if (valueMb == null || Number.isNaN(valueMb)) return '—';
  if (valueMb < 1024) return `${NUMBER_FORMAT.format(Math.round(valueMb))} MB`;
  const gb = valueMb / 1024;
  if (gb < 1024) {
    return `${NUMBER_FORMAT.format(Math.round(gb * 10) / 10)} GB`;
  }
  return `${NUMBER_FORMAT.format(Math.round((gb / 1024) * 100) / 100)} TB`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/**
 * Byte-Größe lesbar machen, Basis 1024 – wie überall sonst im Projekt.
 *
 * Verzeichnisse und unbekannte Größen liefern `—` statt „0 B", damit eine
 * fehlende Angabe nicht wie eine leere Datei aussieht.
 *
 * Herkunft: bis R6 lag diese Funktion bei F3 (`components/servers/formatDetail.ts`),
 * weil nur die Server-Detailansicht Byte-Größen zeigte. Mit F10 (globale Backups,
 * Storage-Explorer) kam der zweite Anzeigeort dazu – deshalb hier im
 * Design-System, statt einer zweiten Fassung daneben („Gefundener Punkt" 67).
 */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || Number.isNaN(bytes)) return '—';
  if (bytes < 1024) return `${NUMBER_FORMAT.format(Math.round(bytes))} B`;

  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${NUMBER_FORMAT.format(Math.round(value * 10) / 10)} ${BYTE_UNITS[unit]}`;
}

/** Dauer in Sekunden als `2 h 15 min`; `—` bei fehlender oder negativer Angabe. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return '—';

  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  if (days > 0) return `${days} d ${hours} h`;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min`;
  return `${total} s`;
}

/** Prozentwert, auf ganze Prozent gerundet und auf 0–100 begrenzt. */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—';
  return `${clampPercent(value)} %`;
}

/** Begrenzt einen Wert auf den Bereich 0–100 und rundet ihn auf ganze Zahlen. */
export function clampPercent(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** Spieleranzahl als `3 / 20`; `—`, solange keine Zahlen vorliegen. */
export function formatPlayers(
  online: number | null | undefined,
  max: number | null | undefined,
): string {
  if (online == null) return '—';
  if (max == null) return NUMBER_FORMAT.format(online);
  return `${NUMBER_FORMAT.format(online)} / ${NUMBER_FORMAT.format(max)}`;
}

/** Latenz in Millisekunden, z. B. `24 ms`. */
export function formatPing(pingMs: number | null | undefined): string {
  if (pingMs == null) return '—';
  return `${NUMBER_FORMAT.format(Math.round(pingMs))} ms`;
}

/**
 * Verbindungsadresse als eine Zeile.
 *
 * Ohne Port (Hostname-Routing, initial Minecraft – Pflichtenheft §13) wird nur
 * der Hostname ausgegeben.
 */
export function formatServerAddress(address: ServerAddress | null | undefined): string | null {
  if (!address) return null;
  return address.port == null ? address.hostname : `${address.hostname}:${address.port}`;
}

/**
 * Kürzel für die Server-Kachel: die ersten beiden Buchstaben/Ziffern des Namens.
 *
 * Fällt auf `??` zurück, wenn der Name keine verwertbaren Zeichen enthält.
 */
export function serverInitials(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N}]/gu, '');
  if (cleaned.length === 0) return '??';
  return cleaned.slice(0, 2).toUpperCase();
}

/**
 * Datums- und Zeitformate (Arbeitspaket R4, „Gefundene Punkte“ 26).
 *
 * Vorher hatte jede Ansicht ihre eigene Fassung: F1 im Wartebildschirm, F3 in
 * `components/servers/formatDetail.ts`. Beide nutzen jetzt diese hier.
 *
 * Eingabe ist immer der ISO-Zeitstempel aus dem DTO; fehlende oder unlesbare
 * Angaben ergeben `—`, damit eine Lücke nicht wie ein echter Wert aussieht.
 * Ausgegeben wird in der Zeitzone des Browsers – das Backend liefert UTC.
 */

const DATE_FORMAT = new Intl.DateTimeFormat('de-DE', { dateStyle: 'long' });

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

const TIME_FORMAT = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' });

/**
 * Kurzform relativer Zeitangaben: `vor 12 Min.`, `vor 3 Std.`, `gestern`.
 *
 * `numeric: 'auto'` ist Absicht – daraus wird „gestern" statt „vor 1 Tag".
 */
const RELATIVE_FORMAT = new Intl.RelativeTimeFormat('de-DE', {
  numeric: 'auto',
  style: 'short',
});

/** Wandelt einen ISO-Zeitstempel in ein `Date`; `null`, wenn er nicht taugt. */
function toDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Datum ausgeschrieben, z. B. `26. August 2026`. */
export function formatDate(iso: string | null | undefined): string {
  const date = toDate(iso);
  return date ? DATE_FORMAT.format(date) : '—';
}

/** Datum und Uhrzeit, z. B. `26.08.2026, 14:05`. */
export function formatDateTime(iso: string | null | undefined): string {
  const date = toDate(iso);
  return date ? DATE_TIME_FORMAT.format(date) : '—';
}

/** Nur die Uhrzeit, z. B. `14:05`. */
export function formatTime(iso: string | null | undefined): string {
  const date = toDate(iso);
  return date ? TIME_FORMAT.format(date) : '—';
}

/**
 * Zeitpunkt relativ zu jetzt, z. B. `vor 12 Min.` oder `gestern`.
 *
 * Für Listen, in denen das genaue Datum stört – etwa die Glocke in der
 * Kopfleiste. Ab einer Woche wird auf das ausgeschriebene Datum umgeschaltet:
 * „vor 6 Wo." sagt weniger als „12. Juli 2026".
 *
 * `jetzt` ist nur für Tests da; im Betrieb bleibt es beim aktuellen Zeitpunkt.
 * Die Ausgabe hängt damit von der Uhr ab und gehört deshalb nicht in
 * server-gerenderte Bereiche – sonst weicht sie beim Hydrieren ab.
 */
export function formatRelativeTime(iso: string | null | undefined, jetzt = new Date()): string {
  const date = toDate(iso);
  if (!date) return '—';

  const sekunden = Math.round((date.getTime() - jetzt.getTime()) / 1000);
  const betrag = Math.abs(sekunden);

  if (betrag < 45) return 'gerade eben';
  if (betrag < 3600) return RELATIVE_FORMAT.format(Math.round(sekunden / 60), 'minute');
  if (betrag < 86400) return RELATIVE_FORMAT.format(Math.round(sekunden / 3600), 'hour');
  if (betrag < 86400 * 7) return RELATIVE_FORMAT.format(Math.round(sekunden / 86400), 'day');

  return formatDate(iso);
}

/**
 * Zeitstempel im Gesprächsverlauf: `14:05` am selben Tag, sonst `30.08.2026, 14:05`.
 *
 * Im Chat steht das Datum an jeder Blase im Weg, solange alles vom selben Tag
 * ist – über einen Tagwechsel hinweg fehlt es aber. Deshalb beides, je nach
 * Alter der Nachricht.
 *
 * `jetzt` ist nur für Tests da.
 */
export function formatChatTime(iso: string | null | undefined, jetzt = new Date()): string {
  const date = toDate(iso);
  if (!date) return '—';

  const gleicherTag =
    date.getFullYear() === jetzt.getFullYear() &&
    date.getMonth() === jetzt.getMonth() &&
    date.getDate() === jetzt.getDate();

  return gleicherTag ? TIME_FORMAT.format(date) : DATE_TIME_FORMAT.format(date);
}
