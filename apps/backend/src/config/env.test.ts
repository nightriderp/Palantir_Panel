import { describe, expect, it } from 'vitest';
import { adressenAbleiten, leereWerteAlsUngesetzt, umgebungLesen } from './env.js';
import { cookieDomainAbleiten, cookieDomainUmfasstSpielhosts } from './cookie-domain.js';
import { createTrustProxy, isTrustedProxy } from './trusted-proxy.js';
import { parseSourceAllowlist } from '../modules/server-orchestration/source-allowlist.js';

/**
 * Die Ableitung ist bewusst getestet: Ein Domainwechsel, bei dem eine
 * OAuth-Redirect-URI nicht mitwandert, bricht den Login erst zur Laufzeit und
 * ohne verwertbare Fehlermeldung – der Provider lehnt dann schlicht ab.
 */

// Nur die Felder, die die Ableitung liest. Der Rest des Schemas ist hier
// unerheblich; die Signatur verlangt ihn nicht.
type Eingabe = Parameters<typeof adressenAbleiten>[0];

function eingabe(teil: Partial<Eingabe>): Eingabe {
  return { PALANTIR_DOMAIN: 'beispiel.tld', ...teil } as Eingabe;
}

describe('Adressableitung aus PALANTIR_DOMAIN', () => {
  it('leitet alle Adressen aus der Domain ab, wenn nichts gesetzt ist', () => {
    const e = adressenAbleiten(eingabe({}));

    expect(e.PUBLIC_WEB_URL).toBe('https://beispiel.tld');
    expect(e.PUBLIC_API_URL).toBe('https://api.beispiel.tld');
    expect(e.COOKIE_DOMAIN).toBe('beispiel.tld');
    expect(e.DISCORD_REDIRECT_URI).toBe('https://api.beispiel.tld/auth/discord/callback');
    expect(e.TWITCH_REDIRECT_URI).toBe('https://api.beispiel.tld/auth/twitch/callback');
    expect(e.STEAM_RETURN_URL).toBe('https://api.beispiel.tld/auth/steam/callback');
  });

  it('ein Domainwechsel zieht jede abgeleitete Adresse mit', () => {
    const vorher = adressenAbleiten(eingabe({}));
    const nachher = adressenAbleiten(eingabe({ PALANTIR_DOMAIN: 'andere.example' }));

    for (const schlüssel of [
      'PUBLIC_WEB_URL',
      'PUBLIC_API_URL',
      'COOKIE_DOMAIN',
      'DISCORD_REDIRECT_URI',
      'TWITCH_REDIRECT_URI',
      'STEAM_RETURN_URL',
    ] as const) {
      expect(nachher[schlüssel]).not.toBe(vorher[schlüssel]);
      expect(nachher[schlüssel]).toContain('andere.example');
    }
  });

  /**
   * Belegt den entfernten CORS-Rückfall (Audit W3-2, backend-core-09):
   * `server.ts` hatte für „PUBLIC_WEB_URL nicht gesetzt" einen Zweig
   * `origin: false`. Die Ableitung füllt den Wert aber immer – der Zweig war
   * unerreichbar und der Kommentar daneben falsch.
   */
  it('PUBLIC_WEB_URL ist nach der Ableitung nie leer', () => {
    for (const domain of ['beispiel.tld', 'palantir.local']) {
      const e = adressenAbleiten(eingabe({ PALANTIR_DOMAIN: domain }));

      expect(e.PUBLIC_WEB_URL).toBeTruthy();
      expect(e.PUBLIC_WEB_URL).toBe(`https://${domain}`);
    }
  });

  it('ausdrücklich gesetzte Werte bleiben unangetastet', () => {
    const e = adressenAbleiten(
      eingabe({
        PUBLIC_WEB_URL: 'http://localhost:3000',
        PUBLIC_API_URL: 'http://localhost:4000',
        COOKIE_DOMAIN: 'localhost',
        STEAM_RETURN_URL: 'https://sonderfall.example/rueckkehr',
      }),
    );

    expect(e.PUBLIC_WEB_URL).toBe('http://localhost:3000');
    expect(e.COOKIE_DOMAIN).toBe('localhost');
    expect(e.STEAM_RETURN_URL).toBe('https://sonderfall.example/rueckkehr');
    // Nicht gesetzte Redirects folgen der gesetzten API-Adresse, nicht der Domain.
    expect(e.DISCORD_REDIRECT_URI).toBe('http://localhost:4000/auth/discord/callback');
  });

  it('behandelt leere Einträge der .env als nicht gesetzt', () => {
    // `SCHLUESSEL=` in der .env liefert über dotenv einen leeren String. Ohne
    // Normalisierung greift weder ein Vorgabewert noch die Ableitung, und
    // `z.string().url()` weist den leeren String zurück – die Anwendung käme
    // dann mit der ausgelieferten Vorlage gar nicht hoch.
    const normalisiert = leereWerteAlsUngesetzt({
      PALANTIR_DOMAIN: 'beispiel.tld',
      PUBLIC_API_URL: '',
      DISCORD_REDIRECT_URI: '   ',
      COOKIE_DOMAIN: 'gesetzt.example',
    });

    expect(normalisiert.PUBLIC_API_URL).toBeUndefined();
    expect(normalisiert.DISCORD_REDIRECT_URI).toBeUndefined();
    expect(normalisiert.COOKIE_DOMAIN).toBe('gesetzt.example');

    const e = adressenAbleiten(normalisiert as unknown as Eingabe);
    expect(e.PUBLIC_API_URL).toBe('https://api.beispiel.tld');
    expect(e.DISCORD_REDIRECT_URI).toBe('https://api.beispiel.tld/auth/discord/callback');
    expect(e.COOKIE_DOMAIN).toBe('gesetzt.example');
  });

  it('leitet die Cookie-Domain aus den Panel-Adressen ab, nicht mehr aus der Domain', () => {
    // Empfohlener Aufbau (security-matrix-03): Panel und API eine Ebene unter
    // der Basis-Domain. Die Cookies gelten dann für `panel.beispiel.tld` und
    // dessen Subdomains – die Spielserver-Hosts `<sub>.beispiel.tld` liegen
    // daneben und bekommen sie nicht mehr.
    const e = adressenAbleiten(
      eingabe({
        PUBLIC_WEB_URL: 'https://panel.beispiel.tld',
        PUBLIC_API_URL: 'https://api.panel.beispiel.tld',
      }),
    );

    expect(e.COOKIE_DOMAIN).toBe('panel.beispiel.tld');
  });

  it('lässt die Cookie-Domain weg, wenn Web und API auf demselben Host liegen', () => {
    // Entwicklung: `localhost:3000` und `localhost:4000`. Bisher stand hier die
    // Basis-Domain (`palantir.local`) – ein Cookie, das der Browser gar nicht
    // annimmt.
    const e = adressenAbleiten(
      eingabe({
        PUBLIC_WEB_URL: 'http://localhost:3000',
        PUBLIC_API_URL: 'http://localhost:4000',
      }),
    );

    expect(e.COOKIE_DOMAIN).toBeUndefined();
  });

  it('entfernt abschließende Schrägstriche, damit keine doppelten entstehen', () => {
    const e = adressenAbleiten(
      eingabe({
        PUBLIC_API_URL: 'https://api.beispiel.tld/',
        PUBLIC_WEB_URL: 'https://beispiel.tld//',
      }),
    );

    expect(e.PUBLIC_API_URL).toBe('https://api.beispiel.tld');
    expect(e.PUBLIC_WEB_URL).toBe('https://beispiel.tld');
    expect(e.TWITCH_REDIRECT_URI).toBe('https://api.beispiel.tld/auth/twitch/callback');
  });
});

/**
 * Geltungsbereich der Sitzungs-Cookies (Audit W2-6, security-matrix-03).
 */
describe('Cookie-Domain', () => {
  it('nimmt bei getrennten Hosts das gemeinsame Suffix', () => {
    expect(cookieDomainAbleiten('https://beispiel.tld', 'https://api.beispiel.tld')).toBe(
      'beispiel.tld',
    );
    expect(
      cookieDomainAbleiten('https://panel.beispiel.tld', 'https://api.panel.beispiel.tld'),
    ).toBe('panel.beispiel.tld');
  });

  it('gibt nichts zurück, wo kein sinnvoller gemeinsamer Bereich bleibt', () => {
    // Gleicher Host, unterschiedlicher Port → host-only.
    expect(cookieDomainAbleiten('http://localhost:3000', 'http://localhost:4000')).toBeUndefined();
    // Nur ein gemeinsames Label wäre eine öffentliche Endung.
    expect(cookieDomainAbleiten('https://a.tld', 'https://b.tld')).toBeUndefined();
    // Unlesbare Adresse.
    expect(cookieDomainAbleiten('kein-url', 'https://api.beispiel.tld')).toBeUndefined();
  });

  it('erkennt, wenn die Cookie-Domain die Spielserver-Hosts mit abdeckt', () => {
    // Spielserver liegen unter `<sub>.<PALANTIR_DOMAIN>`.
    expect(cookieDomainUmfasstSpielhosts('beispiel.tld', 'beispiel.tld')).toBe(true);
    expect(cookieDomainUmfasstSpielhosts('.beispiel.tld', 'beispiel.tld')).toBe(true);
    expect(cookieDomainUmfasstSpielhosts('beispiel.tld', 'spiele.beispiel.tld')).toBe(true);
    // Panel eine Ebene tiefer: die Spiel-Hosts liegen daneben, nicht darunter.
    expect(cookieDomainUmfasstSpielhosts('panel.beispiel.tld', 'beispiel.tld')).toBe(false);
    expect(cookieDomainUmfasstSpielhosts(undefined, 'beispiel.tld')).toBe(false);
  });
});

/**
 * Proxy-Vertrauen (Audit W2-6, backend-core-10): reine Ableitung, ohne Server.
 */
describe('trustProxy-Ableitung', () => {
  const liste = parseSourceAllowlist('127.0.0.1/8,::1/128,172.16.0.0/12,192.168.0.0/16');

  it('vertraut den eigenen Proxy-Bereichen', () => {
    expect(isTrustedProxy(liste, '172.18.0.4')).toBe(true);
    expect(isTrustedProxy(liste, '127.0.0.1')).toBe(true);
    expect(isTrustedProxy(liste, '::1')).toBe(true);
    // Traefik im Docker-Netz meldet sich je nach Bindung als IPv4-mapped.
    expect(isTrustedProxy(liste, '::ffff:172.18.0.4')).toBe(true);
  });

  it('vertraut dem WireGuard-Netz und fremden Adressen nicht', () => {
    // Genau der Fall aus backend-core-10: Der Backend-Port hängt zusätzlich an
    // der Tunnel-Adresse, ein Peer darf `request.ip` nicht setzen können.
    expect(isTrustedProxy(liste, '10.10.0.2')).toBe(false);
    expect(isTrustedProxy(liste, '203.0.113.10')).toBe(false);
    expect(isTrustedProxy(liste, undefined)).toBe(false);
    expect(isTrustedProxy(liste, 'kein-ip')).toBe(false);
  });

  it('vertraut bei leerer Liste niemandem', () => {
    // Anders als die Agent-Allowlist, wo „leer" für „keine Prüfung" steht.
    expect(isTrustedProxy(parseSourceAllowlist(''), '172.18.0.4')).toBe(false);
  });

  it('liefert eine Funktion in der Form, die Fastify erwartet', () => {
    const trustProxy = createTrustProxy(liste);

    expect(trustProxy('172.18.0.4')).toBe(true);
    expect(trustProxy('10.10.0.2')).toBe(false);
  });
});

/**
 * Prüfungen des Schemas (Audit W2-6, security-matrix-08, spec-pflichtenheft-10).
 */
describe('Umgebungsschema', () => {
  const fehlerPfade = (ergebnis: ReturnType<typeof umgebungLesen>): string[] =>
    ergebnis.success ? [] : ergebnis.error.issues.map((issue) => issue.path.join('.'));

  it('nimmt die ausgelieferte Vorlage ohne gesetzte Geheimnisse an', () => {
    // `.env.example` liefert die Geheimnisse leer aus; sie sind erst beim
    // Registrieren des Auth-Moduls Pflicht (`requireAuthSecrets`).
    const ergebnis = umgebungLesen({ JWT_SECRET: '', CSRF_SECRET: '', ALTCHA_HMAC_KEY: '' });

    expect(ergebnis.success).toBe(true);
  });

  it('weist zu kurze Geheimnisse ab', () => {
    const ergebnis = umgebungLesen({
      JWT_SECRET: 'test',
      CSRF_SECRET: 'kurz',
      ALTCHA_HMAC_KEY: 'auch-zu-kurz',
      AGENT_TOKEN: 'CHANGE_ME',
    });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toEqual(
      expect.arrayContaining(['JWT_SECRET', 'CSRF_SECRET', 'ALTCHA_HMAC_KEY', 'AGENT_TOKEN']),
    );
  });

  it('nimmt Geheimnisse ab 32 Zeichen an', () => {
    const geheimnis = 'x'.repeat(32);
    const ergebnis = umgebungLesen({
      JWT_SECRET: geheimnis,
      CSRF_SECRET: geheimnis,
      ALTCHA_HMAC_KEY: geheimnis,
      AGENT_TOKEN: geheimnis,
    });

    expect(ergebnis.success).toBe(true);
  });

  it('lehnt COOKIE_SECURE=false in Produktion ab', () => {
    const ergebnis = umgebungLesen({ NODE_ENV: 'production', COOKIE_SECURE: 'false' });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toContain('COOKIE_SECURE');
  });

  it('lässt COOKIE_SECURE=false außerhalb der Produktion zu', () => {
    const ergebnis = umgebungLesen({ NODE_ENV: 'development', COOKIE_SECURE: 'false' });

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.COOKIE_SECURE).toBe(false);
  });

  it('liest die Proxy-Vertrauensliste und hält das WireGuard-Netz heraus', () => {
    const ergebnis = umgebungLesen({});

    expect(ergebnis.success).toBe(true);

    if (ergebnis.success) {
      const liste = ergebnis.data.TRUSTED_PROXY_ADDRESSES;

      expect(isTrustedProxy(liste, '172.18.0.4')).toBe(true);
      expect(isTrustedProxy(liste, '10.10.0.2')).toBe(false);
    }
  });

  it('bricht bei einer unlesbaren Proxy-Adresse ab, statt still weniger zu prüfen', () => {
    const ergebnis = umgebungLesen({ TRUSTED_PROXY_ADDRESSES: '172.16.0.0/12,keine-adresse' });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toContain('TRUSTED_PROXY_ADDRESSES');
  });
});

/**
 * Port-Invariante des Spiele-Bereichs (Audit W3-6, backend-core-06).
 *
 * Beide Bedingungen standen seit jeher im Kommentar am Schema und in
 * `.env.example`, geprüft hat sie niemand. Die Folgen zeigten sich erst weit
 * später: ein leerer Pool erst beim ersten Server-Start, der Router-Port im
 * Pool erst, wenn ein Gameserver ihn belegt hat und das Minecraft-Routing für
 * alle bricht.
 */
describe('Port-Invariante des Spiele-Bereichs', () => {
  const fehlerPfade = (ergebnis: ReturnType<typeof umgebungLesen>): string[] =>
    ergebnis.success ? [] : ergebnis.error.issues.map((issue) => issue.path.join('.'));

  const meldungen = (ergebnis: ReturnType<typeof umgebungLesen>): string =>
    ergebnis.success ? '' : ergebnis.error.issues.map((issue) => issue.message).join(' ');

  it('nimmt die ausgelieferten Vorgaben an', () => {
    expect(umgebungLesen({}).success).toBe(true);
  });

  it('bricht ab, wenn der Anfang über dem Ende liegt', () => {
    const ergebnis = umgebungLesen({
      GAME_PORT_RANGE_START: '25600',
      GAME_PORT_RANGE_END: '25100',
      MINECRAFT_ROUTER_PORT: '25565',
    });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toContain('GAME_PORT_RANGE_END');
    expect(meldungen(ergebnis)).toContain('leer');
  });

  it('bricht ab, wenn der Router-Port im vergebbaren Bereich liegt', () => {
    const ergebnis = umgebungLesen({
      GAME_PORT_RANGE_START: '25000',
      GAME_PORT_RANGE_END: '25600',
      MINECRAFT_ROUTER_PORT: '25565',
    });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toContain('GAME_PORT_RANGE_END');
    expect(meldungen(ergebnis)).toContain('MINECRAFT_ROUTER_PORT');
  });

  it('bricht auch ab, wenn das Ende genau der Router-Port ist', () => {
    const ergebnis = umgebungLesen({
      GAME_PORT_RANGE_START: '25000',
      GAME_PORT_RANGE_END: '25565',
      MINECRAFT_ROUTER_PORT: '25565',
    });

    expect(ergebnis.success).toBe(false);
  });

  it('gilt auch in Produktion, nicht nur in der Entwicklung', () => {
    const ergebnis = umgebungLesen({
      NODE_ENV: 'production',
      COOKIE_SECURE: 'true',
      VPS_PUBLIC_IP: '203.0.113.10',
      WIREGUARD_HOME_IP: '10.10.0.2',
      PALANTIR_DOMAIN: 'beispiel.tld',
      GAME_PORT_RANGE_END: '25600',
    });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toContain('GAME_PORT_RANGE_END');
  });

  it('lässt einen verschobenen, in sich stimmigen Bereich durch', () => {
    const ergebnis = umgebungLesen({
      GAME_PORT_RANGE_START: '30000',
      GAME_PORT_RANGE_END: '30999',
      MINECRAFT_ROUTER_PORT: '31000',
    });

    expect(ergebnis.success).toBe(true);
  });

  /*
   * Fundpunkt 244: Die Prüfung verlangte `END < MINECRAFT_ROUTER_PORT` und wies
   * damit auch einen Bereich ab, der vollständig **über** dem Router-Port
   * liegt. 26000–27999 neben Port 25565 ist kollisionsfrei – das Backend
   * startete trotzdem nicht, mit einer Meldung, die auf die falsche Ursache
   * zeigte.
   */
  it('lässt einen Bereich oberhalb des Router-Ports durch', () => {
    const ergebnis = umgebungLesen({
      GAME_PORT_RANGE_START: '26000',
      GAME_PORT_RANGE_END: '27999',
      MINECRAFT_ROUTER_PORT: '25565',
    });

    expect(ergebnis.success).toBe(true);
  });

  it('weist einen Bereich ab, der den Router-Port einschließt', () => {
    const ergebnis = umgebungLesen({
      GAME_PORT_RANGE_START: '25000',
      GAME_PORT_RANGE_END: '26000',
      MINECRAFT_ROUTER_PORT: '25565',
    });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toContain('GAME_PORT_RANGE_END');
  });

  it('weist auch den Grenzfall ab, in dem der Bereich genau am Router-Port endet', () => {
    const ergebnis = umgebungLesen({
      GAME_PORT_RANGE_START: '25000',
      GAME_PORT_RANGE_END: '25565',
      MINECRAFT_ROUTER_PORT: '25565',
    });

    expect(ergebnis.success).toBe(false);
  });
});

/**
 * Ableitungs-Vorgaben nur außerhalb der Produktion (Audit W2-23,
 * backend-core-07).
 *
 * Die drei Werte überleben ein Vergessen bisher stumm: Das Backend startet, legt
 * `A`-Einträge auf `127.0.0.1` an und setzt Cookies auf `palantir.local`. Es
 * gibt keinen Zeitpunkt, an dem das auffällt - deshalb der Startabbruch.
 */
describe('Produktions-Pflichtwerte', () => {
  const produktion = {
    NODE_ENV: 'production',
    VPS_PUBLIC_IP: '203.0.113.10',
    WIREGUARD_HOME_IP: '10.10.0.2',
    PALANTIR_DOMAIN: 'beispiel.tld',
  };

  const fehlerPfade = (ergebnis: ReturnType<typeof umgebungLesen>): string[] =>
    ergebnis.success ? [] : ergebnis.error.issues.map((issue) => issue.path.join('.'));

  it('bricht in Produktion ab, wenn einer der drei Werte fehlt', () => {
    const ergebnis = umgebungLesen({ NODE_ENV: 'production' });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toEqual(
      expect.arrayContaining(['VPS_PUBLIC_IP', 'WIREGUARD_HOME_IP', 'PALANTIR_DOMAIN']),
    );
  });

  it('bricht auch ab, wenn der Wert in der .env nur leer dasteht', () => {
    // `VPS_PUBLIC_IP=` ist der wahrscheinlichere Fall als eine fehlende Zeile:
    // Die Vorlage führt jede Variable auf.
    const ergebnis = umgebungLesen({ ...produktion, VPS_PUBLIC_IP: '   ' });

    expect(ergebnis.success).toBe(false);
    expect(fehlerPfade(ergebnis)).toContain('VPS_PUBLIC_IP');
  });

  it('nennt in der Meldung den Wert, das Fehlen und die Folge', () => {
    const ergebnis = umgebungLesen({ NODE_ENV: 'production' });

    expect(ergebnis.success).toBe(false);

    if (!ergebnis.success) {
      const meldung = ergebnis.error.issues
        .filter((issue) => issue.path.join('.') === 'PALANTIR_DOMAIN')
        .map((issue) => issue.message)
        .join('\n');

      expect(meldung).toContain('PALANTIR_DOMAIN fehlt');
      expect(meldung).toContain('NODE_ENV=production');
      expect(meldung).toContain('.env');
    }
  });

  it('lässt Produktion mit vollständigen Werten durch', () => {
    const ergebnis = umgebungLesen(produktion);

    expect(ergebnis.success).toBe(true);
    expect(ergebnis.success && ergebnis.data.VPS_PUBLIC_IP).toBe('203.0.113.10');
  });

  it('greift außerhalb der Produktion weiterhin auf die Vorgaben zurück', () => {
    // Entwicklung und Tests laufen ohne .env; dort sind genau diese Werte
    // richtig, und niemand pflegt eine Domain.
    for (const nodeEnv of ['development', 'test']) {
      const ergebnis = umgebungLesen({ NODE_ENV: nodeEnv });

      expect(ergebnis.success).toBe(true);

      if (ergebnis.success) {
        expect(ergebnis.data.VPS_PUBLIC_IP).toBe('127.0.0.1');
        expect(ergebnis.data.WIREGUARD_HOME_IP).toBe('10.10.0.2');
        expect(ergebnis.data.PALANTIR_DOMAIN).toBe('palantir.local');
      }
    }
  });

  it('nimmt in Produktion einen gesetzten Wert, der zufällig der Vorgabe entspricht', () => {
    // Wer `VPS_PUBLIC_IP=127.0.0.1` bewusst einträgt (Testinstanz auf einer
    // Maschine), soll nicht am Startabbruch hängen: Geprüft wird das Fehlen,
    // nicht der Inhalt.
    const ergebnis = umgebungLesen({ ...produktion, VPS_PUBLIC_IP: '127.0.0.1' });

    expect(ergebnis.success).toBe(true);
  });
});
