// Statischer Server nur fuer den Mockup-Abgleich (docs/mockup). Kein Produktionscode.
//
// Zwei Punkte aus dem Audit (`infra-images-15`) sind hier behoben:
//
//  1. **Die Praefixpruefung braucht einen Trenner.** `datei.startsWith(wurzel)`
//     vergleicht Zeichenketten, nicht Pfadstufen: `<repo>/docs/mockup-privat`
//     faengt mit `<repo>/docs/mockup` an und galt damit als "innerhalb". Der Weg
//     dorthin fuehrt ueber einen kodierten Schraegstrich - `%2F` ueberlebt die
//     Normalisierung der URL-Klasse und wird erst danach von
//     `decodeURIComponent` zurueckverwandelt, sodass aus `/..%2Fmockup-privat/x`
//     am Ende `<repo>/docs/mockup-privat/x` wird. Verglichen wird deshalb jetzt
//     gegen `wurzel + path.sep`.
//  2. **Gebunden wird auf die Loopback-Adresse.** `listen(4100)` ohne Host
//     lauscht auf allen Schnittstellen; im Buero-WLAN erreicht damit jeder den
//     Ordner. Ein Werkzeug fuer den eigenen Bildschirm hat auf 127.0.0.1 zu
//     lauschen.
//
// Die Bausteine sind einzeln exportiert, damit `serve-mockup.test.mjs` sie
// pruefen kann, ohne den Ordner `docs/mockup` zu brauchen - der liegt laut
// `.gitignore` nur lokal und fehlt in der CI.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Ausgeliefert wird ausschliesslich aus diesem Ordner. */
export const WURZEL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../docs/mockup');

/** Nur der eigene Rechner - siehe Punkt 2 im Kopf. */
export const HOST = '127.0.0.1';
export const PORT = 4100;

/** Wird ohne Pfad angefragt. */
const STARTSEITE = '/Palantir.dc.html';

const TYPEN = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.md': 'text/plain; charset=utf-8',
};

/**
 * Loest einen Anfragepfad auf eine Datei unterhalb der Wurzel auf.
 *
 * @param {string} anfragepfad Der Pfadanteil der URL, noch prozentkodiert.
 * @param {string} wurzel Ordner, aus dem ausgeliefert werden darf.
 * @returns {string | null} Der Dateipfad, oder `null`, wenn das Ziel ausserhalb
 *   der Wurzel liegt oder der Pfad nicht dekodierbar ist.
 */
export function aufloesen(anfragepfad, wurzel = WURZEL) {
  let entpackt;
  try {
    entpackt = decodeURIComponent(anfragepfad);
  } catch {
    // Kaputte Prozentkodierung (`/%`). Frueher stand das Dekodieren vor dem
    // try/catch des Handlers und nahm bei so einer Anfrage den ganzen Prozess
    // mit - eine abgelehnte Anfrage ist die richtige Antwort darauf.
    return null;
  }

  const datei = path.join(wurzel, entpackt === '/' ? STARTSEITE : entpackt);

  // Der Trenner ist das Entscheidende: Ohne ihn genuegt ein Geschwisterordner,
  // dessen Name mit dem Namen der Wurzel beginnt. Die Wurzel selbst bleibt
  // erlaubt (sie ist ein Ordner, `readFile` beantwortet das mit 404).
  if (datei !== wurzel && !datei.startsWith(wurzel + path.sep)) return null;

  return datei;
}

/**
 * Der Server selbst. Ohne `listen` - das uebernimmt `starte`.
 *
 * @param {string} wurzel Ordner, aus dem ausgeliefert werden darf.
 */
export function erzeugeServer(wurzel = WURZEL) {
  return createServer(async (anfrage, antwort) => {
    const datei = aufloesen(new URL(anfrage.url, 'http://x').pathname, wurzel);
    if (datei === null) {
      antwort.writeHead(403).end('forbidden');
      return;
    }
    try {
      const inhalt = await readFile(datei);
      antwort.writeHead(200, {
        'content-type': TYPEN[path.extname(datei)] ?? 'application/octet-stream',
      });
      antwort.end(inhalt);
    } catch {
      antwort.writeHead(404).end('not found');
    }
  });
}

/**
 * Startet den Server. Der Host hat einen Vorgabewert und wird beim Aufruf aus
 * dem Kommandozeilenzweig unten NICHT ueberschrieben - dass dort 127.0.0.1
 * ankommt, prueft der Test ueber `server.address()`.
 */
export function starte(port = PORT, host = HOST, wurzel = WURZEL) {
  return erzeugeServer(wurzel).listen(port, host);
}

// Nur beim direkten Aufruf starten; der Test importiert diese Datei.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  starte().on('listening', () => console.log(`Mockup auf http://${HOST}:${PORT}`));
}
