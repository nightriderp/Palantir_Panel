import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

/**
 * Zentrale `.env` im Repo-Root (Pflichtenheft §12.1): dieselbe Datei wird auf
 * VPS und Homeserver eingesetzt, jede Komponente liest nur die für sie
 * relevanten Variablen. Hier werden daher ausschließlich die Variablen
 * geprüft, die das Backend zum Start benötigt.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
loadDotenv({ path: path.join(repoRoot, '.env') });

/**
 * Optionaler Wert, bei dem eine **leere** Variable als „nicht gesetzt" gilt.
 *
 * `.env.example` führt jede Variable auf, auch die optionalen – die stehen dort
 * mit leerem Wert (`CLOUDFLARE_API_TOKEN=`). Ohne diese Umsetzung wäre eine aus
 * der Vorlage erzeugte `.env` ungültig, sobald eine optionale Variable
 * unausgefüllt bleibt, und genau das ist der Normalfall.
 */
const optionalEnvString = (): z.ZodType<string | undefined> =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim().length === 0 ? undefined : value));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_HOST: z.string().default('0.0.0.0'),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Verbindungs-URL für PostgreSQL (Pflichtenheft §3, .env.example Abschnitt 3).
   *
   * Bewusst optional: das Backend startet aktuell noch ohne Datenbank, weil
   * noch kein fachliches Modul sie am Request-Pfad braucht. Der Datenbank-
   * Client (`src/db/client.ts`) bricht beim ersten Zugriff mit einer
   * verständlichen Meldung ab, wenn der Wert fehlt. Sobald das erste Modul
   * die Datenbank benötigt, wird der Wert hier auf Pflicht hochgestuft.
   */
  DATABASE_URL: optionalEnvString(),

  // -- Server-Orchestrierung (B3, Pflichtenheft §2.2, §9, §11, §13) -----------
  // `PALANTIR_DOMAIN` steht weiter unten bei B1 – dieselbe Variable, hier als
  // Basis der Gameserver-Subdomains (§13) benutzt.

  /** Öffentliche IPv4 der VPS – Ziel der `A`-Einträge (§13). */
  VPS_PUBLIC_IP: z.string().min(1).default('127.0.0.1'),
  /** Interne Tunnel-Adresse des Homeservers – Ziel des Health-Checks (§2.1, §9). */
  WIREGUARD_HOME_IP: z.string().min(1).default('10.10.0.2'),

  /**
   * Pre-Shared-Token des Agents (§2.2).
   *
   * Bewusst optional: Das Backend startet auch ohne. Der WebSocket-Endpunkt
   * `/agent` lehnt dann aber **jede** Verbindung ab – ein offener Agent-Kanal
   * wäre vollständiger Zugriff auf den Homeserver (§18).
   */
  AGENT_TOKEN: optionalEnvString(),
  /** Frist, in der ein Agent-Befehl beantwortet sein muss (§5.3). */
  AGENT_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),

  /** DNS-Automatisierung über Cloudflare (§13); ohne beide Werte passiert nichts. */
  CLOUDFLARE_API_TOKEN: optionalEnvString(),
  CLOUDFLARE_ZONE_ID: optionalEnvString(),

  /** Öffentlicher Portbereich für Gameserver (§2.4). */
  GAME_PORT_RANGE_START: z.coerce.number().int().min(1).max(65_535).default(27_000),
  GAME_PORT_RANGE_END: z.coerce.number().int().min(1).max(65_535).default(27_999),
  /** Hostname des Hostname-Routing-Proxys – Ziel der `CNAME`-Einträge (§2.4, §13). */
  GAME_ROUTER_HOSTNAME: optionalEnvString(),
  /** Einzelner öffentlicher Port für Spiele mit Hostname-Routing (§2.4). */
  MINECRAFT_ROUTER_PORT: z.coerce.number().int().min(1).max(65_535).default(25_565),

  /** Crash-Loop-Schutz: erlaubte automatische Neustarts im Zeitfenster (§9). */
  CRASH_LOOP_MAX_RESTARTS: z.coerce.number().int().min(0).max(50).default(3),
  CRASH_LOOP_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1_440).default(10),

  /** Health-Check beim Start (§9): Abstand und Frist eines einzelnen Versuchs. */
  HEALTH_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(3_000),
  HEALTH_CHECK_ATTEMPT_TIMEOUT_MS: z.coerce.number().int().positive().default(3_000),

  /** Vorgabewerte des Auto-Shutdown für neue Server (§9). */
  AUTO_SHUTDOWN_DEFAULT_IDLE_MINUTES: z.coerce.number().int().min(1).max(1_440).default(30),
  AUTO_SHUTDOWN_DEFAULT_GRACE_MINUTES: z.coerce.number().int().min(0).max(1_440).default(15),

  /**
   * Ausbaustufe der Installation (Lastenheft §3.5).
   *
   * Steuert, welche Spiele-Definitionen auswählbar sind. Phase 1 = nur der
   * Test-Typ.
   */
  INSTALLATION_PHASE: z.coerce
    .number()
    .int()
    .min(1)
    .max(3)
    .default(1)
    .transform((value) => value as 1 | 2 | 3),

  /**
   * Schwellwerte der Ressourcen-Warnungen (Pflichtenheft §10, Event
   * `resource.low`; .env.example Abschnitt 13).
   *
   * `RESOURCE_WARN_NODE_PERCENT` misst die Auslastung der Ziel-VM,
   * `RESOURCE_WARN_SERVER_PERCENT` den Verbrauch eines einzelnen Servers gegen
   * sein eigenes Limit. Beide bewusst getrennt: eine Node darf länger gut
   * gefüllt laufen, ein einzelner Server nahe an seinem RAM-Limit ist dagegen
   * kurz vor dem Absturz.
   */
  RESOURCE_WARN_NODE_PERCENT: z.coerce.number().min(1).max(100).default(85),
  RESOURCE_WARN_SERVER_PERCENT: z.coerce.number().min(1).max(100).default(90),

  /**
   * Ablageort der Audit-Log-Archive auf der VPS (Pflichtenheft §6,
   * .env.example Abschnitt 14).
   *
   * Der Archivierungsprozess exportiert Einträge älter als 24 Monate dorthin,
   * bevor er sie aus der aktiven Tabelle entfernt. Ohne gesetzten Wert läuft
   * das Backend normal weiter, der Archivierungslauf lehnt aber ab: Ein
   * unklarer Ablageort für Sicherheitsprotokolle ist schlechter als gar keine
   * Archivierung.
   */
  AUDIT_ARCHIVE_DIR: z.string().min(1).optional(),
  // -- Auth & Identity (Arbeitspaket B1, Pflichtenheft §7) --------------------
  // Alle Werte kommen aus derselben zentralen `.env` (Pflichtenheft §12.1).
  // Die Geheimnisse sind bewusst **optional** typisiert, aber praktisch Pflicht:
  // `requireAuthSecrets()` unten bricht beim Start des Auth-Moduls mit einer
  // verständlichen Meldung ab, wenn eines fehlt. So bleibt das Backend für
  // Tests und den Health-Endpunkt startbar, ohne dass irgendwo ein Standardwert
  // eingebaut wäre – ein hartkodiertes Fallback-Secret wäre eine Hintertür
  // (CLAUDE.md §2).

  /** Signaturschlüssel des kurzlebigen Access-JWT (HS256). */
  JWT_SECRET: z.string().min(1).optional(),
  /** Lebensdauer des Access-Tokens, z. B. `15m`. */
  JWT_ACCESS_TOKEN_TTL: z.string().min(1).default('15m'),
  /** Lebensdauer des opaken Refresh-Tokens, z. B. `30d`. */
  REFRESH_TOKEN_TTL: z.string().min(1).default('30d'),
  /**
   * Lebensdauer des 2FA-Zwischen-Tokens zwischen erstem und zweitem
   * Anmeldeschritt (Pflichtenheft §7). Kurz gehalten: er ersetzt nur die
   * bereits geprüften Zugangsdaten, bis der Code eingegeben ist.
   */
  TWO_FACTOR_TOKEN_TTL: z.string().min(1).default('5m'),
  /** Schlüssel, mit dem das OAuth-`state`-Cookie signiert wird. */
  CSRF_SECRET: z.string().min(1).optional(),
  /** Cookie-Domain der Sitzungs-Cookies; leer = Host des Requests. */
  COOKIE_DOMAIN: z.string().optional(),
  /**
   * `Secure`-Flag der Sitzungs-Cookies (Pflichtenheft §7).
   *
   * Standard `true`. Ausschließlich für lokale Entwicklung ohne TLS auf `false`
   * zu setzen – über HTTP schickt der Browser ein `Secure`-Cookie sonst nie.
   * Bewusst als Variable statt als stille Abhängigkeit von `NODE_ENV`, damit im
   * Betrieb sichtbar bleibt, was gilt.
   */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /** Öffentliche Adresse des Frontends – Ziel des Rücksprungs nach OAuth. */
  PUBLIC_WEB_URL: z.string().url().optional(),
  /** Basis-Domain; dient dem Authenticator als Aussteller-Bezeichnung. */
  PALANTIR_DOMAIN: z.string().min(1).default('palantir.local'),

  /** HMAC-Schlüssel der ALTCHA-Challenges (Pflichtenheft §7). */
  ALTCHA_HMAC_KEY: z.string().min(1).optional(),
  /** Obere Grenze der Zufallszahl – höher bedeutet mehr Rechenaufwand. */
  ALTCHA_COMPLEXITY: z.coerce.number().int().positive().default(100000),
  /** Gültigkeitsdauer einer Challenge in Sekunden. */
  ALTCHA_EXPIRY_SECONDS: z.coerce.number().int().positive().default(300),

  /**
   * IP-basiertes Rate-Limit auf Registrierung und Login (Pflichtenheft §7, §18).
   * Neu in B1 und in `.env.example` Abschnitt 4 dokumentiert.
   */
  AUTH_RATE_LIMIT_WINDOW_SECONDS: z.coerce.number().int().positive().default(900),
  AUTH_RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  AUTH_RATE_LIMIT_REGISTER_MAX: z.coerce.number().int().positive().default(5),

  // Identitätsanbieter (Pflichtenheft §7 – minimale Scopes). Fehlt ein Wert,
  // bietet die Instanz diesen Weg nicht an (`AUTH_PROVIDER_NOT_CONFIGURED`).
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  DISCORD_REDIRECT_URI: z.string().optional(),
  TWITCH_CLIENT_ID: z.string().optional(),
  TWITCH_CLIENT_SECRET: z.string().optional(),
  TWITCH_REDIRECT_URI: z.string().optional(),
  STEAM_API_KEY: z.string().optional(),
  STEAM_RETURN_URL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Ungültige Umgebungskonfiguration für das Backend:\n${details}`);
}

export const env = parsed.data;
export type Env = typeof env;

/** Geheimnisse, ohne die das Auth-Modul nicht arbeiten kann. */
export interface AuthSecrets {
  readonly jwtSecret: string;
  readonly csrfSecret: string;
  readonly altchaHmacKey: string;
}

/**
 * Liefert die Auth-Geheimnisse oder bricht mit einer verständlichen Meldung ab
 * (Pflichtenheft §12.1, CLAUDE.md §2: keine Secrets im Code, keine Standardwerte
 * für Geheimnisse).
 *
 * Wird beim Registrieren des Auth-Moduls aufgerufen, nicht beim Import – so
 * bleibt das Backend ohne Auth-Modul (Tests, Health-Endpunkt) startbar.
 */
export function requireAuthSecrets(): AuthSecrets {
  const missing = (
    [
      ['JWT_SECRET', env.JWT_SECRET],
      ['CSRF_SECRET', env.CSRF_SECRET],
      ['ALTCHA_HMAC_KEY', env.ALTCHA_HMAC_KEY],
    ] as const
  )
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `Auth-Modul: ${missing.join(', ')} fehlt/fehlen in der zentralen .env im Repo-Root. ` +
        'Werte erzeugt scripts/setup.sh (siehe .env.example Abschnitt 4 und 6).',
    );
  }

  return {
    // Non-null-Assertions sind hier durch die Prüfung oben abgedeckt.
    jwtSecret: env.JWT_SECRET as string,
    csrfSecret: env.CSRF_SECRET as string,
    altchaHmacKey: env.ALTCHA_HMAC_KEY as string,
  };
}
