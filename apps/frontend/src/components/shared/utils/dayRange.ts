/**
 * Tagesgrenzen eines `DateField`-Wertes (Audit-Fundstelle frontend-lib-07,
 * Fundpunkt 139).
 *
 * Ein `DateField` liefert `JJJJ-MM-TT` – einen **Kalendertag**, wie ihn der
 * Nutzer vor sich sieht. Das Backend rechnet dagegen in ISO-Zeitstempeln. Wer
 * einfach `Z` anhängt, legt die Grenze nach UTC: Ein Admin in Berlin (CEST),
 * der auf „Ab 01.09. Bis 01.09." filtert, bekommt die Einträge zwischen 00:00
 * und 02:00 Uhr des 1.9. nicht zu sehen, dafür die des 2.9. bis 02:00 Uhr.
 * Deshalb wird die Grenze hier **lokal** gebildet und erst danach nach UTC
 * umgerechnet.
 *
 * **Warum an gemeinsamer Stelle:** Die Helfer entstanden in `AuditLogView` und
 * wurden von dort exportiert; die Ankündigungen hatten daneben denselben Fehler
 * ein zweites Mal (`…T23:59:59.999Z` von Hand). Eine Ansicht ist kein Ort für
 * einen Baustein, den zwei Ansichten brauchen – deshalb hier im Design-System,
 * gleich neben `DateField` und den Datumsformaten (Fundpunkt 139).
 *
 * Reine Funktionen ohne React, direkt getestet in `dayRange.test.ts`.
 */

/**
 * Grenze eines `JJJJ-MM-TT`-Datums als ISO-Zeitstempel, gebildet in der
 * Zeitzone des Browsers.
 *
 * Ein Datum, das sich nicht lesen lässt, kommt unverändert zurück: Der Aufrufer
 * gibt es dann so weiter, wie der Nutzer es getippt hat, statt eine erfundene
 * Grenze zu schicken.
 */
function dayBoundaryIso(
  date: string,
  hours: number,
  minutes: number,
  seconds: number,
  milliseconds: number,
): string {
  const [year, month, day] = date.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) return date;

  const local = new Date(year, month - 1, day, hours, minutes, seconds, milliseconds);
  if (Number.isNaN(local.getTime())) return date;

  return local.toISOString();
}

/** Beginn eines Tages als ISO-Zeitstempel (Filter „ab"), lokale Zeitzone. */
export function startOfDayIso(date: string): string {
  return dayBoundaryIso(date, 0, 0, 0, 0);
}

/** Ende eines Tages als ISO-Zeitstempel (Filter „bis", einschließlich), lokal. */
export function endOfDayIso(date: string): string {
  return dayBoundaryIso(date, 23, 59, 59, 999);
}

/**
 * Rückweg: ISO-Zeitstempel als `JJJJ-MM-TT` für ein `DateField` – ebenfalls in
 * der Zeitzone des Browsers.
 *
 * Die Gegenrichtung gehört zwingend dazu (Fundpunkt 139). Wer den Zeitstempel
 * einfach abschneidet (`iso.slice(0, 10)`), liest den **UTC**-Tag: Ein mit
 * `endOfDayIso` gebildetes Ablaufdatum vom 1.9. steht in New York als
 * `2026-09-02T03:59:59.999Z` in der Datenbank – abgeschnitten käme der 2.9.
 * heraus, und schon das bloße Öffnen und Speichern eines Formulars schöbe das
 * Datum um einen Tag nach hinten.
 *
 * Ohne Angabe oder bei einem unlesbaren Zeitstempel bleibt das Feld leer.
 */
export function dayInputFromIso(iso: string | null | undefined): string {
  if (!iso) return '';

  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const jahr = String(date.getFullYear()).padStart(4, '0');
  const monat = String(date.getMonth() + 1).padStart(2, '0');
  const tag = String(date.getDate()).padStart(2, '0');

  return `${jahr}-${monat}-${tag}`;
}
