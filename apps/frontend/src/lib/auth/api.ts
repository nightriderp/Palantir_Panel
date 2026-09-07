import {
  type AccountDto,
  type AltchaChallenge,
  type ApiResponse,
  type AuthMethodType,
  type LoginResult,
  type TwoFactorSetupDto,
} from '@palantir/contracts';
import {
  type ChangePasswordInput,
  type ConfirmTwoFactorInput,
  type DeleteAccountInput,
  type DisableTwoFactorInput,
  type LinkPasswordInput,
  type LoginInput,
  type RegisterInput,
  type TwoFactorInput,
  type UpdateProfileInput,
  accountDtoSchema,
  altchaChallengeSchema,
  apiResponseSchema,
  loginResultSchema,
  twoFactorSetupSchema,
} from '@palantir/validation';
import { z } from 'zod';

import { AuthRequestError, NETWORK_ERROR_MESSAGE, UNKNOWN_ERROR_MESSAGE } from './errors';

/**
 * REST-Aufrufe der Anmeldung (Pflichtenheft §5.1, §5.3 und §7).
 *
 * Jede Antwort läuft durch den Response-Envelope und zusätzlich durch das
 * Zod-Schema aus `@palantir/validation` – das Frontend vertraut der API nicht
 * blind. Fehler kommen als `AuthRequestError` mit dem Code aus dem Katalog
 * heraus; übersetzt wird erst in der Oberfläche (siehe `errors.ts`).
 */

/**
 * Endpunkte, die das Backend-Arbeitspaket B1 bereitstellen muss.
 *
 * Bewusst an einer Stelle gesammelt: solange B1 nicht existiert, ist das hier
 * die einzige Datei, die bei einer abweichenden Pfadwahl anzupassen ist. Die
 * OAuth-Pfade folgen den Redirect-URIs aus `.env.example` §5
 * (`…/auth/<provider>/callback`).
 */
export const AUTH_ENDPOINTS = {
  login: '/auth/login',
  twoFactor: '/auth/login/2fa',
  register: '/auth/register',
  session: '/auth/session',
  logout: '/auth/logout',
  altchaChallenge: '/auth/altcha/challenge',
  /**
   * Startet den Redirect-Ablauf beim Provider (kein `fetch`, echte Navigation).
   *
   * `returnTo` steuert, wohin die Verknüpfung aus dem eingeloggten Zustand
   * zurückkehrt (das Backend prüft den Wert gegen eine Allowlist). Ohne Angabe
   * bleibt es beim Standardziel.
   */
  oauthStart: (provider: string, returnTo?: string) =>
    returnTo === undefined
      ? `/auth/${provider}/start`
      : `/auth/${provider}/start?returnTo=${encodeURIComponent(returnTo)}`,
  /** Verknüpftes Anmeldeverfahren trennen (Pflichtenheft §7). */
  method: (type: string) => `/auth/methods/${type}`,
  passwordLink: '/auth/password/link',
  passwordChange: '/auth/password/change',
  twoFactorSetup: '/auth/2fa/setup',
  twoFactorConfirm: '/auth/2fa/confirm',
  twoFactorDisable: '/auth/2fa/disable',
  /** Eigenes Konto endgültig löschen (Lastenheft §3.1). */
  account: '/auth/account',
  /** Refresh-Token gegen ein frisches Zugriffs-Token tauschen (Pflichtenheft §7). */
  refresh: '/auth/refresh',
} as const;

/**
 * Pfade, bei denen ein 401 die endgültige Antwort ist.
 *
 * Anmeldung, Registrierung und die ALTCHA-Challenge laufen ohne Sitzung; ein
 * Erneuerungsversuch wäre dort sinnlos. `refresh` und `logout` stehen mit in der
 * Liste, damit sich der Ablauf nicht selbst aufruft.
 *
 * Für `logout` ist das seit dem Backend-Fix zu Fundpunkt frontend-lib-05
 * unschädlich: Fehlt das Zugriffs-Token, weist der Refresh-Token die Sitzung
 * aus und `POST /auth/logout` widerruft sie trotzdem. Ein Tausch davor wäre
 * nur ein zusätzlicher Roundtrip, der eine gerade abzumeldende Sitzung noch
 * einmal verlängert.
 */
const OHNE_ERNEUERUNG: ReadonlySet<string> = new Set([
  '/auth/login',
  '/auth/login/2fa',
  '/auth/register',
  '/auth/altcha/challenge',
  '/auth/logout',
  '/auth/refresh',
]);

/**
 * Läuft gerade ein Erneuerungsversuch? Alle Wartenden teilen sich denselben.
 *
 * Ohne diese Bündelung schickt eine Seite, die zehn Ressourcen gleichzeitig
 * lädt, nach dem Ablauf des Zugriffs-Tokens auch zehn Erneuerungen los. Der
 * Refresh-Token rotiert bei jedem Tausch (Pflichtenheft §7) – neun davon
 * kämen mit einem bereits verbrauchten Token.
 */
let laufendeErneuerung: Promise<boolean> | null = null;

/*
 * Abstimmung über Tab-Grenzen hinweg (Fundpunkt frontend-lib-01).
 *
 * `laufendeErneuerung` bündelt nur im eigenen Tab: Zwei offene Tabs haben je
 * einen eigenen Modulzustand und tauschen sonst gleichzeitig denselben
 * Refresh-Token ein. Die Sperre liegt deshalb in `localStorage` – das sehen
 * alle Tabs derselben Herkunft –, das Ergebnis wandert über einen
 * `BroadcastChannel`, damit Wartende nicht auf gut Glück nachtauschen.
 *
 * Beides ist optional: Fehlt der Speicher (Server-Rendering, Logik-Testlauf
 * ohne DOM) oder der Kanal, bleibt es bei der Bündelung im eigenen Tab. Die
 * Sperre ist bewusst nur eine Verkehrsberuhigung und kein harter Ausschluss –
 * `localStorage` kennt kein „schreiben, falls leer". Was durchrutscht, fängt
 * die Kulanzfrist des Backends auf den eben ersetzten Token ab.
 */
const ERNEUERUNG_SPERRE = 'palantir.auth.erneuerung';
const ERNEUERUNG_KANAL = 'palantir.auth.erneuerung';
/** Danach gilt eine Sperre als verwaist – der Tab wurde geschlossen. */
const SPERRE_TTL_MS = 10_000;
/** Abstand, in dem eine fremde Sperre nachgesehen wird. */
const SPERRE_TAKT_MS = 50;

/** `localStorage`, sofern vorhanden und zugänglich. */
function speicher(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    // In manchen Browser-Einstellungen wirft schon der Zugriff.
    return null;
  }
}

/** Tauscht gerade ein anderer Tab? */
function fremdeSperre(): boolean {
  try {
    const wert = speicher()?.getItem(ERNEUERUNG_SPERRE);
    if (wert === undefined || wert === null) return false;

    const gesetzt = Number(wert);
    return Number.isFinite(gesetzt) && Date.now() - gesetzt < SPERRE_TTL_MS;
  } catch {
    // Unlesbare Sperre wie „keine" behandeln – lieber einmal zu viel tauschen.
    return false;
  }
}

function setzeSperre(): void {
  try {
    speicher()?.setItem(ERNEUERUNG_SPERRE, String(Date.now()));
  } catch {
    // Voller oder gesperrter Speicher: dann eben ohne Abstimmung.
  }
}

function loeseSperre(): void {
  try {
    speicher()?.removeItem(ERNEUERUNG_SPERRE);
  } catch {
    // Bleibt die Sperre liegen, läuft sie nach `SPERRE_TTL_MS` von selbst ab.
  }
}

function oeffneKanal(): BroadcastChannel | null {
  try {
    return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(ERNEUERUNG_KANAL);
  } catch {
    return null;
  }
}

/** Nachricht eines anderen Tabs auf die eigene Form prüfen. */
function leseErgebnis(nachricht: unknown): boolean | null {
  if (typeof nachricht !== 'object' || nachricht === null || !('erneuert' in nachricht)) {
    return null;
  }

  const wert = (nachricht as { erneuert: unknown }).erneuert;
  return typeof wert === 'boolean' ? wert : null;
}

/** Das Ergebnis des eigenen Tauschs an die anderen Tabs melden. */
function meldeErgebnis(erneuert: boolean): void {
  const kanal = oeffneKanal();
  if (kanal === null) return;

  try {
    kanal.postMessage({ erneuert });
  } catch {
    // Ohne Meldung warten die anderen Tabs, bis die Sperre fällt.
  } finally {
    kanal.close();
  }
}

/**
 * Auf den Tausch eines anderen Tabs warten.
 *
 * `null` heißt: Es kam kein Ergebnis – der andere Tab wurde geschlossen oder
 * es gibt keinen Kanal. Dann tauscht der eigene Tab selbst.
 */
function warteAufFremdesErgebnis(): Promise<boolean | null> {
  return new Promise((resolve) => {
    const kanal = oeffneKanal();
    let takt: ReturnType<typeof setInterval> | null = null;

    const beenden = (wert: boolean | null): void => {
      if (takt !== null) clearInterval(takt);
      kanal?.close();
      resolve(wert);
    };

    if (kanal !== null) {
      kanal.onmessage = (ereignis: MessageEvent<unknown>): void => {
        const ergebnis = leseErgebnis(ereignis.data);
        if (ergebnis !== null) beenden(ergebnis);
      };
    }

    // Fällt der andere Tab aus, endet das Warten mit dem Ablauf seiner Sperre.
    takt = setInterval(() => {
      if (!fremdeSperre()) beenden(null);
    }, SPERRE_TAKT_MS);
  });
}

async function tauscheToken(): Promise<boolean> {
  if (speicher() === null) {
    // Ohne gemeinsamen Speicher gibt es nichts abzustimmen.
    return await sendeErneuerung();
  }

  if (fremdeSperre()) {
    const fremd = await warteAufFremdesErgebnis();
    if (fremd !== null) return fremd;
  }

  setzeSperre();

  try {
    const erfolg = await sendeErneuerung();
    meldeErgebnis(erfolg);
    return erfolg;
  } finally {
    loeseSperre();
  }
}

async function sendeErneuerung(): Promise<boolean> {
  const csrfToken = currentCsrfToken();

  try {
    const response = await fetch(apiUrl(AUTH_ENDPOINTS.refresh), {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(csrfToken === null ? {} : { [CSRF_HEADER_NAME]: csrfToken }),
      },
    });

    return response.ok;
  } catch {
    // Netz weg: wie ein fehlgeschlagener Tausch behandeln. Der ursprüngliche
    // Aufruf meldet dann seinen eigenen Fehler, nicht diesen hier.
    return false;
  }
}

/**
 * Die Sitzung erneuern, wenn das Zugriffs-Token abgelaufen ist.
 *
 * Das Zugriffs-Token gilt 15 Minuten (`JWT_ACCESS_TOKEN_TTL`), der
 * Refresh-Token 30 Tage. Ohne diesen Tausch wäre nach einer Viertelstunde jede
 * Anfrage `AUTH_REQUIRED`, während die Sitzung eigentlich noch gilt.
 *
 * `false` heißt: Der Tausch ging nicht durch. Das Backend löscht in dem Fall die
 * Sitzungs-Cookies selbst, sodass die nächste Navigation auf der Anmeldung
 * landet – hier wird deshalb nicht zusätzlich umgeleitet.
 *
 * Auf dem Server (Middleware, Server-Komponenten) passiert nichts: gesetzte
 * Cookies erreichten den Browser dort nicht.
 */
export function refreshSession(): Promise<boolean> {
  if (typeof document === 'undefined') {
    return Promise.resolve(false);
  }

  laufendeErneuerung ??= tauscheToken().finally(() => {
    laufendeErneuerung = null;
  });

  return laufendeErneuerung;
}

/** Darf für diesen Pfad nach einem 401 erneuert werden? */
export function darfErneuern(path: string): boolean {
  return !OHNE_ERNEUERUNG.has(path);
}

/**
 * Basisadresse der Backend-API.
 *
 * `NEXT_PUBLIC_API_URL` trägt denselben Wert wie `PUBLIC_API_URL` aus der
 * zentralen `.env` (Pflichtenheft §12.1); nur `NEXT_PUBLIC_`-Variablen erreichen
 * den Browser. Gesetzt wird die Variable nicht von Hand, sondern in
 * `next.config.mjs` aus `PUBLIC_API_URL` bzw. `PALANTIR_DOMAIN` abgeleitet –
 * dort steht auch, warum der Wert absolut sein muss.
 */
export function apiBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_API_URL ?? '').replace(/\/+$/, '');
}

/** Vollständige URL zu einem API-Pfad. */
export function apiUrl(path: string): string {
  return `${apiBaseUrl()}${path}`;
}

/**
 * CSRF-Token für zustandsändernde Requests (Pflichtenheft §7).
 *
 * Das Backend legt es als lesbares Cookie ab (im Gegensatz zum Refresh-Token,
 * das httpOnly bleibt); der Browser schickt es hier als Header zurück. Fehlt es,
 * wird der Header weggelassen und das Backend antwortet mit seinem eigenen
 * Fehler – ein stiller Bypass entsteht dadurch nicht.
 */
export const CSRF_COOKIE_NAME = 'palantir_csrf';
export const CSRF_HEADER_NAME = 'x-csrf-token';

export function readCsrfToken(cookieHeader: string): string | null {
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === CSRF_COOKIE_NAME && rest.length > 0) {
      try {
        return decodeURIComponent(rest.join('='));
      } catch {
        /*
         * Fehlerhaft kodierter Wert (`%E0`, halbe Prozentangabe): Der Cookie ist
         * unbrauchbar, aber er darf nicht den ganzen Aufruf reißen
         * (Fundpunkt frontend-lib-12). Die Sitzungs-Cookies hängen an der
         * Basis-Domain und sind damit für jede Subdomain schreibbar – ein
         * fremder Dienst konnte so jeden zustandsändernden Request in einen
         * `URIError` laufen lassen: `apiRequest` rejected, die Ansicht blieb
         * für immer im Ladezustand.
         *
         * `null` heißt hier wie überall „kein Token" – der Header entfällt und
         * das Backend antwortet mit seiner eigenen CSRF-Prüfung
         * (Pflichtenheft §7). Ein stiller Bypass entsteht dadurch nicht.
         */
        return null;
      }
    }
  }
  return null;
}

function currentCsrfToken(): string | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return readCsrfToken(document.cookie);
}

/**
 * Führt einen API-Aufruf aus und liefert die geprüften Nutzdaten.
 *
 * `credentials: 'include'` ist nötig, weil Sitzung und CSRF-Token als Cookies
 * transportiert werden (Pflichtenheft §7) und die API unter einer eigenen
 * Subdomain liegen kann.
 */
async function request<TSchema extends z.ZodTypeAny>(
  path: string,
  dataSchema: TSchema,
  init: RequestInit = {},
): Promise<z.infer<TSchema>> {
  try {
    return await sende(path, dataSchema, init);
  } catch (error) {
    const abgelaufen =
      error instanceof AuthRequestError &&
      error.code === 'AUTH_REQUIRED' &&
      darfErneuern(path) &&
      (await refreshSession());

    if (!abgelaufen) throw error;

    // Genau ein zweiter Versuch: schlägt der auch fehl, ist es kein
    // Token-Problem mehr und der Fehler gehört nach oben.
    return await sende(path, dataSchema, init);
  }
}

async function sende<TSchema extends z.ZodTypeAny>(
  path: string,
  dataSchema: TSchema,
  init: RequestInit = {},
): Promise<z.infer<TSchema>> {
  const csrfToken = currentCsrfToken();
  let response: Response;

  try {
    response = await fetch(apiUrl(path), {
      ...init,
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(init.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(csrfToken === null ? {} : { [CSRF_HEADER_NAME]: csrfToken }),
        ...init.headers,
      },
    });
  } catch {
    // Netzwerkabbruch, DNS-Fehler, abgelehnte Verbindung – kein Fehlercode.
    throw new AuthRequestError(NETWORK_ERROR_MESSAGE, null);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new AuthRequestError(UNKNOWN_ERROR_MESSAGE, null);
  }

  const parsed = apiResponseSchema(dataSchema).safeParse(body);
  if (!parsed.success) {
    throw new AuthRequestError(UNKNOWN_ERROR_MESSAGE, null);
  }

  /*
   * Die Prüfung oben ist die vollständige – hier wird nur der Typ nachgezogen.
   * Zod verliert bei einem generisch übergebenen Daten-Schema die Unterscheidung
   * der beiden Envelope-Zweige; `ApiResponse<T>` aus `@palantir/contracts` hält
   * genau die Form fest, die `apiResponseSchema` zur Laufzeit erzwingt.
   */
  const envelope = parsed.data as ApiResponse<z.infer<TSchema>>;

  if (!envelope.success) {
    throw new AuthRequestError(envelope.error.message, envelope.error.code);
  }

  return envelope.data;
}

/** Erster Anmeldeschritt (Pflichtenheft §7). */
export function login(input: LoginInput): Promise<LoginResult> {
  return request(AUTH_ENDPOINTS.login, loginResultSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

/** Zweiter Anmeldeschritt – TOTP oder Backup-Code (Pflichtenheft §7). */
export function verifyTwoFactor(input: TwoFactorInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.twoFactor, z.object({ account: accountDtoSchema }), {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Registrierung eines Passwort-Kontos (Lastenheft §3.1). */
export function register(input: RegisterInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.register, z.object({ account: accountDtoSchema }), {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Bestehende Sitzung wiederherstellen; wirft `AUTH_REQUIRED`, wenn keine da ist. */
export function fetchSession(): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.session, z.object({ account: accountDtoSchema }), {
    method: 'GET',
  }).then((result) => result.account);
}

/** Neue Proof-of-Work-Aufgabe für die Registrierung (Pflichtenheft §3). */
export function fetchAltchaChallenge(): Promise<AltchaChallenge> {
  return request(AUTH_ENDPOINTS.altchaChallenge, altchaChallengeSchema, { method: 'GET' });
}

/** Meldet die aktuelle Sitzung ab (Gast-Wartebildschirm, Pflichtenheft §7). */
export function logout(): Promise<null> {
  return request(AUTH_ENDPOINTS.logout, z.null(), { method: 'POST' });
}

// -- Kontoverwaltung (Profil & Einstellungen) -------------------------------
// Jede Aktion liefert das aktualisierte Konto zurück, sodass die Ansicht den
// neuen Stand ohne zweiten Ladeaufruf uebernehmen kann.

const accountEnvelopeSchema = z.object({ account: accountDtoSchema });

/** Ein verknuepftes Anmeldeverfahren wieder trennen (Discord/Steam/Twitch/Passwort). */
export function unlinkMethod(type: AuthMethodType): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.method(type), accountEnvelopeSchema, {
    method: 'DELETE',
  }).then((result) => result.account);
}

/**
 * Das eigene Konto endgueltig loeschen (Lastenheft §3.1, Mockup „Konto loeschen").
 *
 * Bestaetigt wird mit der Anmeldekennung; hat das Konto ein Passwort-Verfahren,
 * verlangt das Backend zusaetzlich das Passwort. Das Owner-Konto laesst sich
 * nicht loeschen - der Aufruf endet dann mit `AUTH_OWNER_PROTECTED`. Die
 * Sitzungs-Cookies raeumt das Backend selbst ab.
 */
export function deleteAccount(input: DeleteAccountInput): Promise<null> {
  return request(AUTH_ENDPOINTS.account, z.null(), {
    method: 'DELETE',
    body: JSON.stringify(input),
  });
}

/**
 * Anzeigenamen des eigenen Kontos aendern (Lastenheft §3.1).
 *
 * Ohne Passwortabfrage: Der Name ist reine Darstellung, keine Kennung. Die
 * Antwort traegt das vollstaendige Konto, damit die Ansicht nicht nachladen
 * muss.
 */
export function updateProfile(input: UpdateProfileInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.account, accountEnvelopeSchema, {
    method: 'PATCH',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Ein Passwort-Verfahren nachtraeglich anlegen (Konto ohne Passwort). */
export function linkPassword(input: LinkPasswordInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.passwordLink, accountEnvelopeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Das eigene Passwort aendern (Pflichtenheft §7). */
export function changePassword(input: ChangePasswordInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.passwordChange, accountEnvelopeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Beginnt die 2FA-Einrichtung und liefert Geheimnis samt `otpauth`-URI. */
export function beginTwoFactorSetup(): Promise<TwoFactorSetupDto> {
  return request(AUTH_ENDPOINTS.twoFactorSetup, twoFactorSetupSchema, { method: 'POST' });
}

/** Schliesst die 2FA-Einrichtung mit dem ersten gueltigen Code ab. */
export function confirmTwoFactor(input: ConfirmTwoFactorInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.twoFactorConfirm, accountEnvelopeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}

/** Deaktiviert 2FA (verlangt Passwort und aktuellen Code). */
export function disableTwoFactor(input: DisableTwoFactorInput): Promise<AccountDto> {
  return request(AUTH_ENDPOINTS.twoFactorDisable, accountEnvelopeSchema, {
    method: 'POST',
    body: JSON.stringify(input),
  }).then((result) => result.account);
}
