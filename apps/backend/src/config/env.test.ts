import { describe, expect, it } from 'vitest';
import { adressenAbleiten, leereWerteAlsUngesetzt } from './env.js';

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
