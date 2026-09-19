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
 * Einheiten der Größenangaben (Fundpunkt 208).
 *
 * **Angezeigt wird in SI-Einheiten: kB, MB, GB, TB mit 1000er-Schritten**
 * (Wunsch des Betreibers, 15.09.2026 - „finds fuer die Anzeige schoener").
 *
 * Gespeichert und gerechnet wird weiterhin in Mebibyte: So sind die
 * Container-Limits gesetzt (`ramMb`, `diskMb` sind MiB), so meldet der Agent,
 * so rechnet die Kapazitaetspruefung. Umgerechnet wird deshalb **richtig** und
 * nicht nur umbeschriftet: 4096 MiB sind 4,29 GB, nicht „4 GB".
 *
 * Das ist der Punkt, an dem der Audit vom 2026-09-10 haengenblieb. Dort standen
 * 53 248 MiB als „52 GB" da, obwohl 52 GiB = 55,8 GB sind - die Zahl war um
 * 250 GB daneben, wenn man sie neben `df -h` legte. Die Loesung war damals
 * IEC-Kuerzel; jetzt ist es der andere richtige Weg, SI mit korrekter
 * Umrechnung. Falsch waere allein die dritte Moeglichkeit: 1024er-Zahlen mit
 * SI-Kuerzeln.
 *
 * ⚠️ Die EINGABEFELDER sind davon nicht beruehrt: Wer in der Node-Verwaltung
 * „8 GiB" eintraegt, traegt weiterhin Mebibyte ein. Sie tragen ihre Einheit
 * selbst am Feld; eine halbe Umstellung waere schlimmer als gar keine.
 */
const GROESSEN_EINHEITEN = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

/** Ab hier zaehlt jede Stufe: 1 kB = 1000 B (SI). */
const SCHRITT = 1000;

/** Ein Mebibyte in Byte - die Groesse, in der Limits und Messwerte stehen. */
const MEBIBYTE = 1024 * 1024;

/**
 * Drei geltende Ziffern, ohne Nullen am Ende – die Schreibweise, die auch
 * `df -h` und `ls -lh` benutzen.
 *
 * Vorher rundeten die beiden Formatierer unterschiedlich: `formatMegabytes`
 * gab Gigabyte auf eine, Terabyte auf zwei Stellen aus, `formatBytes` alles auf
 * eine. Dieselbe Größe sah damit je nach Anzeigeort anders aus.
 */
function mitDreiZiffern(wert: number): string {
  const stellen = wert >= 100 ? 0 : wert >= 10 ? 1 : 2;
  return NUMBER_FORMAT.format(Math.round(wert * 10 ** stellen) / 10 ** stellen);
}

/**
 * Byte-Größe lesbar machen, Basis 1000 in SI-Einheiten (siehe {@link GROESSEN_EINHEITEN}).
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

  let value = bytes;
  let einheit = 0;
  while (Math.abs(value) >= SCHRITT && einheit < GROESSEN_EINHEITEN.length - 1) {
    value /= SCHRITT;
    einheit += 1;
  }

  // Ganze Bytes bleiben ganz: „1.536 B" wäre eine Nachkommastelle, die es
  // nicht gibt.
  const zahl = einheit === 0 ? NUMBER_FORMAT.format(Math.round(value)) : mitDreiZiffern(value);
  return `${zahl} ${GROESSEN_EINHEITEN[einheit]}`;
}

/**
 * Speichergröße aus Mebibyte in eine lesbare Angabe.
 *
 * Dieselbe Rechnung wie {@link formatBytes} – seit Fundpunkt 208 wörtlich
 * dieselbe, nicht mehr eine zweite mit eigener Rundung. Die Umrechnung geht
 * über echte Bytes (1 MiB = 1 048 576 B), damit aus Mebibyte auch dann
 * richtige Gigabyte werden, wenn die Anzeige in SI-Einheiten steht.
 */
export function formatMegabytes(valueMb: number | null | undefined): string {
  if (valueMb == null || Number.isNaN(valueMb)) return '—';
  return formatBytes(valueMb * MEBIBYTE);
}

/**
 * Speichergröße aus Mebibyte für den engen Platz in einem Ring (`MetricRing`).
 *
 * Höchstens zwei geltende Ziffern: `6,1 GB`, `844 MB`, `10 GB`, `1,3 TB`. Die
 * volle Fassung (`6,11 GB`, drei Ziffern) passte nicht in die 54 px des Rings –
 * die Einheit rutschte unter die Zahl, auf der Karte stand „6,11" über einem
 * halben „GB" (Betreiber-Meldung 2026-09-19). Die dritte Ziffer trägt in
 * einem Ring nichts; wer sie braucht, findet sie im Tooltip.
 */
export function formatMegabytesKurz(valueMb: number | null | undefined): string {
  if (valueMb == null || Number.isNaN(valueMb)) return '—';

  let value = valueMb * MEBIBYTE;
  let einheit = 0;
  while (Math.abs(value) >= SCHRITT && einheit < GROESSEN_EINHEITEN.length - 1) {
    value /= SCHRITT;
    einheit += 1;
  }

  // Ab 9,95 rundet die eine Nachkommastelle auf „10,0" – dann lieber „10".
  const stellen = einheit === 0 || value >= 9.95 ? 0 : 1;
  const zahl = NUMBER_FORMAT.format(Math.round(value * 10 ** stellen) / 10 ** stellen);
  return `${zahl} ${GROESSEN_EINHEITEN[einheit]}`;
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

/**
 * Laufzeit als tickende Uhr: `3 d 12 h 04 min`, `12 h 04 min`, `4:09 min`, `22 s`.
 *
 * Unterschied zu {@link formatDuration}: Die gibt eine **Dauer** an und rundet
 * grob („3 d 12 h") - gut fuer „insgesamt", schlecht fuer eine Uhr, die jede
 * Sekunde neu gezeichnet wird und dabei minutenlang dieselbe Zahl zeigte. Hier
 * bleibt die naechstkleinere Einheit stehen, damit sichtbar ist, dass sie laeuft.
 */
export function formatUptimeClock(seconds: number | null | undefined): string {
  if (seconds == null || Number.isNaN(seconds) || seconds < 0) return '—';

  const gesamt = Math.floor(seconds);
  const tage = Math.floor(gesamt / 86_400);
  const stunden = Math.floor((gesamt % 86_400) / 3600);
  const minuten = Math.floor((gesamt % 3600) / 60);
  const rest = gesamt % 60;

  const zweistellig = (wert: number): string => String(wert).padStart(2, '0');

  if (tage > 0) return `${String(tage)} d ${String(stunden)} h ${zweistellig(minuten)} min`;
  if (stunden > 0) return `${String(stunden)} h ${zweistellig(minuten)} min`;
  if (minuten > 0) return `${String(minuten)}:${zweistellig(rest)} min`;
  return `${String(rest)} s`;
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

/**
 * Anteil in Prozent, auf ganze Zahlen gerundet; `null`, wenn die Bezugsgröße
 * fehlt oder null ist.
 *
 * **Nicht** begrenzt: Eine überbuchte Node steht bei 114 %, und genau das soll
 * sie zeigen (Fundpunkt 209). Wer einen Balken füllt, nimmt
 * {@link clampedPercentOf} oder deckelt selbst.
 *
 * Stand bis zum Audit vom 2026-09-10 dreimal im Frontend (Fundpunkt 208):
 * einmal hier als `percentOf` in der Node-Ansicht und zweimal als `ratio` –
 * mit unterschiedlicher Begrenzung.
 */
export function percentOf(used: number, total: number): number | null {
  if (!Number.isFinite(total) || total <= 0) return null;
  return Math.round((used / total) * 100);
}

/** Wie {@link percentOf}, aber auf 0–100 begrenzt – für Balken und Ringe. */
export function clampedPercentOf(used: number | null | undefined, total: number): number | null {
  if (used == null) return null;
  const anteil = percentOf(used, total);
  return anteil === null ? null : clampPercent(anteil);
}

/*
 * Kein `cpuQuotaPercent` mehr.
 *
 * Die Funktion rechnete `ServerLiveStats.cpuPercent` (Prozent **eines** Kerns)
 * auf das CPU-Kontingent des Servers um. Mit dem Wegfall der CPU-Zuweisung gibt
 * es dieses Kontingent nicht mehr, und damit keine Bezugsgröße: Ein Container
 * darf alle Kerne der Node sehen. Die Ansichten zeigen deshalb die
 * ausgelasteten Kerne als Zahl ({@link formatCores}), nicht als Füllstand gegen
 * eine geratene Obergrenze – und die Funktion hatte danach keinen Aufrufer
 * mehr.
 */

/**
 * CPU-Kerne mit deutschem Dezimalkomma und richtiger Einzahl, z. B. `7,5 Kerne`
 * oder `1 Kern`.
 *
 * Herkunft: lag bis zum Audit vom 2026-09-10 bei F2 (`nodes/nodeStatus.ts`),
 * weil nur die Node-Karte Kerne beschriftete. Die Serverdetails schrieben
 * daneben `${cpuCores} Kerne` von Hand hin – und damit „1 Kerne" (Fundpunkt
 * 220, UI-35). Mit dem zweiten Anzeigeort gehört die Funktion hierher, dieselbe
 * Begründung wie bei {@link formatBytes}.
 */
export function formatCores(cores: number): string {
  const rounded = Math.round(cores * 10) / 10;
  return `${formatNumber(rounded)} ${rounded === 1 ? 'Kern' : 'Kerne'}`;
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

/**
 * Beschriftung der Image-Fassung, z. B. „v9" (Betreiber-Wunsch 19.09.2026: die
 * Versionierung überall sehen; Fundpunkt 317: als Versionsnummer statt als Wort).
 *
 * Gemeint ist die Fassung des **Images**, nicht die des Spiels. Das `v` hält
 * beide auseinander, wo sie nebeneinander stehen: Die Spielfassung erscheint
 * ohne Vorsatz direkt hinter dem Spielnamen („Minecraft 1.21.4"), die des
 * Images mit – „Minecraft 1.21.4 · v9". Vorher stand dort das Wort „Fassung";
 * ausgeschrieben nahm es in der Unterzeile den Platz weg, der zum Abschneiden
 * führte.
 *
 * `null`, wenn nichts bekannt ist – dann steht an der Stelle gar nichts,
 * statt eines Platzhalters, der nichts sagt.
 */
export function formatImageVersion(version: string | null | undefined): string | null {
  return version === null || version === undefined || version === '' ? null : `v${version}`;
}

/**
 * Erklärung zum Hinweis „Update verfügbar": welche Fassung läuft und welche
 * angeboten wird.
 *
 * Bisher sagte der Hinweis nur, dass etwas Neueres da ist. Erst die beiden
 * Zahlen machen daraus eine Auskunft. Fehlt eine davon, bleibt es beim
 * bisherigen Text – `null` heißt hier „nichts zu ergänzen".
 */
export function formatImageUpdate(
  current: string | null | undefined,
  latest: string | null | undefined,
): string | null {
  if (!current || !latest || current === latest) {
    return null;
  }

  return `v${current} läuft, angeboten wird v${latest}.`;
}
