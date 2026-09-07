/**
 * `Content-Disposition`-Kopfzeile für Downloads (RFC 6266 mit der Kodierung aus
 * RFC 5987) – Audit W2-9, `orchestration-features-07`.
 *
 * Vorher setzte der Datei-Download den Namen roh in die Kopfzeile und entfernte
 * lediglich Anführungszeichen. Eine Datei mit Steuerzeichen im Namen –
 * `welt\r\nx.txt` lässt sich hochladen und entsteht auch im Spiel selbst –
 * brachte damit Node dazu, den Kopfzeilenwert abzulehnen: Die Antwort endete
 * als `INTERNAL_ERROR` (500), die Datei war über das Panel nicht mehr
 * erreichbar. Umlaute wiederum kamen als Buchstabensalat beim Browser an, weil
 * `filename=` ausschließlich Latin-1 trägt.
 *
 * Die Kopfzeile trägt deshalb beides:
 *  - `filename="..."`  – reiner ASCII-Rückfall für alte Clients,
 *  - `filename*=UTF-8''...` – der vollständige Name, prozentkodiert.
 * Clients, die beides verstehen, bevorzugen laut RFC 6266 den zweiten Wert.
 */

/**
 * Prozentkodierung nach RFC 5987 (`ext-value`).
 *
 * `encodeURIComponent` lässt `'`, `(`, `)` und `*` stehen; die zählen nicht zu
 * den erlaubten `attr-char` und werden deshalb nachträglich kodiert. Mehr zu
 * kodieren als nötig ist erlaubt, weniger nicht.
 */
function encodeExtendedValue(name: string): string {
  return encodeURIComponent(name).replace(
    /['()*]/g,
    (zeichen) => `%${zeichen.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * ASCII-Rückfall: druckbare Zeichen bleiben, alles andere wird zu `_`.
 *
 * Ersetzt statt entfernt – `bild(1).png` und `bild1.png` sollen nicht denselben
 * Rückfallnamen bekommen. Anführungszeichen und Backslash fallen mit heraus,
 * sonst bräche der Wert aus seinen eigenen Anführungszeichen aus.
 */
function asciiFallback(name: string): string {
  const gesaeubert = [...name]
    .map((zeichen) => {
      const punkt = zeichen.codePointAt(0) ?? 0;
      const druckbar = punkt >= 0x20 && punkt <= 0x7e;

      return druckbar && zeichen !== '"' && zeichen !== '\\' ? zeichen : '_';
    })
    .join('');

  // Ein Name aus lauter Nicht-ASCII (`世界.txt`) ergäbe sonst `___.txt` – das
  // ist in Ordnung; ein leerer Name dagegen wäre ein ungültiger Kopfzeilenwert.
  return gesaeubert.length > 0 ? gesaeubert : 'download';
}

/**
 * Baut den Wert der `Content-Disposition`-Kopfzeile für einen Anhang.
 *
 * Der zurückgegebene Wert enthält garantiert keine Steuerzeichen und ist damit
 * für Node ein gültiger Kopfzeilenwert – unabhängig davon, was im Dateinamen
 * steht.
 */
export function attachmentContentDisposition(fileName: string): string {
  return `attachment; filename="${asciiFallback(fileName)}"; filename*=UTF-8''${encodeExtendedValue(fileName)}`;
}
