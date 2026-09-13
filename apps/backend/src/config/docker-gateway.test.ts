import { describe, expect, it } from 'vitest';

import { standardGatewayAusRouten, standardGatewayDesContainers } from './docker-gateway.js';

/**
 * Eine echte Zeile aus einem Container am Netz `palantir` (VPS, 13.09.2026).
 * `00012AC0` ist `192.42.1.0` – hier steht `010014AC` für `172.20.0.1`.
 */
const ROUTEN = [
  'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT',
  'eth0\t00000000\t010014AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
  'eth0\t000014AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
].join('\n');

describe('Standard-Gateway des Containers (Fundpunkt 288)', () => {
  it('liest die Adresse der Standardroute', () => {
    expect(standardGatewayAusRouten(ROUTEN)).toBe('172.20.0.1');
  });

  it('liest little-endian, nicht andersherum', () => {
    /*
     * Die Reihenfolge ist der ganze Witz der Umrechnung: `0100A8C0` ist
     * `192.168.0.1` und nicht `1.0.168.192`. Ein vertauschtes Ergebnis wäre
     * eine gültige Adresse – nur eben die falsche, und der Health-Check liefe
     * wieder ins Leere.
     */
    const zeile = 'eth0\t00000000\t0100A8C0\t0003\t0\t0\t0\t00000000\t0\t0\t0';

    expect(standardGatewayAusRouten(`Iface\tDestination\tGateway\n${zeile}`)).toBe('192.168.0.1');
  });

  it('nimmt die erste Standardroute und nicht die erstbeste Zeile', () => {
    const zeilen = [
      'Iface\tDestination\tGateway',
      // Direkt verbundenes Netz – kein Gateway, darf nicht gewählt werden.
      'eth1\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
      'eth0\t00000000\t010014AC\t0003\t0\t0\t0\t00000000\t0\t0\t0',
    ].join('\n');

    expect(standardGatewayAusRouten(zeilen)).toBe('172.20.0.1');
  });

  it('meldet null, wenn keine Standardroute führt', () => {
    const zeilen = [
      'Iface\tDestination\tGateway',
      'eth0\t000014AC\t00000000\t0001\t0\t0\t0\t0000FFFF\t0\t0\t0',
    ].join('\n');

    expect(standardGatewayAusRouten(zeilen)).toBeNull();
  });

  it('meldet null statt zu werfen, wenn es die Datei nicht gibt', () => {
    // Auf jedem System ausser Linux ist das der Normalfall – auch in der CI
    // unter Windows darf der Aufruf deshalb nicht scheitern.
    expect(standardGatewayDesContainers('/gibt/es/nicht/route')).toBeNull();
  });

  it('überliest Bruchstücke, statt sie als Adresse auszugeben', () => {
    const zeilen = ['Iface\tDestination\tGateway', 'eth0\t00000000\tXYZ', ''].join('\n');

    expect(standardGatewayAusRouten(zeilen)).toBeNull();
  });
});
