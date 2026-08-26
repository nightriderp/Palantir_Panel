import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  createRefreshToken,
  hashRefreshToken,
  parseDurationMs,
  signAccessToken,
  signTwoFactorToken,
  verifyAccessToken,
  verifyTwoFactorToken,
} from './tokens.js';

const secret = 'test-jwt-secret-mit-ausreichender-laenge';
const NOW = 1_700_000_000_000;

describe('Zeitangaben aus der .env', () => {
  it('versteht Sekunden, Minuten, Stunden und Tage', () => {
    expect(parseDurationMs('900s')).toBe(900_000);
    expect(parseDurationMs('15m')).toBe(900_000);
    expect(parseDurationMs('12h')).toBe(43_200_000);
    expect(parseDurationMs('30d')).toBe(2_592_000_000);
  });

  it('bricht bei unlesbaren Angaben ab, statt still zurückzufallen', () => {
    // Ein stiller Standardwert wäre bei Token-Lebensdauern die gefährlichere
    // Variante.
    expect(() => parseDurationMs('15')).toThrow();
    expect(() => parseDurationMs('viertelstunde')).toThrow();
    expect(() => parseDurationMs('')).toThrow();
  });
});

describe('Access-Token (Pflichtenheft §7)', () => {
  it('enthält Konto und Sitzung und lässt sich zurücklesen', async () => {
    // Hier bewusst die echte Uhrzeit: `jwtVerify` prüft `exp` gegen sie, ein
    // fester Zeitpunkt in der Vergangenheit wäre sofort abgelaufen.
    const token = await signAccessToken(
      { userId: 'u-1', sessionId: 's-1' },
      { secret, ttlMs: 900_000 },
    );

    expect(await verifyAccessToken(token, { secret })).toEqual({
      userId: 'u-1',
      sessionId: 's-1',
    });
  });

  it('trägt keine Rollen oder Permissions', async () => {
    // Sonst würde ein Rechteentzug erst mit dem Ablauf des Tokens greifen.
    const token = await signAccessToken(
      { userId: 'u-1', sessionId: 's-1' },
      { secret, ttlMs: 900_000 },
      NOW,
    );
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;

    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'sid', 'sub']);
  });

  it('lehnt ein Token mit fremdem Schlüssel ab', async () => {
    const token = await signAccessToken(
      { userId: 'u-1', sessionId: 's-1' },
      { secret, ttlMs: 900_000 },
    );

    expect(await verifyAccessToken(token, { secret: 'anderer-schluessel' })).toBeNull();
  });

  it('lehnt ein abgelaufenes Token ab', async () => {
    const token = await signAccessToken(
      { userId: 'u-1', sessionId: 's-1' },
      { secret, ttlMs: 1000 },
      // Weit in der Vergangenheit ausgestellt.
      NOW - 86_400_000,
    );

    expect(await verifyAccessToken(token, { secret })).toBeNull();
  });

  it('lehnt ein Token ohne Signatur ab (Algorithmus-Verwechslung)', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 'u-1', sid: 's-1' })).toString('base64url');

    expect(await verifyAccessToken(`${header}.${payload}.`, { secret })).toBeNull();
  });

  it('lehnt Unsinn ab, ohne zu scheitern', async () => {
    expect(await verifyAccessToken('kein-jwt', { secret })).toBeNull();
    expect(await verifyAccessToken('', { secret })).toBeNull();
  });
});

describe('2FA-Zwischen-Token (Pflichtenheft §7)', () => {
  const TTL = 300_000; // 5 Minuten, wie TWO_FACTOR_TOKEN_TTL

  it('gilt unabhängig von der echten Uhrzeit, wenn dieselbe Zeitquelle geprüft wird', async () => {
    // Der eigentliche Punkt dieses Tests: `NOW` liegt Jahre in der
    // Vergangenheit. Würde beim Prüfen die Systemuhr herangezogen, wäre der
    // Token immer abgelaufen – genau dieser Fehler ließ den zweiten
    // Anmeldeschritt ab einer bestimmten Tageszeit dauerhaft scheitern.
    const { token } = await signTwoFactorToken('u-1', { secret, ttlMs: TTL }, NOW);

    expect(await verifyTwoFactorToken(token, { secret }, NOW + 60_000)).toBe('u-1');
  });

  it('lehnt ihn nach Ablauf der Frist ab', async () => {
    const { token } = await signTwoFactorToken('u-1', { secret, ttlMs: TTL }, NOW);

    expect(await verifyTwoFactorToken(token, { secret }, NOW + TTL + 1000)).toBeNull();
  });

  it('prüft ohne Zeitangabe weiterhin gegen die Systemuhr', async () => {
    // Im Betrieb gibt es keine eingespeiste Uhr – der Vorgabewert muss also
    // ein altes Token weiterhin zurückweisen.
    const { token } = await signTwoFactorToken('u-1', { secret, ttlMs: TTL }, NOW);

    expect(await verifyTwoFactorToken(token, { secret })).toBeNull();
  });

  it('akzeptiert kein Access-Token an dieser Stelle', async () => {
    const fremd = await signAccessToken(
      { userId: 'u-1', sessionId: 's-1' },
      { secret, ttlMs: TTL },
    );

    expect(await verifyTwoFactorToken(fremd, { secret })).toBeNull();
  });
});

describe('Refresh-Token (Pflichtenheft §7)', () => {
  it('ist opak und bei jedem Aufruf neu', () => {
    const first = createRefreshToken();
    const second = createRefreshToken();

    expect(first.token).not.toBe(second.token);
    // 32 Zufallsbytes ergeben 43 Base64url-Zeichen.
    expect(first.token).toHaveLength(43);
  });

  it('wird als SHA-256 gespeichert, nicht im Klartext', () => {
    const { token, hash } = createRefreshToken();

    expect(hash).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hash).not.toContain(token);
    expect(hashRefreshToken(token)).toBe(hash);
  });
});
