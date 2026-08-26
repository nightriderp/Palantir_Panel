/**
 * IP-basiertes Rate-Limiting auf Registrierung und Login (Pflichtenheft §7, §18).
 *
 * Gleitendes Zeitfenster im Arbeitsspeicher: je Schlüssel (Vorgang + IP) werden
 * die Zeitstempel der Versuche gehalten und beim Zugriff auf das Fenster
 * beschnitten.
 *
 * Bewusst ohne zusätzliche Abhängigkeit und ohne Datenbank/Redis (CLAUDE.md §1):
 * Palantir läuft als eine Backend-Instanz auf einer VPS (Pflichtenheft §1), ein
 * geteilter Zähler bringt dort nichts. Sollte das Backend später mehrfach
 * laufen, wird diese Datei ausgetauscht – die Schnittstelle
 * {@link RateLimiter} bleibt.
 *
 * Kennt weder HTTP noch Datenbank und ist damit ohne Infrastruktur testbar
 * (CLAUDE.md §4); die Uhrzeit kommt von außen.
 */

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Verbleibende Versuche im laufenden Fenster. */
  readonly remaining: number;
  /** Sekunden bis zum nächsten erlaubten Versuch; `0`, wenn erlaubt. */
  readonly retryAfterSeconds: number;
}

export interface RateLimiter {
  /** Zählt einen Versuch und entscheidet, ob er ausgeführt werden darf. */
  consume(key: string, nowMs?: number): RateLimitDecision;
  /**
   * Setzt den Zähler eines Schlüssels zurück – nach einem erfolgreichen Login,
   * damit ein Nutzer, der sich einmal vertippt hat, nicht in sein eigenes Limit
   * läuft.
   */
  reset(key: string): void;
  /** Entfernt abgelaufene Einträge; verhindert unbegrenztes Wachstum. */
  sweep(nowMs?: number): void;
}

export interface RateLimiterOptions {
  readonly windowSeconds: number;
  readonly maxAttempts: number;
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const windowMs = options.windowSeconds * 1000;
  const attempts = new Map<string, number[]>();

  function recent(key: string, nowMs: number): number[] {
    const cutoff = nowMs - windowMs;
    const kept = (attempts.get(key) ?? []).filter((timestamp) => timestamp > cutoff);

    if (kept.length > 0) {
      attempts.set(key, kept);
    } else {
      attempts.delete(key);
    }

    return kept;
  }

  return {
    consume(key, nowMs = Date.now()) {
      const timestamps = recent(key, nowMs);

      const oldest = timestamps[0];

      if (oldest !== undefined && timestamps.length >= options.maxAttempts) {
        // Frei wird der nächste Versuch, sobald der älteste aus dem Fenster fällt.
        const retryAfterSeconds = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));

        return { allowed: false, remaining: 0, retryAfterSeconds };
      }

      timestamps.push(nowMs);
      attempts.set(key, timestamps);

      return {
        allowed: true,
        remaining: options.maxAttempts - timestamps.length,
        retryAfterSeconds: 0,
      };
    },

    reset(key) {
      attempts.delete(key);
    },

    sweep(nowMs = Date.now()) {
      for (const key of [...attempts.keys()]) {
        recent(key, nowMs);
      }
    },
  };
}

/**
 * Schlüssel eines Zählers.
 *
 * Der Vorgang steht mit im Schlüssel, damit fehlgeschlagene Logins nicht das
 * Kontingent für Registrierungen aufbrauchen.
 */
export function rateLimitKey(scope: string, ip: string): string {
  return `${scope}:${ip}`;
}
