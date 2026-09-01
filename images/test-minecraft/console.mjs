/**
 * Konsolen-Anschluss des Test-Servers (WORK_STATUS.md, Gefundener Punkt 113).
 *
 * `EXEC_CONSOLE` startet im Container einen Befehl **ohne Shell und ohne
 * Standardeingabe** (siehe SPIEL_IMAGES.md §3). Ein Spielserver braucht dafür
 * ein Werkzeug, das einen Befehl entgegennimmt, ihn an den laufenden Prozess
 * gibt und dessen Antwort ausgibt – bei echten Servern ein RCON-Client, hier
 * der Steuerport aus `server.mjs`.
 *
 * Aufruf: `palantir-console players 3`
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
socket.on('close', () => {
  process.stdout.write(antwort.length > 0 ? antwort : 'Keine Antwort.\n');
});
