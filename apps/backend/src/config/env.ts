import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';
import {
  type SourceAllowlist,
  parseSourceAllowlist,
} from '../modules/server-orchestration/source-allowlist.js';
import { cookieDomainAbleiten } from './cookie-domain.js';

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

/**
 * Mindestlänge aller Geheimnisse (Audit W2-6, security-matrix-08).
 *
 * HS256 (Access-Token, Pflichtenheft §7) verlangt einen Schlüssel von 256 Bit;
 * `jose` erzwingt das nicht und signiert klaglos mit `JWT_SECRET=test`. Ein
 * solcher Schlüssel ist offline zu erraten, und wer ihn hat, fälscht
 * Access-Token, OAuth-`state` und ALTCHA-Challenges. 32 Zeichen sind die
 * Untergrenze; `scripts/setup.sh` erzeugt 64.
 */
const MIN_SECRET_LENGTH = 32;

const geheimnisFehler = (name: string): string =>
  `${name} muss mindestens ${String(MIN_SECRET_LENGTH)} Zeichen lang sein ` +
  '(scripts/setup.sh erzeugt 64; siehe .env.example Abschnitt 4).';

/** Optionales Geheimnis: fehlen darf es, zu kurz sein nicht. */
const geheimnis = (name: string): z.ZodType<string | undefined> =>
  z.string().min(MIN_SECRET_LENGTH, geheimnisFehler(name)).optional();

/**
 * Vorgabe der Proxy-Vertrauensliste (Audit W2-6, backend-core-10).
 *
 * Enthalten sind die Adressbereiche, aus denen im ausgelieferten Aufbau ein
 * eigener Reverse-Proxy kommt: Loopback (Proxy direkt auf dem Host, §12.1) und
 * die privaten Bereiche, aus denen Docker seine Netze vergibt – Traefik läuft
 * im Netz `palantir` (`deploy/vps/docker-compose.yml`), dessen Adressbereich
 * Docker selbst zuteilt (172.17–172.31, danach 192.168.x).
 *
 * Bewusst **nicht** enthalten: `10.10.0.0/24`, das WireGuard-Netz. Genau dort
 * hängt der zusätzliche Host-Port des Backends, und ein Tunnel-Teilnehmer darf
 * `request.ip` nicht setzen können.
 */
const TRUSTED_PROXY_DEFAULT = '127.0.0.1/8,::1/128,172.16.0.0/12,192.168.0.0/16';

/**
 * Werte, deren Vorgabe **nur außerhalb der Produktion** gilt (Audit W2-23,
 * backend-core-07).
 *
 * Die drei haben dieselbe Eigenschaft: Fehlen sie in der `.env`, startet das
 * Backend anstandslos und arbeitet danach still falsch. Ohne `VPS_PUBLIC_IP`
 * bekommt jeder neu angelegte Server einen `A`-Eintrag auf `127.0.0.1` –
 * Cloudflare nimmt das an, und die Spieler lösen die Subdomain auf ihre eigene
 * Maschine auf. Ohne `WIREGUARD_HOME_IP` geht der Health-Check an eine Adresse,
 * hinter der nichts steht. Ohne `PALANTIR_DOMAIN` heißen alle abgeleiteten
 * Adressen `palantir.local`, und mit ihnen die Sitzungs-Cookies: Niemand kann
 * sich anmelden. Nirgends ein Fehler.
 *
 * Die Auth-Geheimnisse brechen für genau diesen Fall hart ab
 * ({@link requireAuthSecrets}) – der Maßstab war hier bisher ein anderer. In der
 * Entwicklung bleiben die Vorgaben unverändert: Dort ist `127.0.0.1` richtig,
 * und niemand pflegt eine Domain.
 */
const VORGABE_NAMEN = ['VPS_PUBLIC_IP', 'WIREGUARD_HOME_IP', 'PALANTIR_DOMAIN'] as const;

const PRODUKTIONS_VORGABEN: Record<
  (typeof VORGABE_NAMEN)[number],
  { readonly vorgabe: string; readonly zweck: string }
> = {
  VPS_PUBLIC_IP: {
    vorgabe: '127.0.0.1',
    zweck:
      'Der Wert ist das Ziel der A-Einträge aller Gameserver (Pflichtenheft §13); ' +
      'mit der Vorgabe 127.0.0.1 zeigt jede Server-Adresse auf die Maschine des Spielers.',
  },
  WIREGUARD_HOME_IP: {
    vorgabe: '10.10.0.2',
    zweck:
      'Der Wert ist das Ziel des Health-Checks im Tunnel (Pflichtenheft §2.1, §9); ' +
      'stimmt er nicht, gilt jeder gestartete Server als nicht erreichbar.',
  },
  PALANTIR_DOMAIN: {
    vorgabe: 'palantir.local',
    zweck:
      'Aus dem Wert entstehen Panel-Adressen, OAuth-Rücksprünge und die Cookie-Domain; ' +
      'mit der Vorgabe palantir.local kann sich niemand anmelden.',
  },
};

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  BACKEND_HOST: z.string().default('0.0.0.0'),
  BACKEND_PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  /**
   * Adressen der eigenen Reverse-Proxys (Pflichtenheft §7; Audit W2-6,
   * backend-core-10, security-matrix-10).
   *
   * Kommagetrennte IPv4-/IPv6-Adressen oder CIDR-Netze. Fastifys `trustProxy`
   * bestimmt daraus, welche `X-Forwarded-For`-Adresse als `request.ip` gilt –
   * und darauf keyt der Brute-Force-Schutz von Anmeldung/Registrierung/2FA.
   *
   * Ersetzt die frühere Hop-Zahl `TRUSTED_PROXY_HOPS`: Die vertraute dem
   * unmittelbaren Peer, wer immer das war. Der Backend-Port hängt zusätzlich an
   * der WireGuard-Adresse der VPS, also konnte jeder Tunnel-Teilnehmer die API
   * direkt ansprechen und seinen eigenen `X-Forwarded-For` gültig machen.
   *
   * Läuft die Instanz hinter dem Cloudflare-Proxy (Pflichtenheft §13), gehören
   * die Cloudflare-Bereiche hier **und** in `TRAEFIK_TRUSTED_IPS` – sonst gilt
   * die Cloudflare-Edge als Client und alle Nutzer teilen sich ein Rate-Limit
   * (infra-images-06). Ein leerer Eintrag in der `.env` bedeutet – wie überall
   * hier – „nicht gesetzt" und zieht die Vorgabe; eine Liste ohne gültigen
   * Eintrag gäbe es nur programmatisch und hieße „niemandem vertrauen".
   */
  TRUSTED_PROXY_ADDRESSES: z
    .string()
    .default(TRUSTED_PROXY_DEFAULT)
    .transform((value, ctx): SourceAllowlist => {
      try {
        return parseSourceAllowlist(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : String(error),
        });

        return z.NEVER;
      }
    }),

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

  /**
   * Öffentliche IPv4 der VPS – Ziel der `A`-Einträge (§13).
   *
   * Vorgabe nur außerhalb der Produktion, siehe {@link PRODUKTIONS_VORGABEN}.
   */
  VPS_PUBLIC_IP: optionalEnvString(),
  /**
   * Interne Tunnel-Adresse des Homeservers – Ziel des Health-Checks (§2.1, §9).
   *
   * Vorgabe nur außerhalb der Produktion, siehe {@link PRODUKTIONS_VORGABEN}.
   */
  WIREGUARD_HOME_IP: optionalEnvString(),

  /**
   * Pre-Shared-Token des Agents (§2.2).
   *
   * Bewusst optional: Das Backend startet auch ohne. Der WebSocket-Endpunkt
   * `/agent` lehnt dann aber **jede** Verbindung ab – ein offener Agent-Kanal
   * wäre vollständiger Zugriff auf den Homeserver (§18).
   */
  AGENT_TOKEN: optionalEnvString().refine(
    (value) => value === undefined || value.length >= MIN_SECRET_LENGTH,
    { message: geheimnisFehler('AGENT_TOKEN') },
  ),
  /**
   * Zulässige Quelladressen des Agent-Kanals `/agent` (Fundpunkt 121, W0-2).
   *
   * Kommagetrennte IPv4-/IPv6-Adressen oder CIDR-Netze, z. B.
   * `10.10.0.0/24,127.0.0.1`. Zweite Schicht hinter dem Deployment: Traefik
   * lässt `/agent` aus und der Host-Port hängt an der Tunnel-Adresse – fehlt
   * aber das Label oder bindet der Port an `0.0.0.0`, bliebe sonst nur noch
   * das Token als Hürde. Leer = keine Prüfung, damit Entwicklungsumgebungen
   * und bestehende Installationen unverändert laufen. Ein ungültiger Eintrag
   * verhindert den Start: Eine Liste, die still weniger prüft als
   * hingeschrieben, wäre schlimmer als gar keine.
   */
  AGENT_SOURCE_ALLOWLIST: optionalEnvString().transform((value, ctx): SourceAllowlist => {
    try {
      return parseSourceAllowlist(value);
    } catch (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: error instanceof Error ? error.message : String(error),
      });

      return z.NEVER;
    }
  }),
  /** Frist, in der ein Agent-Befehl beantwortet sein muss (§5.3). */
  AGENT_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(30_000),
  /**
   * Frist für das Anlegen eines Containers (Gefundener Punkt 111).
   *
   * Eigener Wert, weil der Agent ein fehlendes Image beim Anlegen selbst holt –
   * bei einem Spiel-Image dauert das Minuten. Die übliche Befehlsfrist bleibt
   * kurz; ein `STOP`, das eine Viertelstunde offen steht, wäre kein
   * Fortschritt.
   */
  AGENT_CREATE_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000),
  /**
   * Frist für `CREATE_BACKUP` und `RESTORE_BACKUP` (Audit W1-5, bb-02).
   *
   * Der Agent antwortet auf diese beiden Befehle erst, wenn er fertig ist – das
   * Ergebnis trägt `sizeBytes` und `completedAt`. Über mehrere Gigabyte
   * Weltdaten braucht tar+zstd dafür Stunden, nicht Sekunden. Mit der üblichen
   * Frist gälte ein laufendes Backup nach 30 s als gescheitert, während der
   * Agent weiterschreibt: fertiges Archiv ohne Datensatz, freigegebene Sperre,
   * ein zweiter Lauf über denselben Datenordner. Zwei Stunden sind die
   * Obergrenze, ab der ein Vorgang als hängend gelten darf.
   */
  BACKUP_COMMAND_TIMEOUT_MS: z.coerce.number().int().positive().default(7_200_000),

  /** DNS-Automatisierung über Cloudflare (§13); ohne beide Werte passiert nichts. */
  CLOUDFLARE_API_TOKEN: optionalEnvString(),
  CLOUDFLARE_ZONE_ID: optionalEnvString(),

  /**
   * Öffentlicher Portbereich für Gameserver (§2.4).
   *
   * Dieselben zwei Werte setzen auch die Erlaubnisliste von `frps` und die
   * Proxy-Liste von `frpc` (`deploy/vps/frps.toml`,
   * `deploy/gamenode/frpc.toml`). Sie dürfen nicht auseinanderlaufen: Ein Port
   * ohne Tunnel ergibt einen Server, der startet, „läuft" meldet und trotzdem
   * nicht erreichbar ist. Das Ende liegt unter {@link MINECRAFT_ROUTER_PORT},
   * damit dieser nicht aus dem Pool vergeben werden kann.
   */
  GAME_PORT_RANGE_START: z.coerce.number().int().min(1).max(65_535).default(25_000),
  GAME_PORT_RANGE_END: z.coerce.number().int().min(1).max(65_535).default(25_564),
  /** Hostname des Hostname-Routing-Proxys – Ziel der `CNAME`-Einträge (§2.4, §13). */
  GAME_ROUTER_HOSTNAME: optionalEnvString(),
  /** Einzelner öffentlicher Port für Spiele mit Hostname-Routing (§2.4). */
  MINECRAFT_ROUTER_PORT: z.coerce.number().int().min(1).max(65_535).default(25_565),

  /**
   * Maximale Upload-Größe pro Datei im Datei-Manager (§12.1).
   *
   * Wirkt nur **unterhalb** der Kanal-Grenze des Agents
   * (`AGENT_FILE_CHANNEL_MAX_BYTES`, 64 MiB): Der Agent nimmt eine Datei in
   * einem Stück entgegen und lehnt Größeres ab, also puffert das Backend sie
   * auch nicht erst (Fundpunkt 123). Ein größerer Wert – auch die Vorgabe von
   * 2 GiB – hebt die Grenze nicht an; wer sie enger ziehen will, setzt hier
   * weniger.
   */
  MAX_UPLOAD_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024 * 1024),

  /**
   * Maximale Größe eines Weltdaten-Archivs beim Anlegen eines Servers
   * (Lastenheft §3.3, Arbeitspaket P4).
   *
   * Eigene Grenze und nicht `MAX_UPLOAD_SIZE_BYTES`: Das Archiv wird auf dem
   * Homeserver entpackt und die Einträge dabei im Speicher gehalten.
   *
   * Seit Gefundenem Punkt 106 geht es **blockweise** an den Agent, hängt also
   * nicht mehr an dessen Frame-Grenze von 64 MiB. Die Vorgabe steht deshalb bei
   * 256 MiB – genug für die Migration eines gewachsenen Servers und noch mit
   * Abstand unter der Entpack-Grenze des Agents (`MAX_EXTRACTED_BYTES`,
   * 512 MiB **entpackt**).
   */
  MAX_WORLD_ARCHIVE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(256 * 1024 * 1024),

  /**
   * Verzeichnis **auf der VPS**, in dem hochgeladene Weltdaten-Archive auf das
   * Anlegen des Servers warten (P4).
   *
   * Ohne Angabe ein Unterordner des System-Temp-Verzeichnisses. Wer die Uploads
   * auf eine andere Platte legen will (Größe, Verschlüsselung), setzt hier
   * einen eigenen Pfad.
   */
  WORLD_ARCHIVE_DIR: optionalEnvString(),

  /**
   * Aufbewahrungsfrist des Messwert-Verlaufs in Stunden (Lastenheft §3.3
   * „Verlaufsdarstellung", Arbeitspaket P5).
   *
   * Zwei Tage decken den Blick „was war letzte Nacht?" ab und halten die
   * Tabelle klein: Bei Minuten-Takt sind das rund 2 900 Zeilen je Server.
   * Ältere Stichproben räumt der Zeitgeber in jedem Durchlauf weg.
   */
  STATS_HISTORY_RETENTION_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 90)
    .default(48),

  /**
   * Ablageort der Panel-Sicherungen **auf der VPS** (Mockup-Abgleich 12.5.1).
   *
   * Ohne Angabe gibt es keine Sicherung des Panels: Weder ein Lauf von Hand
   * noch der geplante Lauf legt dann etwas an, beide melden
   * `PANEL_BACKUP_NOT_CONFIGURED`. Bewusst ohne Vorgabewert – ein vollständiger
   * Abzug der Datenbank in einem Verzeichnis, das niemand gewählt hat, wäre
   * schlechter als keine Sicherung.
   */
  PANEL_BACKUP_DIR: optionalEnvString(),

  /**
   * Abstand zweier geplanter Panel-Sicherungen in Stunden.
   *
   * `0` schaltet den geplanten Lauf ab; von Hand bleibt er möglich. Gerechnet
   * wird der Abstand zum vorigen Lauf und nicht eine feste Uhrzeit: Nach einem
   * Neustart des Backends fehlte sonst genau der Lauf, dessen Uhrzeit in die
   * Ausfallzeit fiel.
   */
  PANEL_BACKUP_INTERVAL_HOURS: z.coerce
    .number()
    .int()
    .min(0)
    .max(24 * 30)
    .default(24),

  /**
   * Aufbewahrung der Panel-Sicherungen in Tagen; `0` heißt „nie löschen".
   *
   * Vierzehn Tage decken den Fall ab, dass ein Fehler erst nach ein paar Tagen
   * auffällt, und halten den Platzbedarf berechenbar.
   */
  PANEL_BACKUP_RETENTION_DAYS: z.coerce.number().int().min(0).max(365).default(14),

  /**
   * Programm für den Abzug; nur nötig, wenn `pg_dump` nicht im `PATH` steht.
   *
   * Die Fassung muss zur Datenbank passen: Ein älteres `pg_dump` lehnt eine
   * neuere Serverfassung ab, statt einen halben Abzug zu schreiben.
   */
  PG_DUMP_BINARY: optionalEnvString(),

  /**
   * Frist, nach der eine hängende Sicherung als abgerissen gilt (Audit W1-6,
   * bb-03).
   *
   * Ein Backup-Lauf lebt nur im Prozess des Backends. Stirbt es mittendrin
   * (Deploy, Absturz), bleibt der Datensatz auf `pending`/`running` stehen und
   * sperrt jedes weitere Backup dieses Servers. Der Zeitgeber setzt solche
   * Läufe nach dieser Frist auf `failed`.
   *
   * Drei Stunden liegen weit über allem, was ein echter Lauf braucht – ein
   * Archiv über mehrere GB Weltdaten darf dauern. Zu kurz wäre schädlich: Ein
   * noch schreibender Agent hinterließe ein Archiv ohne Datensatz.
   */
  BACKUP_ORPHAN_AFTER_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .default(3 * 60 * 60 * 1000),

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
   * Takt des zentralen Zeitgebers in Millisekunden (`src/scheduler.ts`).
   *
   * Eine Minute: Beide Aufgaben – Auto-Shutdown-Sweep (§9) und fällige
   * Backup-Zeitpläne – sind minutengenau fällig. Größer würde Cron-Minuten
   * überspringen, kleiner nur dieselbe leere Menge häufiger laden. Die
   * Begründung steht ausführlich im Kopf von `src/scheduler.ts`.
   */
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().min(1_000).default(60_000),

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

  // -- Notification-Engine (B6, Pflichtenheft §14; .env.example Abschnitt 10) --

  /**
   * Standard-Discord-Webhook der Instanz.
   *
   * Kanäle ohne eigene URL greifen darauf zurück; so kommt der Standardkanal
   * ohne ein Geheimnis in der Datenbank aus (CLAUDE.md §2). Bewusst optional:
   * Ohne den Wert läuft das Backend unverändert, solche Kanäle sind dann aber
   * nicht versandfähig (`deliverable: false` am DTO) und werden beim Auslösen
   * übersprungen. Die Zustellung in die Inbox im Panel hängt nicht daran.
   */
  DISCORD_WEBHOOK_URL: optionalEnvString(),
  /**
   * Frist eines einzelnen Versandversuchs an einen externen Kanal.
   *
   * Der Versand läuft im Hintergrund und kann den auslösenden Vorgang nicht
   * aufhalten; die Frist begrenzt, wie lange ein hängender Aufruf Verbindungen
   * und Speicher hält.
   */
  NOTIFICATION_DELIVERY_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  // -- Auth & Identity (Arbeitspaket B1, Pflichtenheft §7) --------------------
  // Alle Werte kommen aus derselben zentralen `.env` (Pflichtenheft §12.1).
  // Die Geheimnisse sind bewusst **optional** typisiert, aber praktisch Pflicht:
  // `requireAuthSecrets()` unten bricht beim Start des Auth-Moduls mit einer
  // verständlichen Meldung ab, wenn eines fehlt. So bleibt das Backend für
  // Tests und den Health-Endpunkt startbar, ohne dass irgendwo ein Standardwert
  // eingebaut wäre – ein hartkodiertes Fallback-Secret wäre eine Hintertür
  // (CLAUDE.md §2).

  /** Signaturschlüssel des kurzlebigen Access-JWT (HS256), mindestens 32 Zeichen. */
  JWT_SECRET: geheimnis('JWT_SECRET'),
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
  /** Schlüssel, mit dem das OAuth-`state`-Cookie signiert wird; mindestens 32 Zeichen. */
  CSRF_SECRET: geheimnis('CSRF_SECRET'),
  /**
   * Cookie-Domain der Sitzungs-Cookies.
   *
   * Leer lassen: Die Vorgabe wird aus den tatsächlichen Panel-Adressen
   * abgeleitet (`cookieDomainAbleiten`) und ist damit so eng wie möglich –
   * früher stand hier `PALANTIR_DOMAIN`, was die Cookies auch an die
   * nutzergesteuerten Spielserver-Hosts `<sub>.<PALANTIR_DOMAIN>` schickte
   * (Audit W2-6, security-matrix-03). Ein von Hand gesetzter Wert gilt
   * unverändert weiter.
   */
  COOKIE_DOMAIN: z.string().optional(),
  /**
   * `Secure`-Flag der Sitzungs-Cookies (Pflichtenheft §7).
   *
   * Standard `true`. Ausschließlich für lokale Entwicklung ohne TLS auf `false`
   * zu setzen – über HTTP schickt der Browser ein `Secure`-Cookie sonst nie.
   * Bewusst als Variable statt als stille Abhängigkeit von `NODE_ENV`, damit im
   * Betrieb sichtbar bleibt, was gilt; mit `NODE_ENV=production` lehnt die
   * Prüfung unten den Wert `false` aber ab (spec-pflichtenheft-10).
   */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  /**
   * Basis-Domain der Instanz – die **einzige** Stelle, an der der Domainname
   * gepflegt wird. Alle folgenden Adressen werden daraus abgeleitet, sofern
   * sie nicht ausdrücklich gesetzt sind (siehe `adressenAbleiten`).
   * Dient zusätzlich dem Authenticator als Aussteller-Bezeichnung.
   *
   * Vorgabe nur außerhalb der Produktion, siehe {@link PRODUKTIONS_VORGABEN}.
   */
  PALANTIR_DOMAIN: optionalEnvString(),
  /**
   * Öffentliche Adresse des Frontends – Ziel des Rücksprungs nach OAuth.
   * Ohne Angabe: `https://<PALANTIR_DOMAIN>`.
   */
  PUBLIC_WEB_URL: z.string().url().optional(),
  /**
   * Öffentliche Adresse der Backend-API.
   * Ohne Angabe: `https://api.<PALANTIR_DOMAIN>`.
   */
  PUBLIC_API_URL: z.string().url().optional(),

  /** HMAC-Schlüssel der ALTCHA-Challenges (Pflichtenheft §7), mindestens 32 Zeichen. */
  ALTCHA_HMAC_KEY: geheimnis('ALTCHA_HMAC_KEY'),
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

/**
 * Prüfungen, die mehr als eine Variable brauchen (Audit W2-6,
 * spec-pflichtenheft-10; Audit W2-23, backend-core-07).
 *
 * `COOKIE_SECURE=false` ist laut Pflichtenheft §7 **ausschließlich** für die
 * lokale Entwicklung ohne TLS gedacht. Eine aus der Entwicklung übernommene
 * `.env` startete bisher auch mit `NODE_ENV=production` klaglos – und setzte
 * Access-, Refresh- und CSRF-Cookie ohne `Secure`. Lieber ein Startabbruch mit
 * klarer Meldung als eine Instanz, die still ohne diesen Schutz läuft.
 *
 * Aus demselben Grund verlangt die zweite Prüfung in Produktion die Werte aus
 * {@link PRODUKTIONS_VORGABEN}. Der anschließende `transform` setzt die
 * Vorgaben – er läuft nur, wenn keine Prüfung angeschlagen hat.
 */
const envSchemaMitPrüfungen = envSchema
  .superRefine((werte, ctx) => {
    if (werte.NODE_ENV === 'production' && !werte.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message:
          'COOKIE_SECURE=false ist nur außerhalb der Produktion zulässig ' +
          '(Pflichtenheft §7): ohne Secure-Flag gehen die Sitzungs-Cookies auch über HTTP. ' +
          'Entweder COOKIE_SECURE=true setzen oder NODE_ENV umstellen.',
      });
    }

    if (werte.NODE_ENV !== 'production') {
      return;
    }

    for (const name of VORGABE_NAMEN) {
      if (werte[name] !== undefined) {
        continue;
      }

      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [name],
        message:
          `${name} fehlt. Mit NODE_ENV=production gibt es dafür keinen Vorgabewert ` +
          `(Vorgabe außerhalb der Produktion: ${PRODUKTIONS_VORGABEN[name].vorgabe}). ` +
          `${PRODUKTIONS_VORGABEN[name].zweck} ` +
          'Wert in der zentralen .env im Repo-Root eintragen (siehe .env.example).',
      });
    }
  })
  .transform((werte) => ({
    ...werte,
    VPS_PUBLIC_IP: werte.VPS_PUBLIC_IP ?? PRODUKTIONS_VORGABEN.VPS_PUBLIC_IP.vorgabe,
    WIREGUARD_HOME_IP: werte.WIREGUARD_HOME_IP ?? PRODUKTIONS_VORGABEN.WIREGUARD_HOME_IP.vorgabe,
    PALANTIR_DOMAIN: werte.PALANTIR_DOMAIN ?? PRODUKTIONS_VORGABEN.PALANTIR_DOMAIN.vorgabe,
  }));

/** Vollständig geprüfte und ergänzte Umgebung (Ausgabe von {@link umgebungLesen}). */
export type UmgebungRoh = z.infer<typeof envSchemaMitPrüfungen>;

/**
 * Namen aller Umgebungsvariablen, die das Backend liest.
 *
 * Ausgeschrieben aus dem Schema selbst, damit die `environment:`-Listen der
 * Backend-Dienste in `deploy/vps/docker-compose.yml` dagegen geprüft werden
 * können (Audit W2-23, infra-images-03; siehe `deploy-umgebung.test.ts`). Seit
 * dort kein `env_file: ../../.env` mehr steht, ist eine hier ergänzte und dort
 * vergessene Variable sonst nicht zu bemerken: Der Container zöge still den
 * Vorgabewert.
 */
export const BACKEND_UMGEBUNGSVARIABLEN: readonly string[] = Object.keys(envSchema.shape);

/**
 * In einer `.env` bedeutet `SCHLUESSEL=` „nicht gesetzt", nicht „leerer Wert".
 * `dotenv` liefert dafür aber einen leeren String. Ohne diese Normalisierung
 * würden Vorgabewerte nicht greifen, abgeleitete Adressen leer bleiben und
 * Prüfungen wie `.url()` an einem leeren String scheitern – die Anwendung käme
 * also gar nicht erst hoch, obwohl die Vorlage genau so ausgeliefert wird.
 */
export function leereWerteAlsUngesetzt(
  werte: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(werte).map(([schlüssel, wert]) => [
      schlüssel,
      typeof wert === 'string' && wert.trim() === '' ? undefined : wert,
    ]),
  );
}

/**
 * Liest einen Satz Umgebungswerte gegen das vollständige Schema.
 *
 * Ausgelagert und exportiert, damit die Prüfungen (Mindestlängen der
 * Geheimnisse, `COOKIE_SECURE` in Produktion) ohne Neuladen des Moduls
 * testbar sind (CLAUDE.md §4).
 */
export function umgebungLesen(
  werte: Record<string, string | undefined>,
): z.SafeParseReturnType<unknown, UmgebungRoh> {
  return envSchemaMitPrüfungen.safeParse(leereWerteAlsUngesetzt(werte));
}

const parsed = umgebungLesen(process.env);

if (!parsed.success) {
  const details = parsed.error.issues
    .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  throw new Error(`Ungültige Umgebungskonfiguration für das Backend:\n${details}`);
}

/**
 * Leitet alle domainabhängigen Adressen aus `PALANTIR_DOMAIN` ab.
 *
 * Hintergrund: Der Domainname kam bisher an neun Stellen der `.env` vor. Ein
 * Wechsel hätte jede einzelne davon betroffen – mit der Gefahr, eine zu
 * übersehen (etwa eine OAuth-Redirect-URI, was den Login stillschweigend
 * bricht). Maßgeblich ist deshalb nur noch `PALANTIR_DOMAIN`.
 *
 * Jeder abgeleitete Wert bleibt einzeln überschreibbar. Das ist für die
 * Entwicklung nötig, wo Frontend und API auf `localhost` mit unterschiedlichen
 * Ports liegen und sich nicht aus einer Domain ergeben.
 *
 * Die Callback-Pfade entsprechen der in `modules/auth/routes.ts` registrierten
 * Route `/auth/:provider/callback` – sie sind nicht frei gewählt.
 */
export function adressenAbleiten(werte: UmgebungRoh) {
  const ohneSchrägstrich = (url: string): string => url.replace(/\/+$/, '');
  const domain = werte.PALANTIR_DOMAIN;

  const webUrl = ohneSchrägstrich(werte.PUBLIC_WEB_URL ?? `https://${domain}`);
  const apiUrl = ohneSchrägstrich(werte.PUBLIC_API_URL ?? `https://api.${domain}`);

  return {
    ...werte,
    PUBLIC_WEB_URL: webUrl,
    PUBLIC_API_URL: apiUrl,
    /*
     * Nicht mehr `domain` als Vorgabe (Audit W2-6, security-matrix-03): Ein
     * `Domain`-Attribut gilt samt aller Subdomains, und unter
     * `<sub>.<PALANTIR_DOMAIN>` laufen die Spielserver-Container mit fremdem
     * Code. Abgeleitet wird deshalb aus den echten Panel-Adressen – bei
     * getrennten Hosts (`beispiel.tld` + `api.beispiel.tld`) ergibt das
     * denselben Wert wie bisher, bei einem gemeinsamen Host (Entwicklung auf
     * `localhost`) gar keine Domain, und bei der empfohlenen Aufteilung eine
     * Ebene tiefer (`panel.beispiel.tld` + `api.panel.beispiel.tld`) genau die
     * Panel-Ebene. Wechselt der Wert, gelten die im Browser liegenden Cookies
     * nicht mehr: der Bestand meldet sich einmalig neu an.
     */
    COOKIE_DOMAIN: werte.COOKIE_DOMAIN ?? cookieDomainAbleiten(webUrl, apiUrl),
    DISCORD_REDIRECT_URI: werte.DISCORD_REDIRECT_URI ?? `${apiUrl}/auth/discord/callback`,
    TWITCH_REDIRECT_URI: werte.TWITCH_REDIRECT_URI ?? `${apiUrl}/auth/twitch/callback`,
    STEAM_RETURN_URL: werte.STEAM_RETURN_URL ?? `${apiUrl}/auth/steam/callback`,
  };
}

export const env = adressenAbleiten(parsed.data);
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
