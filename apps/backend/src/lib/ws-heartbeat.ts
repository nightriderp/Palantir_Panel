/**
 * Server-seitiges Lebenszeichen einer WebSocket-Verbindung (Audit W2-3,
 * `backend-community-visibility-11`, `backend-community-13`).
 *
 * **Warum serverseitig.** Ein Lebenszeichen, das die Gegenstelle senden muss,
 * erkennt genau den Fall nicht, um den es geht: Eine halboffene Verbindung
 * (Mobilfunk-Abbruch, Proxy-Timeout ohne FIN) meldet sich nicht mehr und feuert
 * auch kein `close`; sie bleibt bis zum TCP-Timeout im jeweiligen Verteiler
 * stehen und bekommt bei jeder Zustellung ihre Kopie.
 *
 * **Der Ablauf** ist der übliche für `ws`: Jeder Takt prüft, ob seit dem letzten
 * Ping ein Pong kam. Fehlt er, wird die Verbindung abgerissen (`terminate()`,
 * nicht `close()` – auf einen Handshake antwortet dort niemand mehr). Eine tote
 * Verbindung ist damit nach höchstens zwei Takten weg.
 *
 * **Warum hier und nicht je Kanal.** Der Chat-Kanal (B7) hatte diesen Zyklus
 * seit W2-3, der Inbox-Kanal (B6) nicht (Fundpunkt 142). Statt die Mechanik ein
 * zweites Mal hinzuschreiben – und damit zwei Auslegungen derselben Regel zu
 * bekommen – liegt sie neben `ws-origin.ts` im gemeinsamen `lib`-Verzeichnis;
 * beide Kanäle rufen dieselbe Funktion.
 */

/** Abstand zweier Server-Pings an einem offenen Live-Kanal. */
export const WS_HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Der Ausschnitt einer echten WebSocket-Verbindung, den das Lebenszeichen
 * braucht.
 *
 * Absichtlich schmaler als `ws.WebSocket`: So lässt sich der Zyklus ohne Netz
 * prüfen (CLAUDE.md §4).
 */
export interface WebSocketHeartbeatSocket {
  /** Sendet einen Ping-Frame; die Gegenstelle antwortet auf Protokollebene. */
  ping(): void;
  /** Reißt die Verbindung ab – ohne Close-Handshake, den es hier nicht mehr gibt. */
  terminate(): void;
  on(event: 'pong', listener: () => void): unknown;
}

export interface WebSocketHeartbeatOptions {
  /** Abstand zweier Pings; Vorgabe {@link WS_HEARTBEAT_INTERVAL_MS}. */
  readonly intervalMs?: number;
}

/**
 * Startet das Lebenszeichen; die Rückgabe beendet den Zyklus.
 *
 * Sie gehört in dieselbe Aufräumfunktion wie die Abmeldung am jeweiligen
 * Verteiler – sonst pingt der Zeitgeber eine längst geschlossene Verbindung
 * weiter.
 */
export function startWebSocketHeartbeat(
  socket: WebSocketHeartbeatSocket,
  options: WebSocketHeartbeatOptions = {},
): () => void {
  const intervalMs = options.intervalMs ?? WS_HEARTBEAT_INTERVAL_MS;

  let lebtNoch = true;

  socket.on('pong', () => {
    lebtNoch = true;
  });

  const timer = setInterval(() => {
    if (!lebtNoch) {
      clearInterval(timer);
      socket.terminate();

      return;
    }

    lebtNoch = false;
    socket.ping();
  }, intervalMs);

  // Der Zeitgeber darf das Beenden des Prozesses nicht aufhalten.
  timer.unref();

  return (): void => {
    clearInterval(timer);
  };
}
