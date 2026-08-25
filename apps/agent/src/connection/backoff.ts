/**
 * Exponentielles Backoff für den Wiederverbindungsversuch (Pflichtenheft §2.2).
 *
 * Der Agent ist die einzige Seite, die eine Verbindung aufbauen kann – das
 * Backend kann ihn nicht zurückrufen (Pflichtenheft §1, §18). Fällt die
 * Verbindung aus, muss der Agent also selbst nachfassen, aber ohne das Backend
 * bei einer längeren Störung mit Verbindungsversuchen zu überrollen.
 *
 * Der Jitter ist bewusst dabei: ohne ihn würden mehrere Agents (bzw. derselbe
 * Agent nach einem Backend-Neustart) ihre Versuche exakt synchron unternehmen
 * und die Last würde in Wellen statt gleichmäßig ankommen.
 */

export interface BackoffOptions {
  /** Wartezeit vor dem ersten Wiederholungsversuch. */
  readonly initialDelayMs: number;
  /** Obergrenze der Wartezeit, unabhängig von der Anzahl der Versuche. */
  readonly maxDelayMs: number;
  /** Faktor je Versuch (2 = Verdopplung). */
  readonly factor: number;
  /**
   * Zufällige Streuung um die berechnete Wartezeit, als Anteil (0.2 = ±20 %).
   * `0` schaltet den Jitter ab.
   */
  readonly jitterRatio: number;
}

/**
 * Voreinstellung: 1 s, 2 s, 4 s, … bis maximal 60 s, jeweils ±20 %.
 *
 * Die Werte stehen bewusst hier und nicht in der `.env`: sie sind
 * Implementierungsdetail des Verbindungsaufbaus, keine Betriebskonfiguration –
 * für den Betreiber gäbe es keinen sinnvollen Anlass, daran zu drehen.
 */
export const DEFAULT_BACKOFF_OPTIONS: BackoffOptions = {
  initialDelayMs: 1_000,
  maxDelayMs: 60_000,
  factor: 2,
  jitterRatio: 0.2,
};

function assertValidOptions(options: BackoffOptions): void {
  if (options.initialDelayMs <= 0) {
    throw new Error('backoff: initialDelayMs muss größer als 0 sein.');
  }
  if (options.maxDelayMs < options.initialDelayMs) {
    throw new Error('backoff: maxDelayMs darf nicht kleiner als initialDelayMs sein.');
  }
  if (options.factor <= 1) {
    throw new Error('backoff: factor muss größer als 1 sein, sonst wächst die Wartezeit nicht.');
  }
  if (options.jitterRatio < 0 || options.jitterRatio >= 1) {
    throw new Error('backoff: jitterRatio muss im Bereich [0, 1) liegen.');
  }
}

export class ExponentialBackoff {
  private readonly options: BackoffOptions;
  private readonly random: () => number;
  private attempts = 0;

  /**
   * @param options Abweichungen von {@link DEFAULT_BACKOFF_OPTIONS}.
   * @param random Zufallsquelle für den Jitter – in Tests durch eine
   *   deterministische Funktion ersetzbar.
   */
  constructor(options: Partial<BackoffOptions> = {}, random: () => number = Math.random) {
    this.options = { ...DEFAULT_BACKOFF_OPTIONS, ...options };
    assertValidOptions(this.options);
    this.random = random;
  }

  /** Anzahl der bisher über {@link nextDelayMs} vergebenen Wartezeiten. */
  get attempt(): number {
    return this.attempts;
  }

  /**
   * Wartezeit für den nächsten Versuch; erhöht den Versuchszähler.
   *
   * Die Obergrenze greift auf der Wartezeit *vor* dem Jitter, damit der Jitter
   * nach oben wie nach unten gleich wirkt.
   */
  nextDelayMs(): number {
    const base = Math.min(
      this.options.initialDelayMs * Math.pow(this.options.factor, this.attempts),
      this.options.maxDelayMs,
    );
    this.attempts += 1;

    if (this.options.jitterRatio === 0) {
      return Math.round(base);
    }

    // random() liegt in [0, 1) -> Streuung in [-jitterRatio, +jitterRatio).
    const deviation = (this.random() * 2 - 1) * this.options.jitterRatio;
    return Math.max(0, Math.round(base * (1 + deviation)));
  }

  /**
   * Zurücksetzen nach einer erfolgreichen Verbindung.
   *
   * Bewusst erst nach dem **abgeschlossenen Handshake** aufzurufen, nicht schon
   * beim geöffneten Socket: Ein Backend, das die Verbindung annimmt und sofort
   * wieder schließt (z. B. bei falschem Token), würde sonst eine Schleife ohne
   * jede Wartezeit auslösen.
   */
  reset(): void {
    this.attempts = 0;
  }
}
