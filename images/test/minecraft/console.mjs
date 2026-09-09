/**
 * Konsolen-Anschluss des Test-Servers (WORK_STATUS.md, Gefundener Punkt 113).
 *
 * `EXEC_CONSOLE` startet im Container einen Befehl **ohne Shell und ohne
 * Standardeingabe** (siehe `images/README.md`). Ein Spielserver braucht dafür
 * ein Werkzeug, das einen Befehl entgegennimmt, ihn an den laufenden Prozess
 * gibt und dessen Antwort ausgibt – bei echten Servern ein RCON-Client, hier
 * der Steuerport aus `server.mjs`.
 *
 * Aufruf: `palantir-console players 3`
 *
 * **Exit-Codes** (Fundpunkt infra-images-20): 0 nur, wenn der Server den Befehl
 * angenommen hat; 1 bei abgelehntem Befehl, ausbleibender oder unerreichbarer
 * Antwort; 2, wenn gar kein Befehl übergeben wurde. Vorher endete auch ein
 * abgelehnter Befehl mit 0 – wer den Code auswertet, hielt ihn für gelungen.
 */

import net from 'node:net';

const befehl = process.argv.slice(2).join(' ').trim();

if (befehl.length === 0) {
  console.error('Aufruf: palantir-console <befehl>. "help" zeigt die Liste.');
  process.exit(2);
}

const socket = net.createConnection(
  { host: '127.0.0.1', port: Number(process.env.CONTROL_PORT ?? 25575) },
  () => socket.write(`${befehl}\n`),
);

let antwort = '';

socket.setTimeout(5000);
socket.on('data', (teil) => {
  antwort += teil.toString('utf8');
});
socket.on('timeout', () => {
  console.error('Der Server antwortet nicht auf dem Steuerport.');
  socket.destroy();
  process.exit(1);
});
socket.on('error', (fehler) => {
  console.error(`Steuerport nicht erreichbar: ${fehler.message}`);
  process.exit(1);
});

/**
 * Trennt die Marke des Steuerports (`OK ` / `FEHLER `) vom Text.
 *
 * Ausgegeben wird nur der Text – die Panel-Konsole sieht also dieselbe Meldung
 * wie bisher. Fehlt die Marke, stammt die Antwort von einem älteren Server;
 * dann bleibt es beim bisherigen Verhalten (Text durchreichen, Exit 0).
 */
function werteAntwortAus(roh) {
  if (roh.startsWith('FEHLER ')) return { code: 1, text: roh.slice('FEHLER '.length) };
  if (roh.startsWith('OK ')) return { code: 0, text: roh.slice('OK '.length) };

  return { code: 0, text: roh };
}

socket.on('close', () => {
  if (antwort.length === 0) {
    // Verbindung stand, aber der Server hat nichts geschickt: kein Erfolg.
    process.stdout.write('Keine Antwort.\n');
    process.exitCode = 1;

    return;
  }

  const { code, text } = werteAntwortAus(antwort);

  // `process.exitCode` statt `process.exit()`: So wird die Ausgabe noch
  // vollständig geschrieben, bevor der Prozess endet.
  process.stdout.write(text);
  process.exitCode = code;
});
