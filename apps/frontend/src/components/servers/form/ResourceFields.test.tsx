import {
  SERVER_DISK_MAX_MB,
  SERVER_DISK_MIN_MB,
  SERVER_RAM_MAX_MB,
  SERVER_RAM_MIN_MB,
} from '@palantir/validation';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ResourceFields } from './ResourceFields';

/**
 * Audit-Fundstelle frontend-lib-09 – die Grenzen waren hier abgeschrieben und
 * enger als das Schema.
 *
 * Ein per API angelegter Server mit 64 GB RAM stand damit am rechten Anschlag;
 * jede Berührung des Reglers schrieb 32 768 MB in den Entwurf, und „Speichern"
 * halbierte den Arbeitsspeicher ohne Hinweis. Der Test vergleicht deshalb Zahl
 * für Zahl gegen `@palantir/validation` – dieselbe Quelle, die auch das Backend
 * prüft.
 */

function zeichne(werte?: { ramMb?: number; diskMb?: number }) {
  const geaendert = vi.fn();
  render(
    <ResourceFields
      ramMb={werte?.ramMb ?? 4096}
      diskMb={werte?.diskMb ?? 10240}
      onChange={geaendert}
    />,
  );
  return { geaendert };
}

function grenzen(label: string): { min: string | null; max: string | null } {
  const feld = screen.getByLabelText(label);
  return { min: feld.getAttribute('min'), max: feld.getAttribute('max') };
}

describe('ResourceFields – Grenzen aus @palantir/validation (frontend-lib-09)', () => {
  it('nimmt die RAM-Untergrenze aus dem Schema und zeigt eine praktische Reglerweite', () => {
    zeichne();

    expect(grenzen('Arbeitsspeicher')).toEqual({
      min: String(SERVER_RAM_MIN_MB),
      // 32 GB wie im Mockup – die volle Schema-Spanne (256 GB) machte den
      // Regler unbedienbar; ein größerer Bestandswert dehnt ihn (siehe unten).
      max: '32768',
    });
  });

  it('zeigt kein CPU-Feld mehr', () => {
    // Die Zuweisung ist entfallen: Ein Server nimmt sich die Kerne, die er
    // braucht. Ein Feld dafür wäre ein Versprechen, das nichts einlöst.
    zeichne();

    expect(screen.queryByLabelText('CPU-Kerne')).toBeNull();
  });

  it('nimmt die Platten-Untergrenze aus dem Schema und zeigt eine praktische Reglerweite', () => {
    zeichne();

    expect(grenzen('Speicherplatz')).toEqual({
      min: String(SERVER_DISK_MIN_MB),
      max: '512000',
    });
  });

  it('bildet einen Server mit 64 GB RAM ab, statt ihn am Anschlag zu kappen', () => {
    const sechzigVierGb = 65_536;
    zeichne({ ramMb: sechzigVierGb });

    const regler = screen.getByLabelText('Arbeitsspeicher') as HTMLInputElement;

    expect(Number(regler.max)).toBeGreaterThanOrEqual(sechzigVierGb);
    expect(regler.value).toBe(String(sechzigVierGb));
  });

  it('dehnt die Regler nie über die Schema-Obergrenze hinaus', () => {
    zeichne({ ramMb: SERVER_RAM_MAX_MB, diskMb: SERVER_DISK_MAX_MB });

    expect(grenzen('Arbeitsspeicher').max).toBe(String(SERVER_RAM_MAX_MB));
    expect(grenzen('Speicherplatz').max).toBe(String(SERVER_DISK_MAX_MB));
  });

  it('dehnt den Platten-Regler auf einen größeren Bestandswert', () => {
    const einTerabyte = 1_048_576;
    zeichne({ diskMb: einTerabyte });

    const regler = screen.getByLabelText('Speicherplatz') as HTMLInputElement;

    expect(Number(regler.max)).toBe(einTerabyte);
    expect(regler.value).toBe(String(einTerabyte));
  });
});
