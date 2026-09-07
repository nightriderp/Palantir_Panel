import { SUBDOMAIN_REJECTION_REASONS, buildServerHostname } from '@palantir/contracts';
import { describe, expect, it } from 'vitest';
import { type ServerOrchestrationError } from './errors.js';
import {
  type SubdomainAvailabilityCheck,
  checkSubdomain,
  normalizeSubdomain,
  resolveAvailableSubdomain,
} from './subdomain.js';

const BASIS_DOMAIN = 'example.tld';

const free: SubdomainAvailabilityCheck = { isSubdomainTaken: () => Promise.resolve(false) };
const taken: SubdomainAvailabilityCheck = { isSubdomainTaken: () => Promise.resolve(true) };

async function codeOf(action: () => Promise<unknown>): Promise<string> {
  try {
    await action();

    return 'kein-fehler';
  } catch (error: unknown) {
    return (error as ServerOrchestrationError).code;
  }
}

describe('normalizeSubdomain() (Pflichtenheft §13)', () => {
  it('normalisiert Leerraum und Großschreibung', () => {
    expect(normalizeSubdomain('  Mein-Server ')).toBe('mein-server');
  });

  it('lehnt ein ungültiges Format mit SUBDOMAIN_INVALID ab', () => {
    try {
      normalizeSubdomain('-ungültig-');
      expect.unreachable('Das Format hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('SUBDOMAIN_INVALID');
    }
  });

  it('lehnt einen gesperrten Namen mit SUBDOMAIN_INVALID ab, nicht mit SUBDOMAIN_TAKEN', () => {
    // Ein reservierter Name ist nicht „vergeben", sondern nicht wählbar.
    try {
      normalizeSubdomain('admin');
      expect.unreachable('Der Name hätte abgelehnt werden müssen.');
    } catch (error: unknown) {
      expect((error as ServerOrchestrationError).code).toBe('SUBDOMAIN_INVALID');
      expect((error as ServerOrchestrationError).message).toContain('reserviert');
    }
  });
});

describe('resolveAvailableSubdomain()', () => {
  it('liefert die normalisierte Subdomain, wenn sie frei ist', async () => {
    await expect(resolveAvailableSubdomain('Mein-Server', free)).resolves.toBe('mein-server');
  });

  it('meldet eine belegte Subdomain als SUBDOMAIN_TAKEN', async () => {
    expect(await codeOf(() => resolveAvailableSubdomain('mein-server', taken))).toBe(
      'SUBDOMAIN_TAKEN',
    );
  });

  it('prüft das Format vor der Verfügbarkeit', async () => {
    // Eine Datenbankabfrage soll für offensichtlich ungültige Eingaben nicht
    // laufen – und ein Formatfehler nicht als „belegt" gemeldet werden.
    let asked = false;
    const check: SubdomainAvailabilityCheck = {
      isSubdomainTaken: () => {
        asked = true;

        return Promise.resolve(true);
      },
    };

    expect(await codeOf(() => resolveAvailableSubdomain('AB', check))).toBe('SUBDOMAIN_INVALID');
    expect(asked).toBe(false);
  });

  it('reicht den auszunehmenden Server durch (Umbenennen)', async () => {
    const seen: (string | undefined)[] = [];
    const check: SubdomainAvailabilityCheck = {
      isSubdomainTaken: (_subdomain, excludeServerId) => {
        seen.push(excludeServerId);

        return Promise.resolve(false);
      },
    };

    await resolveAvailableSubdomain('mein-server', check, 'server-1');

    expect(seen).toEqual(['server-1']);
  });
});

describe('checkSubdomain() – Anzeige im Wizard', () => {
  it('meldet eine freie Subdomain mit der entstehenden Adresse', async () => {
    await expect(checkSubdomain('mein-server', free, BASIS_DOMAIN)).resolves.toEqual({
      subdomain: 'mein-server',
      available: true,
      reason: null,
      message: 'mein-server.example.tld ist frei.',
      fullHostname: 'mein-server.example.tld',
    });
  });

  it('meldet ein ungültiges Format ohne Fehler zu werfen', async () => {
    const result = await checkSubdomain('mein_server', free, BASIS_DOMAIN);

    expect(result.available).toBe(false);
    expect(result.reason).toBe('invalid');
  });

  it('meldet eine belegte Subdomain', async () => {
    const result = await checkSubdomain('mein-server', taken, BASIS_DOMAIN);

    expect(result.available).toBe(false);
    expect(result.reason).toBe('taken');
    expect(result.fullHostname).toBe('mein-server.example.tld');
  });

  it('meldet einen gesperrten Namen als reserved, nicht als invalid', async () => {
    /*
     * Audit contract-drift-04: Der Vertrag unterscheidet „falsch geschrieben"
     * von „für das System reserviert" (SUBDOMAIN_REJECTION_REASONS); das
     * Backend meldete beides als `invalid`.
     */
    const result = await checkSubdomain('vpn', free, BASIS_DOMAIN);

    expect(result.reason).toBe('reserved');
    expect(result.message).toContain('reserviert');
  });

  it('liefert jede Antwort in der Form des Vertrags', async () => {
    /*
     * Der lokale `SubdomainCheckResult` ist entfallen; das Frontend typisiert
     * die Antwort ohnehin als `SubdomainAvailabilityDto`. Dieser Test hält
     * fest, dass jeder Zweig dieselben Felder liefert – vorher fehlte
     * `fullHostname` in allen dreien.
     */
    const antworten = [
      await checkSubdomain('mein-server', free, BASIS_DOMAIN),
      await checkSubdomain('mein-server', taken, BASIS_DOMAIN),
      await checkSubdomain('mein_server', free, BASIS_DOMAIN),
      await checkSubdomain('admin', free, BASIS_DOMAIN),
    ];

    for (const antwort of antworten) {
      expect(Object.keys(antwort).sort()).toEqual([
        'available',
        'fullHostname',
        'message',
        'reason',
        'subdomain',
      ]);
      expect(typeof antwort.message).toBe('string');
      expect(antwort.fullHostname).toBe(buildServerHostname(antwort.subdomain, BASIS_DOMAIN));
      expect(antwort.reason === null || SUBDOMAIN_REJECTION_REASONS.includes(antwort.reason)).toBe(
        true,
      );
    }
  });

  it('normalisiert die Eingabe auch dann, wenn sie abgelehnt wird', async () => {
    // Der Wizard zeigt die Adresse an, die entstünde – auch bei einem
    // gesperrten Namen mit Großschreibung und Leerraum.
    const result = await checkSubdomain('  ADMIN ', free, BASIS_DOMAIN);

    expect(result.subdomain).toBe('admin');
    expect(result.fullHostname).toBe('admin.example.tld');
    expect(result.reason).toBe('reserved');
  });
});
