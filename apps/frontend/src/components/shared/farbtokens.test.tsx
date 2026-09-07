import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import tailwindConfig from '../../../tailwind.config';
import { LogoMark } from './icons/LogoMark';
import { MetricRing } from './server/MetricRing';

/**
 * `tailwind.config.ts` verbietet literale Farbwerte in Komponenten. `MetricRing`
 * und `LogoMark` hielten sich als Einzige nicht daran und schrieben die Werte
 * der Tokens `line` und `canvas` von Hand ab (Audit W3-2, frontend-lib-17).
 *
 * Der Test hält beide Seiten zusammen: die Klasse, die die Komponente setzt,
 * und den Token, den die Konfiguration dazu führt. Ein Umbenennen des Tokens
 * ließe die Komponente sonst still ungefärbt.
 */

/**
 * Farbpalette aus der Konfiguration.
 *
 * `Config['theme']` ist bis auf Index-Signaturen untypisiert; ein `unknown` mit
 * anschließender Prüfung ist deshalb ehrlicher als ein `any` (CLAUDE.md §4).
 */
const palette = (tailwindConfig.theme?.extend?.colors ?? {}) as unknown as Record<string, unknown>;

function tokenVorhanden(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(palette, name);
}

const LITERALE_FARBE = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;

describe('Farbtokens statt literaler Werte', () => {
  it('MetricRing zeichnet die Ringspur über den Token `line`', () => {
    const { container } = render(<MetricRing label="CPU" value="42 %" percent={42} />);
    const spur = container.querySelector('circle');

    expect(spur).not.toBeNull();
    expect(spur?.getAttribute('class')).toContain('stroke-line');
    expect(spur?.getAttribute('stroke')).toBeNull();
    expect(tokenVorhanden('line')).toBe(true);
  });

  it('LogoMark zeichnet das Symbol über den Token `canvas`', () => {
    const { container } = render(<LogoMark />);
    const symbol = container.querySelector('path');

    expect(symbol).not.toBeNull();
    expect(symbol?.getAttribute('class')).toContain('stroke-canvas');
    expect(symbol?.getAttribute('stroke')).toBeNull();
    expect(tokenVorhanden('canvas')).toBe(true);
  });

  it('beide Komponenten kommen ohne literalen Farbwert im Markup aus', () => {
    const ring = render(<MetricRing label="RAM" value="—" percent={null} />);
    const logo = render(<LogoMark size={40} />);

    expect(ring.container.innerHTML).not.toMatch(LITERALE_FARBE);
    expect(logo.container.innerHTML).not.toMatch(LITERALE_FARBE);
  });
});
