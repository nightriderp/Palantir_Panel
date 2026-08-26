/**
 * Externe Identitätsanbieter (Pflichtenheft §7, Lastenheft §3.1).
 *
 * - **Discord** und **Twitch**: OAuth2 Authorization Code mit PKCE (S256)
 * - **Steam**: OpenID 2.0 – kennt weder Scopes noch PKCE
 *
 * **Minimale Scopes** (Pflichtenheft §7 und §18): Discord bekommt ausschließlich
 * `identify` – das liefert Id, Name und Avatar, aber keine E-Mail, keine
 * Gilden, keine Verbindungen. Twitch wird ohne Scope angefragt; `/helix/users`
 * gibt zum eigenen Konto auch dann Id, Login und Anzeigenamen zurück, die
 * E-Mail bliebe hinter `user:read:email` und wird nicht gebraucht. Steam liefert
 * über OpenID nur die SteamID; Profilname und Avatar holt ein zusätzlicher,
 * rein lesender Aufruf mit dem Web-API-Key.
 *
 * Alle Netzaufrufe laufen über ein einspeisbares `fetch`, damit die Abläufe
 * ohne Netzzugang testbar bleiben (CLAUDE.md §4).
 */

import { createHash, randomBytes } from 'node:crypto';
import { type OAuthProvider } from '@palantir/contracts';
import { AuthError } from './errors.js';

/** Was ein Anbieter über ein Konto verrät – mehr wird nicht abgefragt. */
export interface ProviderIdentity {
  readonly provider: OAuthProvider;
  /** Stabile Kennung beim Anbieter (`AuthMethod.providerUserId`). */
  readonly providerUserId: string;
  readonly displayName: string | null;
  readonly avatarUrl: string | null;
}

/** Was während des Redirects zwischengehalten werden muss. */
export interface PendingAuthorization {
  readonly state: string;
  /** PKCE-Verifier; `null` bei Steam (OpenID 2.0 kennt kein PKCE). */
  readonly codeVerifier: string | null;
}

export interface AuthorizationRequest extends PendingAuthorization {
  readonly authorizationUrl: string;
}

/** Query-Parameter der Rückkehr vom Anbieter. */
export type CallbackQuery = Record<string, string | string[] | undefined>;

export interface ProviderAdapter {
  readonly provider: OAuthProvider;
  /** Sind die Zugangsdaten in der zentralen `.env` gesetzt? */
  isConfigured(): boolean;
  /** Baut das Redirect-Ziel und den dazugehörigen Zwischenzustand. */
  buildAuthorization(): AuthorizationRequest;
  /** Prüft die Rückkehr und liefert die Identität. */
  completeLogin(query: CallbackQuery, pending: PendingAuthorization): Promise<ProviderIdentity>;
}

export type FetchLike = typeof globalThis.fetch;

export interface ProviderConfig {
  readonly discord: { clientId?: string; clientSecret?: string; redirectUri?: string };
  readonly twitch: { clientId?: string; clientSecret?: string; redirectUri?: string };
  readonly steam: { apiKey?: string; returnUrl?: string };
}

function readParam(query: CallbackQuery, key: string): string | undefined {
  const value = query[key];

  return Array.isArray(value) ? value[0] : value;
}

/** Zufälliger, undurchsichtiger Wert für `state` und PKCE-Verifier. */
function randomUrlSafe(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'utf8').digest('base64url');
}

// -- OAuth2 mit PKCE (Discord, Twitch) ---------------------------------------

interface OAuth2Endpoints {
  readonly authorizeUrl: string;
  readonly tokenUrl: string;
  readonly scope: string;
}

interface OAuth2Settings {
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
}

/**
 * Holt das Access-Token beim Anbieter ab.
 *
 * `client_secret` geht bewusst in den Body und nicht in die URL – Query-Strings
 * landen in Zugriffslogs.
 */
async function exchangeCode(options: {
  fetchImpl: FetchLike;
  endpoints: OAuth2Endpoints;
  settings: Required<OAuth2Settings>;
  code: string;
  codeVerifier: string;
}): Promise<string> {
  const body = new URLSearchParams({
    client_id: options.settings.clientId,
    client_secret: options.settings.clientSecret,
    grant_type: 'authorization_code',
    code: options.code,
    redirect_uri: options.settings.redirectUri,
    code_verifier: options.codeVerifier,
  });

  const response = await options.fetchImpl(options.endpoints.tokenUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    },
    body: body.toString(),
  });

  if (!response.ok) {
    throw new AuthError('AUTH_PROVIDER_ERROR');
  }

  const payload = (await response.json()) as { access_token?: unknown };

  if (typeof payload.access_token !== 'string') {
    throw new AuthError('AUTH_PROVIDER_ERROR');
  }

  return payload.access_token;
}

function createOAuth2Adapter(options: {
  provider: 'discord' | 'twitch';
  endpoints: OAuth2Endpoints;
  settings: OAuth2Settings;
  fetchImpl: FetchLike;
  loadIdentity(accessToken: string, settings: Required<OAuth2Settings>): Promise<ProviderIdentity>;
}): ProviderAdapter {
  function requireSettings(): Required<OAuth2Settings> {
    const { clientId, clientSecret, redirectUri } = options.settings;

    if (!clientId || !clientSecret || !redirectUri) {
      throw new AuthError('AUTH_PROVIDER_NOT_CONFIGURED');
    }

    return { clientId, clientSecret, redirectUri };
  }

  return {
    provider: options.provider,

    isConfigured() {
      return Boolean(
        options.settings.clientId && options.settings.clientSecret && options.settings.redirectUri,
      );
    },

    buildAuthorization() {
      const settings = requireSettings();
      const state = randomUrlSafe();
      const codeVerifier = randomUrlSafe();

      const params = new URLSearchParams({
        client_id: settings.clientId,
        redirect_uri: settings.redirectUri,
        response_type: 'code',
        scope: options.endpoints.scope,
        state,
        code_challenge: pkceChallenge(codeVerifier),
        code_challenge_method: 'S256',
      });

      return {
        authorizationUrl: `${options.endpoints.authorizeUrl}?${params.toString()}`,
        state,
        codeVerifier,
      };
    },

    async completeLogin(query, pending) {
      // Der Anbieter meldet Abbruch oder Fehler über `error`; das ist kein
      // Serverfehler, sondern ein abgebrochener Login.
      if (readParam(query, 'error')) {
        throw new AuthError('AUTH_OAUTH_STATE_INVALID');
      }

      const code = readParam(query, 'code');
      const state = readParam(query, 'state');

      if (!code || !state || state !== pending.state || !pending.codeVerifier) {
        throw new AuthError('AUTH_OAUTH_STATE_INVALID');
      }

      const settings = requireSettings();
      const accessToken = await exchangeCode({
        fetchImpl: options.fetchImpl,
        endpoints: options.endpoints,
        settings,
        code,
        codeVerifier: pending.codeVerifier,
      });

      return options.loadIdentity(accessToken, settings);
    },
  };
}

function createDiscordAdapter(config: ProviderConfig, fetchImpl: FetchLike): ProviderAdapter {
  return createOAuth2Adapter({
    provider: 'discord',
    settings: config.discord,
    fetchImpl,
    endpoints: {
      authorizeUrl: 'https://discord.com/oauth2/authorize',
      tokenUrl: 'https://discord.com/api/oauth2/token',
      // Minimal: Id, Name und Avatar – keine E-Mail, keine Gilden.
      scope: 'identify',
    },
    async loadIdentity(accessToken) {
      const response = await fetchImpl('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `Bearer ${accessToken}` },
      });

      if (!response.ok) {
        throw new AuthError('AUTH_PROVIDER_ERROR');
      }

      const user = (await response.json()) as {
        id?: unknown;
        username?: unknown;
        global_name?: unknown;
        avatar?: unknown;
      };

      if (typeof user.id !== 'string') {
        throw new AuthError('AUTH_PROVIDER_ERROR');
      }

      const displayName =
        typeof user.global_name === 'string'
          ? user.global_name
          : typeof user.username === 'string'
            ? user.username
            : null;

      return {
        provider: 'discord',
        providerUserId: user.id,
        displayName,
        avatarUrl:
          typeof user.avatar === 'string'
            ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
            : null,
      };
    },
  });
}

function createTwitchAdapter(config: ProviderConfig, fetchImpl: FetchLike): ProviderAdapter {
  return createOAuth2Adapter({
    provider: 'twitch',
    settings: config.twitch,
    fetchImpl,
    endpoints: {
      authorizeUrl: 'https://id.twitch.tv/oauth2/authorize',
      tokenUrl: 'https://id.twitch.tv/oauth2/token',
      // Bewusst leer: `/helix/users` liefert zum eigenen Konto auch ohne Scope
      // Id, Login und Anzeigenamen. Die E-Mail läge hinter `user:read:email`
      // und wird nicht gebraucht (Pflichtenheft §7 – minimale Scopes).
      scope: '',
    },
    async loadIdentity(accessToken, settings) {
      const response = await fetchImpl('https://api.twitch.tv/helix/users', {
        headers: {
          authorization: `Bearer ${accessToken}`,
          'client-id': settings.clientId,
        },
      });

      if (!response.ok) {
        throw new AuthError('AUTH_PROVIDER_ERROR');
      }

      const payload = (await response.json()) as {
        data?: { id?: unknown; display_name?: unknown; profile_image_url?: unknown }[];
      };
      const user = payload.data?.[0];

      if (!user || typeof user.id !== 'string') {
        throw new AuthError('AUTH_PROVIDER_ERROR');
      }

      return {
        provider: 'twitch',
        providerUserId: user.id,
        displayName: typeof user.display_name === 'string' ? user.display_name : null,
        avatarUrl: typeof user.profile_image_url === 'string' ? user.profile_image_url : null,
      };
    },
  });
}

// -- Steam (OpenID 2.0) -------------------------------------------------------

const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login';
const STEAM_CLAIMED_ID_PREFIX = 'https://steamcommunity.com/openid/id/';

/**
 * Steam spricht OpenID 2.0 und kennt weder Scopes noch PKCE.
 *
 * Absicherung des Rücksprungs: Der `state` wird an `openid.return_to` gehängt.
 * Steam signiert diesen Wert mit und schickt ihn zurück; er wird dann sowohl
 * gegen das zwischengehaltene Cookie geprüft als auch – zusammen mit allen
 * anderen `openid.*`-Feldern – über `check_authentication` von Steam selbst
 * bestätigt. Damit ist eine untergeschobene Rückkehr ausgeschlossen, obwohl es
 * keinen eigenständigen `state`-Parameter gibt.
 */
function createSteamAdapter(config: ProviderConfig, fetchImpl: FetchLike): ProviderAdapter {
  function requireSettings(): { apiKey: string; returnUrl: string } {
    const { apiKey, returnUrl } = config.steam;

    if (!apiKey || !returnUrl) {
      throw new AuthError('AUTH_PROVIDER_NOT_CONFIGURED');
    }

    return { apiKey, returnUrl };
  }

  async function loadProfile(steamId: string, apiKey: string): Promise<ProviderIdentity> {
    const url = new URL('https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('steamids', steamId);

    const fallback: ProviderIdentity = {
      provider: 'steam',
      providerUserId: steamId,
      displayName: null,
      avatarUrl: null,
    };

    // Der Profilabruf ist reine Anzeige-Zusatzinformation. Scheitert er, ist der
    // Login trotzdem gültig – die Identität steht bereits über OpenID fest.
    try {
      const response = await fetchImpl(url.toString());

      if (!response.ok) {
        return fallback;
      }

      const payload = (await response.json()) as {
        response?: { players?: { personaname?: unknown; avatarfull?: unknown }[] };
      };
      const player = payload.response?.players?.[0];

      if (!player) {
        return fallback;
      }

      return {
        provider: 'steam',
        providerUserId: steamId,
        displayName: typeof player.personaname === 'string' ? player.personaname : null,
        avatarUrl: typeof player.avatarfull === 'string' ? player.avatarfull : null,
      };
    } catch {
      return fallback;
    }
  }

  return {
    provider: 'steam',

    isConfigured() {
      return Boolean(config.steam.apiKey && config.steam.returnUrl);
    },

    buildAuthorization() {
      const settings = requireSettings();
      const state = randomUrlSafe();

      const returnTo = new URL(settings.returnUrl);
      returnTo.searchParams.set('state', state);

      const params = new URLSearchParams({
        'openid.ns': 'http://specs.openid.net/auth/2.0',
        'openid.mode': 'checkid_setup',
        'openid.return_to': returnTo.toString(),
        'openid.realm': returnTo.origin,
        'openid.identity': 'http://specs.openid.net/auth/2.0/identifier_select',
        'openid.claimed_id': 'http://specs.openid.net/auth/2.0/identifier_select',
      });

      return {
        authorizationUrl: `${STEAM_OPENID_ENDPOINT}?${params.toString()}`,
        state,
        codeVerifier: null,
      };
    },

    async completeLogin(query, pending) {
      const settings = requireSettings();

      if (readParam(query, 'state') !== pending.state) {
        throw new AuthError('AUTH_OAUTH_STATE_INVALID');
      }

      const claimedId = readParam(query, 'openid.claimed_id');

      if (!claimedId?.startsWith(STEAM_CLAIMED_ID_PREFIX)) {
        throw new AuthError('AUTH_OAUTH_STATE_INVALID');
      }

      // Alle `openid.*`-Felder unverändert an Steam zurückschicken; nur `mode`
      // wird ersetzt. Steam bestätigt damit die eigene Signatur.
      const verification = new URLSearchParams();

      for (const [key, value] of Object.entries(query)) {
        if (!key.startsWith('openid.')) {
          continue;
        }

        const single = Array.isArray(value) ? value[0] : value;

        if (typeof single === 'string') {
          verification.set(key, single);
        }
      }

      verification.set('openid.mode', 'check_authentication');

      const response = await fetchImpl(STEAM_OPENID_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: verification.toString(),
      });

      if (!response.ok) {
        throw new AuthError('AUTH_PROVIDER_ERROR');
      }

      const body = await response.text();

      if (!/^is_valid\s*:\s*true$/m.test(body)) {
        throw new AuthError('AUTH_OAUTH_STATE_INVALID');
      }

      const steamId = claimedId.slice(STEAM_CLAIMED_ID_PREFIX.length);

      if (!/^\d{17}$/.test(steamId)) {
        throw new AuthError('AUTH_PROVIDER_ERROR');
      }

      return loadProfile(steamId, settings.apiKey);
    },
  };
}

/** Alle Anbieter, nach Name ansprechbar. */
export type ProviderRegistry = Readonly<Record<OAuthProvider, ProviderAdapter>>;

export function createProviderRegistry(
  config: ProviderConfig,
  fetchImpl: FetchLike = globalThis.fetch,
): ProviderRegistry {
  return {
    discord: createDiscordAdapter(config, fetchImpl),
    twitch: createTwitchAdapter(config, fetchImpl),
    steam: createSteamAdapter(config, fetchImpl),
  };
}
