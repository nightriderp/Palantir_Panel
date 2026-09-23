/**
 * Schmaler Client für die Discord-REST-API (Pflichtenheft §14a.1).
 *
 * Bewusst kein `discord.js`: Der Bot braucht eine Handvoll Aufrufe, und eine
 * Bibliothek dieser Größe für sie wäre nicht zu rechtfertigen
 * (Entwicklungsregeln §1). Was eine Bibliothek sonst mitbrächte und hier nicht
 * fehlen darf, ist der Umgang mit den Rate-Limits:
 *
 * - **Je Route nacheinander.** Discord begrenzt je Route (genauer: je Bucket).
 *   Aufrufe derselben Route laufen deshalb hintereinander, verschiedene Routen
 *   parallel. Der Schlüssel ist Methode + Pfad mit ausgeblendeten Kennungen
 *   außer der ersten Ebene – dieselbe Näherung, die Discord dokumentiert
 *   (Kanal- und Guild-Id sind „major parameters" und trennen die Buckets).
 * - **Bucket leer: warten.** Meldet eine Antwort `X-RateLimit-Remaining: 0`,
 *   wartet der nächste Aufruf derselben Route `X-RateLimit-Reset-After`.
 * - **429: warten und wiederholen**, höchstens {@link MAX_RETRIES}-mal, mit
 *   dem `retry_after` aus der Antwort.
 */

export const DISCORD_API_BASE = 'https://discord.com/api/v10';

/** Discord verlangt einen User-Agent dieser Form von Bots. */
const USER_AGENT = 'DiscordBot (https://github.com/nightriderp/Palantir_Panel, 1)';

export const MAX_RETRIES = 3;

/** Obergrenze einer einzelnen Wartezeit – schützt vor einem absurden `retry_after`. */
const MAX_WAIT_MS = 60_000;

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    /** Discords eigener Fehlercode aus dem Antwortkörper, z. B. 50007. */
    readonly discordCode: number | null,
    message: string,
  ) {
    super(message);
    this.name = 'DiscordApiError';
  }
}

export interface DiscordRestClient {
  request<T = unknown>(method: string, path: string, body?: unknown): Promise<T>;
}

export interface DiscordRestOptions {
  readonly botToken: string;
  /** Austauschbar für Tests; Vorgabe ist das eingebaute `fetch`. */
  readonly fetch?: typeof fetch;
  /** Austauschbar für Tests. */
  readonly sleep?: (ms: number) => Promise<void>;
  /** Frist eines einzelnen Aufrufs. */
  readonly timeoutMs?: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Bucket-Schlüssel eines Pfads: Kennungen nach der ersten Ebene werden zu `:id`.
 * `/channels/123/messages/456` → `/channels/123/messages/:id`.
 */
export function routeKey(method: string, path: string): string {
  const teile = path.split('?')[0]?.split('/') ?? [];
  const normalisiert = teile.map((teil, index) => (index > 2 && /^\d+$/.test(teil) ? ':id' : teil));

  return `${method.toUpperCase()} ${normalisiert.join('/')}`;
}

function waitFromHeaders(headers: Headers): number {
  if (headers.get('x-ratelimit-remaining') !== '0') {
    return 0;
  }

  const resetAfter = Number(headers.get('x-ratelimit-reset-after'));

  return Number.isFinite(resetAfter) && resetAfter > 0
    ? Math.min(resetAfter * 1000, MAX_WAIT_MS)
    : 0;
}

export function createDiscordRestClient(options: DiscordRestOptions): DiscordRestClient {
  const doFetch = options.fetch ?? fetch;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? 10_000;
  /** Letzter Aufruf je Route – der nächste hängt sich dahinter. */
  const queues = new Map<string, Promise<unknown>>();
  /** Wartezeit, die die letzte Antwort einer Route verlangt hat. */
  const pendingWait = new Map<string, number>();

  async function execute<T>(key: string, method: string, path: string, body: unknown): Promise<T> {
    const wait = pendingWait.get(key) ?? 0;

    if (wait > 0) {
      pendingWait.delete(key);
      await sleep(wait);
    }

    for (let versuch = 0; ; versuch += 1) {
      const response = await doFetch(`${DISCORD_API_BASE}${path}`, {
        method,
        headers: {
          Authorization: `Bot ${options.botToken}`,
          'User-Agent': USER_AGENT,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(timeoutMs),
      });

      const nachher = waitFromHeaders(response.headers);

      if (nachher > 0) {
        pendingWait.set(key, nachher);
      }

      if (response.status === 429 && versuch < MAX_RETRIES) {
        const daten = (await response.json().catch(() => ({}))) as { retry_after?: number };
        const retryAfter = typeof daten.retry_after === 'number' ? daten.retry_after : 1;

        await sleep(Math.min(retryAfter * 1000, MAX_WAIT_MS));
        continue;
      }

      if (response.status === 204) {
        return undefined as T;
      }

      const text = await response.text();
      const daten: unknown = text.length > 0 ? JSON.parse(text) : null;

      if (!response.ok) {
        const fehler = (daten ?? {}) as { code?: number; message?: string };

        throw new DiscordApiError(
          response.status,
          typeof fehler.code === 'number' ? fehler.code : null,
          `Discord ${method} ${path}: ${response.status} ${fehler.message ?? ''}`.trim(),
        );
      }

      return daten as T;
    }
  }

  return {
    request<T>(method: string, path: string, body?: unknown): Promise<T> {
      const key = routeKey(method, path);
      const vorher = queues.get(key) ?? Promise.resolve();
      // Ein gescheiterter Vorgänger darf die Schlange nicht blockieren.
      const lauf = vorher.catch(() => undefined).then(() => execute<T>(key, method, path, body));

      queues.set(key, lauf);
      lauf
        .finally(() => {
          if (queues.get(key) === lauf) queues.delete(key);
        })
        .catch(() => undefined);

      return lauf;
    },
  };
}
