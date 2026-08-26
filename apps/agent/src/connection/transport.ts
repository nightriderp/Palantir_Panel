/**
 * Abstraktion der eigentlichen Übertragung (Pflichtenheft §2.5, analog zur
 * `ContainerRuntime` in A2).
 *
 * `AgentConnection` kennt nur diese Schnittstelle und keinen WebSocket. Damit
 * lassen sich Handshake, Reconnect-Verhalten und Deduplizierung mit einem
 * Testdouble prüfen, ohne einen echten Server – und ohne Auth-Bypass, denn das
 * Token gehört in die Transport-Implementierung, nicht in die Protokolllogik.
 */

/** Rückmeldungen der Übertragung an die Verbindungslogik. */
export interface TransportHandlers {
  /** Verbindung steht (WebSocket offen). Der Handshake beginnt erst jetzt. */
  onOpen(): void;
  /** Eine vollständige Textnachricht ist eingegangen (noch ungeprüft). */
  onMessage(raw: string): void;
  /** Verbindung ist beendet – aus welchem Grund auch immer. Genau einmal je Verbindung. */
  onClose(info: TransportCloseInfo): void;
  /**
   * Fehler auf der Übertragung. Ein `onClose` folgt in aller Regel; die
   * Verbindungslogik plant den Reconnect deshalb ausschließlich in `onClose`.
   */
  onError(error: Error): void;
}

export interface TransportCloseInfo {
  /** WebSocket-Close-Code, oder `0`, wenn die Verbindung nie zustande kam. */
  readonly code: number;
  readonly reason: string;
  /**
   * `true`, wenn das Backend die Verbindung wegen fehlender/falscher
   * Authentifizierung abgelehnt hat (HTTP 401/403 beim Handshake oder
   * Close-Code 4401). Wird nur geloggt – ein Reconnect findet trotzdem statt,
   * damit ein nachträglich korrigiertes Token ohne Neustart greift.
   */
  readonly unauthorized: boolean;
}

export interface Transport {
  /** Nachricht senden. Wirft nicht; Fehler landen in `onError`. */
  send(raw: string): void;
  /** Verbindung von sich aus beenden. `onClose` folgt. */
  close(code?: number, reason?: string): void;
}

/**
 * Erzeugt genau eine Verbindung. Für jeden Wiederverbindungsversuch ruft
 * `AgentConnection` die Factory erneut auf.
 */
export type TransportFactory = (handlers: TransportHandlers) => Transport;
