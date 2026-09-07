import { describe, expect, it } from 'vitest';
import { attachmentContentDisposition } from './content-disposition.js';

/**
 * Audit W2-9, `orchestration-features-07`: Der Dateiname landete roh in der
 * Kopfzeile. Steuerzeichen ließen Node den Wert ablehnen (Download endete als
 * 500), Umlaute kamen als Buchstabensalat an.
 */
describe('attachmentContentDisposition', () => {
  it('lässt einen reinen ASCII-Namen unverändert stehen', () => {
    expect(attachmentContentDisposition('level.dat')).toBe(
      `attachment; filename="level.dat"; filename*=UTF-8''level.dat`,
    );
  });

  it('kodiert Umlaute nach RFC 5987 und hält einen ASCII-Rückfall bereit', () => {
    const wert = attachmentContentDisposition('Weltgröße.zip');

    expect(wert).toBe(
      `attachment; filename="Weltgr__e.zip"; filename*=UTF-8''Weltgr%C3%B6%C3%9Fe.zip`,
    );
  });

  it('entschärft Anführungszeichen und Backslash im Rückfallnamen', () => {
    const wert = attachmentContentDisposition('kon"fig\\.yml');

    // Kein zweites Anführungszeichen im Rückfall – der Wert bräche sonst auf.
    expect(wert.slice(0, wert.indexOf('; filename*='))).toBe('attachment; filename="kon_fig_.yml"');
    expect(wert).toContain(`filename*=UTF-8''kon%22fig%5C.yml`);
  });

  it('entfernt Steuerzeichen, die Node als Kopfzeilenwert ablehnt', () => {
    const wert = attachmentContentDisposition('welt\r\nx.txt');

    expect(wert).not.toMatch(/[\r\n]/);
    expect(wert).toBe(`attachment; filename="welt__x.txt"; filename*=UTF-8''welt%0D%0Ax.txt`);
  });

  it('kodiert die Zeichen, die encodeURIComponent stehen lässt', () => {
    // `'`, `(`, `)` und `*` zählen nicht zu den erlaubten attr-char.
    expect(attachmentContentDisposition(`o'brien(1)*.txt`)).toContain(
      `filename*=UTF-8''o%27brien%281%29%2A.txt`,
    );
  });

  it('setzt einen Ersatznamen, wenn nichts übrig bliebe', () => {
    expect(attachmentContentDisposition('')).toBe(
      `attachment; filename="download"; filename*=UTF-8''`,
    );
  });
});
