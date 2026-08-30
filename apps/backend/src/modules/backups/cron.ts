/**
 * Auswertung von Cron-Ausdrücken für geplante Aufgaben (Pflichtenheft §6,
 * Entität `Schedule`; Lastenheft §3.3).
 *
 * **Warum eine eigene, kleine Umsetzung und keine Bibliothek** (CLAUDE.md §1):
 * Gebraucht wird genau zweierlei – „passt dieser Ausdruck auf diese Minute?“ und
 * „wann ist der nächste Lauf?“. Beides ist mit den fünf Standardfeldern
 * überschaubar und vollständig testbar. Eine zusätzliche Abhängigkeit für rund
 * hundert Zeilen wäre schwerer zu rechtfertigen als der Code selbst. Andere
 * Arbeitspakete mit geplanten Aufgaben (B3: `restart`/`command`) nutzen bitte
 * diese Datei, statt eine zweite Auswertung danebenzustellen.
 *
 * **Unterstützt** wird die klassische Fünf-Feld-Syntax:
 * `Minute Stunde Tag-des-Monats Monat Wochentag`, je Feld `*`, eine Zahl, eine
 * Liste (`1,15`), ein Bereich (`1-5`) und eine Schrittweite – geschrieben als
 * Stern, Schrägstrich, Zahl (alle 15 Minuten) oder als Bereich mit Schrittweite
 * (`0-30/10`).
 * Wochentag: `0` und `7` sind beide Sonntag.
 *
 * **Bewusst nicht unterstützt:** Namen (`MON`, `JAN`), Sonderausdrücke
 * (`@daily`), `L`/`W`/`#`. Sie kommen in den Anwendungsfällen aus Lastenheft
 * §3.3 nicht vor und würden die Auswertung deutlich vergrößern.
 *
 * **Zeitzone:** ausgewertet wird in der lokalen Zeit des Backends. Ein
 * Zeitplan „täglich 04:00“ meint damit 04:00 auf dem Server, auf dem das
 * Backend läuft – dieselbe Zeit, die auch in der Oberfläche angezeigt wird.
 * Aufgaben aus dem Reiter „Aufgaben“ (B3) bringen dagegen eine eigene
 * IANA-Zeitzone mit; für sie gibt es {@link nextCronRunInZone}. Die Zerlegung
 * und die Trefferregeln sind dieselben – nur der Kalender, in dem gerechnet
 * wird, ist ein anderer.
 */

import { ScheduleError } from './errors.js';

interface CronField {
  readonly min: number;
  readonly max: number;
  /** Erlaubte Werte, aufsteigend. */
  readonly values: readonly number[];
  /** `true` bei `*` – wichtig für die Sonderregel bei Tag/Wochentag. */
  readonly wildcard: boolean;
}

export interface ParsedCronExpression {
  readonly minute: CronField;
  readonly hour: CronField;
  readonly dayOfMonth: CronField;
  readonly month: CronField;
  readonly dayOfWeek: CronField;
}

const FIELD_RANGES = [
  { name: 'Minute', min: 0, max: 59 },
  { name: 'Stunde', min: 0, max: 23 },
  { name: 'Tag des Monats', min: 1, max: 31 },
  { name: 'Monat', min: 1, max: 12 },
  { name: 'Wochentag', min: 0, max: 7 },
] as const;

function fail(message: string): never {
  throw new ScheduleError('SCHEDULE_INVALID_CRON', message);
}

function parseField(raw: string, min: number, max: number, name: string): CronField {
  const values = new Set<number>();
  const wildcard = raw === '*' || raw.startsWith('*/');

  for (const part of raw.split(',')) {
    if (part === '') {
      fail(`Feld „${name}“: leerer Eintrag in „${raw}“.`);
    }

    const [rangePart, stepPart, ...rest] = part.split('/');

    if (rest.length > 0 || rangePart === undefined) {
      fail(`Feld „${name}“: „${part}“ hat mehr als eine Schrittweite.`);
    }

    let step = 1;

    if (stepPart !== undefined) {
      step = Number(stepPart);

      if (!Number.isInteger(step) || step < 1) {
        fail(`Feld „${name}“: Schrittweite „${stepPart}“ muss eine Zahl ab 1 sein.`);
      }
    }

    let from: number;
    let to: number;

    if (rangePart === '*') {
      from = min;
      to = max;
    } else if (rangePart.includes('-')) {
      const [fromRaw, toRaw, ...tooMany] = rangePart.split('-');

      if (tooMany.length > 0 || fromRaw === undefined || toRaw === undefined) {
        fail(`Feld „${name}“: „${rangePart}“ ist kein gültiger Bereich.`);
      }

      from = Number(fromRaw);
      to = Number(toRaw);
    } else {
      from = Number(rangePart);
      to = from;
    }

    if (!Number.isInteger(from) || !Number.isInteger(to)) {
      fail(`Feld „${name}“: „${rangePart}“ enthält keine ganzen Zahlen.`);
    }

    if (from < min || to > max || from > to) {
      fail(`Feld „${name}“: „${rangePart}“ liegt außerhalb von ${min}–${max}.`);
    }

    for (let value = from; value <= to; value += step) {
      values.add(value);
    }
  }

  if (values.size === 0) {
    fail(`Feld „${name}“: „${raw}“ ergibt keinen einzigen Zeitpunkt.`);
  }

  return { min, max, values: [...values].sort((a, b) => a - b), wildcard };
}

/**
 * Zerlegt einen Cron-Ausdruck.
 *
 * @throws {ScheduleError} mit `SCHEDULE_INVALID_CRON`, wenn der Ausdruck nicht
 *   den fünf Feldern entspricht oder Werte außerhalb ihres Bereichs stehen.
 */
export function parseCronExpression(expression: string): ParsedCronExpression {
  const fields = expression.trim().split(/\s+/);

  if (fields.length !== FIELD_RANGES.length) {
    fail(
      `Ein Zeitplan besteht aus fünf Feldern (Minute Stunde Tag Monat Wochentag), hier sind es ${String(fields.length)}.`,
    );
  }

  const [minute, hour, dayOfMonth, month, dayOfWeek] = FIELD_RANGES.map((range, index) =>
    parseField(fields[index] as string, range.min, range.max, range.name),
  ) as [CronField, CronField, CronField, CronField, CronField];

  return { minute, hour, dayOfMonth, month, dayOfWeek };
}

/** Prüft ohne Ausnahme, ob ein Ausdruck gültig ist (z. B. für Formulare). */
export function isValidCronExpression(expression: string): boolean {
  try {
    parseCronExpression(expression);

    return true;
  } catch {
    return false;
  }
}

function matchesDayOfWeek(field: CronField, weekday: number): boolean {
  // Sonntag ist sowohl 0 als auch 7 – die verbreitete Cron-Konvention.
  return field.values.includes(weekday) || (weekday === 0 && field.values.includes(7));
}

/**
 * Passt der Ausdruck auf diese Minute?
 *
 * Sekunden und Millisekunden werden ignoriert: Cron kennt keine feinere
 * Auflösung als eine Minute.
 *
 * Die Sonderregel bei Tag-des-Monats und Wochentag folgt der klassischen
 * Cron-Semantik: Sind **beide** Felder gesetzt (kein `*`), reicht es, wenn
 * **eines** von beiden passt. `0 4 13 * 5` bedeutet also „jeden 13. und jeden
 * Freitag“, nicht „an Freitagen, die auf den 13. fallen“.
 */
export function cronMatches(parsed: ParsedCronExpression, moment: Date): boolean {
  return (
    parsed.minute.values.includes(moment.getMinutes()) &&
    parsed.hour.values.includes(moment.getHours()) &&
    dayMatches(parsed, moment)
  );
}

/** Kalenderfelder eines Tages – aus lokaler Zeit oder aus einer Zeitzone. */
interface DayFields {
  /** Monat 1–12. */
  readonly month: number;
  /** Tag des Monats 1–31. */
  readonly dayOfMonth: number;
  /** Wochentag 0–6, Sonntag ist 0. */
  readonly weekday: number;
}

/** Passt der Tag (Monat, Tag-des-Monats, Wochentag) – unabhängig von der Uhrzeit? */
function dayMatches(parsed: ParsedCronExpression, day: Date): boolean {
  return dayFieldsMatch(parsed, {
    month: day.getMonth() + 1,
    dayOfMonth: day.getDate(),
    weekday: day.getDay(),
  });
}

function dayFieldsMatch(parsed: ParsedCronExpression, day: DayFields): boolean {
  if (!parsed.month.values.includes(day.month)) {
    return false;
  }

  const dom = parsed.dayOfMonth.values.includes(day.dayOfMonth);
  const dow = matchesDayOfWeek(parsed.dayOfWeek, day.weekday);

  if (parsed.dayOfMonth.wildcard && parsed.dayOfWeek.wildcard) {
    return true;
  }

  if (parsed.dayOfMonth.wildcard) {
    return dow;
  }

  if (parsed.dayOfWeek.wildcard) {
    return dom;
  }

  return dom || dow;
}

/**
 * Wie weit in die Zukunft nach dem nächsten Lauf gesucht wird.
 *
 * Vier Jahre decken auch `0 4 29 2 *` (29. Februar) ab. Ohne Obergrenze würde
 * ein formal gültiger, aber unerfüllbarer Ausdruck wie `0 4 30 2 *`
 * (30. Februar) die Suche endlos laufen lassen.
 */
const MAX_LOOKAHEAD_DAYS = 4 * 366;

/**
 * Nächster Zeitpunkt **nach** `after`, auf den der Ausdruck passt.
 *
 * `null`, wenn es innerhalb von vier Jahren keinen gibt – dann ist der Ausdruck
 * zwar formal gültig, aber unerfüllbar (z. B. der 30. Februar).
 *
 * Gesucht wird tageweise und innerhalb eines passenden Tages nur über die
 * tatsächlich erlaubten Stunden und Minuten. Ein unerfüllbarer Ausdruck kostet
 * damit rund 1500 Prüfungen statt zwei Millionen.
 */
export function nextCronRun(expression: string, after: Date): Date | null {
  const parsed = parseCronExpression(expression);
  const day = new Date(after.getFullYear(), after.getMonth(), after.getDate());

  for (let step = 0; step <= MAX_LOOKAHEAD_DAYS; step += 1) {
    if (dayMatches(parsed, day)) {
      for (const hour of parsed.hour.values) {
        for (const minute of parsed.minute.values) {
          const candidate = new Date(
            day.getFullYear(),
            day.getMonth(),
            day.getDate(),
            hour,
            minute,
          );

          // Strikt später: die laufende Minute hat bereits ausgelöst.
          if (candidate.getTime() > after.getTime()) {
            return candidate;
          }
        }
      }
    }

    day.setDate(day.getDate() + 1);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Auswertung in einer IANA-Zeitzone (B3, Reiter „Aufgaben")
// ---------------------------------------------------------------------------
//
// Die Aufgabenliste aus Lastenheft §3.3 speichert je Aufgabe eine Zeitzone: Ein
// „täglicher Neustart um 04:00" soll 04:00 beim Nutzer meinen und nicht 04:00
// beim Backend – und er soll über die Sommerzeitumstellung hinweg um 04:00
// bleiben. Gerechnet wird deshalb im Kalender der Zeitzone; Trefferregeln und
// Zerlegung bleiben dieselben wie oben.

/**
 * Formatierer je Zeitzone.
 *
 * `Intl.DateTimeFormat` anzulegen ist um Größenordnungen teurer als es zu
 * benutzen; die Suche nach dem nächsten Lauf fragt bis zu einige tausend
 * Zeitpunkte ab.
 */
const zoneFormatters = new Map<string, Intl.DateTimeFormat>();

function zoneFormatter(timeZone: string): Intl.DateTimeFormat {
  const vorhanden = zoneFormatters.get(timeZone);

  if (vorhanden !== undefined) {
    return vorhanden;
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    // `hourCycle: 'h23'` statt `hour12: false`: Letzteres liefert je nach
    // Laufzeit „24" für Mitternacht.
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  zoneFormatters.set(timeZone, formatter);

  return formatter;
}

/** Kennt die Laufzeit diese IANA-Zeitzone (z. B. `Europe/Berlin`)? */
export function isSupportedTimeZone(timeZone: string): boolean {
  try {
    zoneFormatter(timeZone);

    return true;
  } catch {
    return false;
  }
}

/**
 * Die Wanduhr einer Zeitzone zu einem Zeitpunkt – als `Date`, dessen
 * **UTC**-Felder die Ortszeit tragen.
 *
 * Damit lässt sich in der Zeitzone rechnen, ohne die Prozess-Zeitzone zu
 * verstellen: Alle Vergleiche unten benutzen die `getUTC…`-Zugriffe.
 */
function zoneWallClock(instant: Date, timeZone: string): Date {
  const parts = zoneFormatter(timeZone).formatToParts(instant);
  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');

  return new Date(
    Date.UTC(
      field('year'),
      field('month') - 1,
      field('day'),
      field('hour'),
      field('minute'),
      field('second'),
    ),
  );
}

/** Abstand zwischen Ortszeit und UTC zu einem Zeitpunkt, in Millisekunden. */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  return zoneWallClock(instant, timeZone).getTime() - instant.getTime();
}

/**
 * Der Zeitpunkt, zu dem die Zeitzone diese Wanduhrzeit zeigt.
 *
 * Zwei Durchläufe, weil der Abstand zur UTC selbst vom Zeitpunkt abhängt: Die
 * erste Schätzung benutzt den Abstand an der Wanduhrzeit, die zweite den am
 * geschätzten Zeitpunkt. Über eine Sommerzeitumstellung hinweg ist erst die
 * zweite richtig.
 *
 * In der übersprungenen Stunde der Frühjahrsumstellung gibt es die Wanduhrzeit
 * nicht; das Ergebnis liegt dann eine Stunde später – die Aufgabe fällt nicht
 * aus, sondern läuft am Ende der Lücke.
 */
function instantForWallClock(wallClockMs: number, timeZone: string): Date {
  let guess = wallClockMs - zoneOffsetMs(new Date(wallClockMs), timeZone);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const corrected = wallClockMs - zoneOffsetMs(new Date(guess), timeZone);

    if (corrected === guess) {
      break;
    }

    guess = corrected;
  }

  return new Date(guess);
}

/** Größter Abstand zweier Zonen-Abstände – Spielraum für die Vorauswahl unten. */
const MAX_ZONE_DRIFT_MS = 3 * 60 * 60 * 1000;

/**
 * Nächster Zeitpunkt **nach** `after`, zu dem der Ausdruck in `timeZone` passt.
 *
 * Gegenstück zu {@link nextCronRun} für Aufgaben mit eigener Zeitzone. `null`,
 * wenn es innerhalb von vier Jahren keinen gibt (unerfüllbarer Ausdruck).
 *
 * @throws {ScheduleError} `SCHEDULE_INVALID_CRON`, wenn der Ausdruck oder die
 *   Zeitzone ungültig ist.
 */
export function nextCronRunInZone(expression: string, after: Date, timeZone: string): Date | null {
  if (!isSupportedTimeZone(timeZone)) {
    fail(`Die Zeitzone „${timeZone}“ ist unbekannt.`);
  }

  const parsed = parseCronExpression(expression);
  const wall = zoneWallClock(after, timeZone);
  const day = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()));

  for (let step = 0; step <= MAX_LOOKAHEAD_DAYS; step += 1) {
    const passtDerTag = dayFieldsMatch(parsed, {
      month: day.getUTCMonth() + 1,
      dayOfMonth: day.getUTCDate(),
      weekday: day.getUTCDay(),
    });

    if (passtDerTag) {
      for (const hour of parsed.hour.values) {
        for (const minute of parsed.minute.values) {
          const candidateWall = Date.UTC(
            day.getUTCFullYear(),
            day.getUTCMonth(),
            day.getUTCDate(),
            hour,
            minute,
          );

          // Vorauswahl ohne Zeitzonen-Rechnung: Wanduhrzeiten, die klar vor
          // `after` liegen, können auch nach Umrechnung nicht später sein.
          if (candidateWall <= wall.getTime() - MAX_ZONE_DRIFT_MS) {
            continue;
          }

          const candidate = instantForWallClock(candidateWall, timeZone);

          // Strikt später: die laufende Minute hat bereits ausgelöst.
          if (candidate.getTime() > after.getTime()) {
            return candidate;
          }
        }
      }
    }

    day.setUTCDate(day.getUTCDate() + 1);
  }

  return null;
}
