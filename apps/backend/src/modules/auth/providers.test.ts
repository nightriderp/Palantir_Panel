import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { isAuthError } from './errors.js';
import { type FetchLike, type ProviderConfig, createProviderRegistry } from './providers.js';

const CONFIG: ProviderConfig = {
  discord: {
    clientId: 'discord-id',
    clientSecret: 'discord-secret',
    redirectUri: 'https://api.example.tld/auth/discord/callback',
  },
  twitch: {
    clientId: 'twitch-id',
    clientSecret: 'twitch-secret',
    redirectUri: 'https://api.example.tld/auth/twitch/callback',
  },
  steam: { apiKey: 'steam-key', returnUrl: 'https://api.example.tld/auth/steam/callback' },
};

/** Antwortet je nach angefragter Adresse – ersetzt das Netz im Test. */
function fakeFetch(
  routes: { match: string; status?: number; json?: unknown; text?: string }[],
): FetchLike & { calls: { url: string; body?: string }[] } {
  const calls: { url: string; body?: string }[] = [];

  const impl = (async (input: unknown, init?: { body?: unknown }) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined });

    const route = routes.find((candidate) => url.includes(candidate.match));

    if (!route) {
      return {
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
        text: () => Promise.resolve(''),
      };
    }

    return {
      ok: (route.status ?? 200) < 400,
      status: route.status ?? 200,
      json: () => Promise.resolve(route.json ?? {}),
      text: () => Promise.resolve(route.text ?? ''),
    };
  }) as unknown as FetchLike & { calls: { url: string; body?: string }[] };

  impl.calls = calls;

  return impl;
}

async function expectErrorCode(work: Promise<unknown>, code: string): Promise<void> {
  await expect(work).rejects.toSatisfy(
    (error: unknown) => isAuthError(error) && error.code === code,
    `Fehlercode ${code}`,
  );
}

describe('Nicht eingerichtete Anbieter (Pflichtenheft §12.1)', () => {
  it('meldet fehlende Zugangsdaten als eigenen Fehlercode', async () => {
    const registry = createProviderRegistry({ discord: {}, twitch: {}, steam: {} }, fakeFetch([]));

    expect(registry.discord.isConfigured()).toBe(false);
    expect(registry.steam.isConfigured()).toBe(false);
    expect(() => registry.discord.buildAuthorization()).toThrow();
    await expectErrorCode(
      registry.twitch.completeLogin({ code: 'x', state: 's' }, { state: 's', codeVerifier: 'v' }),
      'AUTH_PROVIDER_NOT_CONFIGURED',
    );
  });
});

describe('Discord (OAuth2 mit PKCE, Pflichtenheft §7)', () => {
  it('fragt ausschließlich den Scope `identify` an', () => {
    const registry = createProviderRegistry(CONFIG, fakeFetch([]));
    const url = new URL(registry.discord.buildAuthorization().authorizationUrl);

    // Minimale Scopes: keine E-Mail, keine Gilden, keine Verbindungen.
    expect(url.searchParams.get('scope')).toBe('identify');
    expect(url.searchParams.get('client_id')).toBe('discord-id');
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('sichert den Rücksprung mit state und PKCE (S256)', () => {
    const registry = createProviderRegistry(CONFIG, fakeFetch([]));
    const authorization = registry.discord.buildAuthorization();
    const url = new URL(authorization.authorizationUrl);

    expect(url.searchParams.get('state')).toBe(authorization.state);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(
      createHash('sha256')
        .update(authorization.codeVerifier ?? '', 'utf8')
        .digest('base64url'),
    );
  });

  it('erzeugt bei jedem Start neue Zufallswerte', () => {
    const registry = createProviderRegistry(CONFIG, fakeFetch([]));

    expect(registry.discord.buildAuthorization().state).not.toBe(
      registry.discord.buildAuthorization().state,
    );
  });

  it('tauscht den Code ein und liest die Identität aus', async () => {
    const fetchImpl = fakeFetch([
      { match: 'oauth2/token', json: { access_token: 'zugriffstoken' } },
      {
        match: 'users/@me',
        json: { id: '1234567890', username: 'spieler', global_name: 'Spieler', avatar: 'abc' },
      },
    ]);
    const registry = createProviderRegistry(CONFIG, fetchImpl);

    const identity = await registry.discord.completeLogin(
      { code: 'der-code', state: 'der-state' },
      { state: 'der-state', codeVerifier: 'der-verifier' },
    );

    expect(identity).toEqual({
      provider: 'discord',
      providerUserId: '1234567890',
      displayName: 'Spieler',
      avatarUrl: 'https://cdn.discordapp.com/avatars/1234567890/abc.png',
    });
  });

  it('schickt das Client-Secret im Body, nicht in der URL', async () => {
    const fetchImpl = fakeFetch([
      { match: 'oauth2/token', json: { access_token: 'zugriffstoken' } },
      { match: 'users/@me', json: { id: '1', username: 'x' } },
    ]);
    const registry = createProviderRegistry(CONFIG, fetchImpl);

    await registry.discord.completeLogin(
      { code: 'der-code', state: 's' },
      { state: 's', codeVerifier: 'v' },
    );

    const tokenCall = fetchImpl.calls.find((call) => call.url.includes('oauth2/token'));

    // Query-Strings landen in Zugriffslogs, Bodies nicht.
    expect(tokenCall?.url).not.toContain('discord-secret');
    expect(tokenCall?.body).toContain('client_secret=discord-secret');
    expect(tokenCall?.body).toContain('code_verifier=v');
  });

  it('lehnt eine Rückkehr mit falschem state ab', async () => {
    const registry = createProviderRegistry(CONFIG, fakeFetch([]));

    await expectErrorCode(
      registry.discord.completeLogin(
        { code: 'c', state: 'untergeschoben' },
        { state: 'echt', codeVerifier: 'v' },
      ),
      'AUTH_OAUTH_STATE_INVALID',
    );
  });

  it('behandelt einen Abbruch beim Anbieter nicht als Serverfehler', async () => {
    const registry = createProviderRegistry(CONFIG, fakeFetch([]));

    await expectErrorCode(
      registry.discord.completeLogin(
        { error: 'access_denied', state: 's' },
        { state: 's', codeVerifier: 'v' },
      ),
      'AUTH_OAUTH_STATE_INVALID',
    );
  });

  it('meldet eine unbrauchbare Anbieter-Antwort als Anbieter-Fehler', async () => {
    const registry = createProviderRegistry(
      CONFIG,
      fakeFetch([{ match: 'oauth2/token', json: { fehler: 'kein token' } }]),
    );

    await expectErrorCode(
      registry.discord.completeLogin({ code: 'c', state: 's' }, { state: 's', codeVerifier: 'v' }),
      'AUTH_PROVIDER_ERROR',
    );
  });
});

describe('Twitch (Pflichtenheft §7)', () => {
  it('fragt gar keinen Scope an', () => {
    const registry = createProviderRegistry(CONFIG, fakeFetch([]));
    const url = new URL(registry.twitch.buildAuthorization().authorizationUrl);

    // `/helix/users` liefert das eigene Konto auch ohne Scope; die E-Mail
    // läge hinter `user:read:email` und wird nicht gebraucht.
    expect(url.searchParams.get('scope')).toBe('');
  });

  it('liest Id und Anzeigenamen aus /helix/users', async () => {
    const fetchImpl = fakeFetch([
      { match: 'id.twitch.tv/oauth2/token', json: { access_token: 'zugriffstoken' } },
      {
        match: 'helix/users',
        json: {
          data: [
            { id: '99', display_name: 'Streamer', profile_image_url: 'https://bild.example/x.png' },
          ],
        },
      },
    ]);
    const registry = createProviderRegistry(CONFIG, fetchImpl);

    const identity = await registry.twitch.completeLogin(
      { code: 'c', state: 's' },
      { state: 's', codeVerifier: 'v' },
    );

    expect(identity.providerUserId).toBe('99');
    expect(identity.displayName).toBe('Streamer');
    expect(fetchImpl.calls.some((call) => call.url.includes('helix/users'))).toBe(true);
  });
});

describe('Steam (OpenID 2.0, Pflichtenheft §7)', () => {
  const steamId = '76561198000000000';

  it('hängt den state an die Rücksprung-Adresse, weil OpenID keinen kennt', () => {
    const registry = createProviderRegistry(CONFIG, fakeFetch([]));
    const authorization = registry.steam.buildAuthorization();
    const url = new URL(authorization.authorizationUrl);
    const returnTo = new URL(url.searchParams.get('openid.return_to') ?? '');

    expect(returnTo.searchParams.get('state')).toBe(authorization.state);
    expect(url.searchParams.get('openid.mode')).toBe('checkid_setup');
    // OpenID 2.0 kennt kein PKCE.
    expect(authorization.codeVerifier).toBeNull();
  });

  it('bestätigt die Rückkehr über check_authentication bei Steam', async () => {
    const fetchImpl = fakeFetch([
      { match: 'openid/login', text: 'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n' },
      {
        match: 'GetPlayerSummaries',
        json: {
          response: {
            players: [{ personaname: 'SteamNutzer', avatarfull: 'https://bild.example/a.jpg' }],
          },
        },
      },
    ]);
    const registry = createProviderRegistry(CONFIG, fetchImpl);

    const identity = await registry.steam.completeLogin(
      {
        state: 's',
        'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}`,
        'openid.sig': 'signatur',
      },
      { state: 's', codeVerifier: null },
    );

    expect(identity).toEqual({
      provider: 'steam',
      providerUserId: steamId,
      displayName: 'SteamNutzer',
      avatarUrl: 'https://bild.example/a.jpg',
    });

    const verification = fetchImpl.calls.find((call) => call.url.includes('openid/login'));
    expect(verification?.body).toContain('openid.mode=check_authentication');
    expect(verification?.body).toContain('openid.sig=signatur');
  });

  it('lehnt eine Rückkehr ab, die Steam nicht bestätigt', async () => {
    const registry = createProviderRegistry(
      CONFIG,
      fakeFetch([{ match: 'openid/login', text: 'is_valid:false\n' }]),
    );

    await expectErrorCode(
      registry.steam.completeLogin(
        { state: 's', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}` },
        { state: 's', codeVerifier: null },
      ),
      'AUTH_OAUTH_STATE_INVALID',
    );
  });

  it('lehnt eine fremde claimed_id ab', async () => {
    const registry = createProviderRegistry(
      CONFIG,
      fakeFetch([{ match: 'openid/login', text: 'is_valid:true\n' }]),
    );

    await expectErrorCode(
      registry.steam.completeLogin(
        { state: 's', 'openid.claimed_id': 'https://boese.example/openid/id/1' },
        { state: 's', codeVerifier: null },
      ),
      'AUTH_OAUTH_STATE_INVALID',
    );
  });

  it('meldet sich auch an, wenn der Profilabruf scheitert', async () => {
    const registry = createProviderRegistry(
      CONFIG,
      fakeFetch([
        { match: 'openid/login', text: 'is_valid:true\n' },
        { match: 'GetPlayerSummaries', status: 500 },
      ]),
    );

    const identity = await registry.steam.completeLogin(
      { state: 's', 'openid.claimed_id': `https://steamcommunity.com/openid/id/${steamId}` },
      { state: 's', codeVerifier: null },
    );

    // Die Identität steht über OpenID bereits fest; der Profilabruf ist nur Zierde.
    expect(identity.providerUserId).toBe(steamId);
    expect(identity.displayName).toBeNull();
  });
});
