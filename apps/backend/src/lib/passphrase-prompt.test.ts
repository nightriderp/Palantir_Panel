/**
 * Eingabe einer Passphrase im Rohmodus (Fundpunkt 241).
 *
 * Der Rohmodus liefert nicht ein Zeichen pro Ereignis, sondern das, was gerade
 * anfällt. Wer eine Passphrase aus dem Passwortspeicher einfügt, schickt den
 * ganzen Text samt Zeilenende auf einmal – und wer sich vertippt, schickt die
 * Rücktaste. Beides muss stimmen, sonst entsteht ein Schlüssel unter einer
 * Passphrase, die niemand kennt.
 */

import { describe, expect, it } from 'vitest';
import { LEERE_EINGABE, verarbeiteEingabe } from './passphrase-prompt.js';

/** Mehrere Ereignisse hintereinander, so wie das Terminal sie schickt. */
function tippe(...stuecke: string[]): ReturnType<typeof verarbeiteEingabe> {
  return stuecke.reduce(verarbeiteEingabe, LEERE_EINGABE);
}

describe('Passphrase-Eingabe', () => {
  it('sammelt Zeichen über mehrere Ereignisse hinweg', () => {
    const stand = tippe('ge', 'hei', 'm');

    expect(stand).toEqual({ wert: 'geheim', fertig: false, abgebrochen: false });
  });

  it('schließt bei Zeilenende ab', () => {
    expect(tippe('geheim\n')).toEqual({ wert: 'geheim', fertig: true, abgebrochen: false });
    expect(tippe('geheim\r')).toEqual({ wert: 'geheim', fertig: true, abgebrochen: false });
  });

  it('nimmt eine eingefügte Passphrase in einem Stück an', () => {
    // Der Fall, an dem eine Zeichen-für-Zeichen-Annahme scheitert.
    const stand = tippe('vier zufaellige woerter hier\r\n');

    expect(stand.wert).toBe('vier zufaellige woerter hier');
    expect(stand.fertig).toBe(true);
  });

  it('wirft weg, was nach dem Zeilenende noch kommt', () => {
    // Sonst liefe die nächste Frage mit einer halb beantworteten Eingabe los.
    expect(tippe('geheim\nund noch etwas').wert).toBe('geheim');
  });

  it('nimmt die Rücktaste zurück – beide Schreibweisen', () => {
    expect(tippe('geheim\u007f\u007f').wert).toBe('gehe');
    expect(tippe('geheim\b').wert).toBe('gehei');
  });

  it('lässt sich vor dem ersten Zeichen nicht aus dem Tritt bringen', () => {
    expect(tippe('\u007f\u007f').wert).toBe('');
  });

  it('meldet Strg+C als Abbruch und behält nichts', () => {
    const stand = tippe('gehe', 'im\u0003');

    expect(stand).toEqual({ wert: '', fertig: false, abgebrochen: true });
  });

  it('nimmt Strg+D als Ende, wie es das Terminal meint', () => {
    expect(tippe('geheim\u0004')).toEqual({ wert: 'geheim', fertig: true, abgebrochen: false });
  });

  it('lässt Steuerzeichen der Pfeiltasten draußen', () => {
    // Eine Pfeiltaste schickt ESC [ A – das gehört nicht in die Passphrase.
    expect(tippe('ge\u001b[Aheim').wert).toBe('ge[Aheim');
  });

  it('nimmt Sonderzeichen und Umlaute mit', () => {
    expect(tippe('Süß & Ïñtérnâtionál 漢字\n').wert).toBe('Süß & Ïñtérnâtionál 漢字');
  });
});
