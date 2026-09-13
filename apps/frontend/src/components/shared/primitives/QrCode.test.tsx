import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import qrcode from 'qrcode-generator';
import { QrCode } from './QrCode';

/**
 * Geprüft wird, was diese Komponente selbst verantwortet: dass ein Code
 * entsteht, dass er sich mit dem Inhalt ändert und dass er für Vorlesehilfen
 * benannt ist. Die Kodierung selbst gehört der Bibliothek – sie hier
 * nachzurechnen hiesse, ihre Tests noch einmal zu schreiben.
 */
describe('QrCode', () => {
  const uri = 'otpauth://totp/Palantir:anna?secret=JBSWY3DPEHPK3PXP&issuer=Palantir';

  it('zeichnet einen Code mit Beschriftung', () => {
    render(<QrCode value={uri} label="QR-Code für die Einrichtung" />);

    const bild = screen.getByRole('img', { name: 'QR-Code für die Einrichtung' });
    expect(bild.tagName.toLowerCase()).toBe('svg');
    // Ohne Module wäre das Bild leer – ein weisses Quadrat ohne Aussage.
    expect(bild.querySelectorAll('rect').length).toBeGreaterThan(20);
  });

  it('hält eine Ruhezone von vier Modulen ringsum', () => {
    render(<QrCode value={uri} label="Code" />);

    const bild = screen.getByRole('img', { name: 'Code' });
    const [, , breite] = (bild.getAttribute('viewBox') ?? '').split(' ').map(Number);
    const erstes = bild.querySelector('rect');

    // Kein Modul sitzt im Rand, und der Rand ist auf beiden Seiten gleich.
    expect(Number(erstes?.getAttribute('x'))).toBeGreaterThanOrEqual(4);
    expect(breite).toBeGreaterThan(8);
  });

  /*
   * Die eine Stelle, an der sich diese Komponente wirklich vertun kann:
   * `isDark(zeile, spalte)` gegen `x`/`y` im SVG. Eine vertauschte Achse ergibt
   * einen Code, der gueltig AUSSIEHT – die drei Ecken sitzen symmetrisch –,
   * aber etwas anderes bedeutet. Verglichen wird deshalb gegen die Matrix der
   * Bibliothek selbst.
   */
  it('legt jedes Modul auf seine eigene Zeile und Spalte', () => {
    const code = qrcode(0, 'M');
    code.addData(uri);
    code.make();

    const { container } = render(<QrCode value={uri} label="Lage" />);
    const rand = 4;

    const gezeichnet = new Set(
      [...container.querySelectorAll('rect')].map(
        (rect) =>
          `${Number(rect.getAttribute('y')) - rand}/${Number(rect.getAttribute('x')) - rand}`,
      ),
    );

    const erwartet = new Set<string>();
    for (let zeile = 0; zeile < code.getModuleCount(); zeile += 1) {
      for (let spalte = 0; spalte < code.getModuleCount(); spalte += 1) {
        if (code.isDark(zeile, spalte)) erwartet.add(`${zeile}/${spalte}`);
      }
    }

    expect(gezeichnet).toEqual(erwartet);
  });

  it('ergibt für einen anderen Inhalt ein anderes Muster', () => {
    const { container: a } = render(<QrCode value={uri} label="A" />);
    const { container: b } = render(<QrCode value={`${uri}&digits=8`} label="B" />);

    expect(a.innerHTML).not.toBe(b.innerHTML);
  });
});
