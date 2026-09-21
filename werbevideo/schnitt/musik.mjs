/**
 * Musik für den Schnitt – selbst erzeugt, nicht zusammengesucht.
 *
 * Warum synthetisiert und nicht ein Stück von einer Plattform? Weil ein Video,
 * das öffentlich läuft, an der Musik hängen bleibt, sobald deren Lizenz nicht
 * eindeutig ist. Was hier entsteht, stammt aus ein paar hundert Zeilen
 * Sinusrechnung – daran hat niemand Rechte außer euch.
 *
 * Der Satz ist bewusst zurückhaltend: eine Fläche, ein Bass, ein leiser
 * Arpeggio-Lauf und ein weicher Puls. Er soll unter den Bildern liegen, nicht
 * darüber. Wer lieber eigene Musik nimmt, legt sie als Datei daneben – der
 * Schnitt nimmt sie dann statt dieser (siehe README).
 *
 * Aufruf:
 *   node schnitt/musik.mjs <sekunden> <zieldatei.wav>
 */

import fs from 'node:fs';

const ABTASTRATE = 48_000;
const TAKT = 84; // Schläge je Minute
const SCHLAG = 60 / TAKT;
const TAKTLAENGE = SCHLAG * 4;

/** Halbtonabstand zu Frequenz (A4 = 440 Hz). */
const ton = (halbtoene) => 440 * 2 ** (halbtoene / 12);

/**
 * Die Folge: a-Moll – F-Dur – C-Dur – G-Dur, je zwei Takte.
 * Ruhig, ohne Auflösungsdruck – sie kann beliebig oft umlaufen.
 */
const FOLGE = [
  { name: 'Am', toene: [-12, 0, 3, 7], bass: -24 },
  { name: 'F', toene: [-15, -3, 0, 5], bass: -28 },
  { name: 'C', toene: [-17, -5, 0, 4], bass: -29 },
  { name: 'G', toene: [-14, -2, 2, 7], bass: -26 },
];

const weich = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

/** Hüllkurve: Anstieg, Halten, Abfall – alles in Sekunden. */
function huelle(t, dauer, anstieg, abfall) {
  if (t < 0 || t > dauer) return 0;
  const auf = weich(t / anstieg);
  const ab = weich((dauer - t) / abfall);
  return Math.min(auf, ab);
}

/** Einfacher Tiefpass erster Ordnung, über die Probenfolge geführt. */
function tiefpass(proben, grenze) {
  const rc = 1 / (2 * Math.PI * grenze);
  const alpha = 1 / (1 + rc * ABTASTRATE);
  let letzter = 0;
  for (let i = 0; i < proben.length; i += 1) {
    letzter += alpha * (proben[i] - letzter);
    proben[i] = letzter;
  }
  return proben;
}

export function erzeugeMusik(sekunden) {
  const n = Math.round(sekunden * ABTASTRATE);
  const links = new Float64Array(n);
  const rechts = new Float64Array(n);

  const flaeche = new Float64Array(n);
  const bass = new Float64Array(n);
  const arp = new Float64Array(n);
  const puls = new Float64Array(n);

  const taktezahl = Math.ceil(sekunden / TAKTLAENGE) + 1;

  for (let takt = 0; takt < taktezahl; takt += 1) {
    const akkord = FOLGE[Math.floor(takt / 2) % FOLGE.length];
    const beginn = takt * TAKTLAENGE;

    // --- Fläche: pro Akkord zwei Takte lang, mit langem Anstieg ------------
    if (takt % 2 === 0) {
      const dauer = TAKTLAENGE * 2;
      for (const halbton of akkord.toene) {
        // Drei leicht verstimmte Stimmen geben der Fläche Breite.
        for (const verstimmung of [-0.08, 0, 0.09]) {
          const f = ton(halbton + verstimmung);
          const phase = Math.random() * Math.PI * 2;
          for (let i = 0; i < Math.round(dauer * ABTASTRATE); i += 1) {
            const pos = Math.round(beginn * ABTASTRATE) + i;
            if (pos >= n) break;
            const t = i / ABTASTRATE;
            const h = huelle(t, dauer, 1.6, 2.2);
            flaeche[pos] += Math.sin(2 * Math.PI * f * t + phase) * h * 0.055;
          }
        }
      }
    }

    // --- Bass: ein Ton je Takt --------------------------------------------
    {
      const f = ton(akkord.bass);
      const dauer = TAKTLAENGE * 0.92;
      for (let i = 0; i < Math.round(dauer * ABTASTRATE); i += 1) {
        const pos = Math.round(beginn * ABTASTRATE) + i;
        if (pos >= n) break;
        const t = i / ABTASTRATE;
        const h = huelle(t, dauer, 0.05, 0.9);
        // Eine Spur Oberton, sonst verschwindet der Bass auf kleinen Boxen.
        bass[pos] +=
          (Math.sin(2 * Math.PI * f * t) * 0.9 + Math.sin(4 * Math.PI * f * t) * 0.12) * h * 0.3;
      }
    }

    // --- Arpeggio: Achtel über die Akkordtöne ------------------------------
    for (let achtel = 0; achtel < 8; achtel += 1) {
      const halbton = akkord.toene[(achtel + takt) % akkord.toene.length] + 12;
      const f = ton(halbton);
      const beginnAchtel = beginn + achtel * (SCHLAG / 2);
      const dauer = SCHLAG * 0.42;
      // Die Zählzeiten 1 und 5 etwas lauter – das gibt dem Lauf eine Richtung.
      const staerke = achtel % 4 === 0 ? 0.075 : 0.042;
      for (let i = 0; i < Math.round(dauer * ABTASTRATE); i += 1) {
        const pos = Math.round(beginnAchtel * ABTASTRATE) + i;
        if (pos >= n) break;
        const t = i / ABTASTRATE;
        const h = huelle(t, dauer, 0.006, 0.3);
        // Dreieck statt Sinus: etwas mehr Griff, ohne scharf zu werden.
        const phase = (f * t) % 1;
        const dreieck = 4 * Math.abs(phase - 0.5) - 1;
        arp[pos] += dreieck * h * staerke;
      }
    }

    // --- Puls: weicher Anschlag auf 1 und 3 -------------------------------
    for (const schlag of [0, 2]) {
      const beginnSchlag = beginn + schlag * SCHLAG;
      const dauer = 0.16;
      for (let i = 0; i < Math.round(dauer * ABTASTRATE); i += 1) {
        const pos = Math.round(beginnSchlag * ABTASTRATE) + i;
        if (pos >= n) break;
        const t = i / ABTASTRATE;
        const f = 120 * Math.exp(-t * 22) + 42;
        const h = huelle(t, dauer, 0.004, 0.14);
        puls[pos] += Math.sin(2 * Math.PI * f * t) * h * 0.2;
      }
    }
  }

  tiefpass(flaeche, 2_400);
  tiefpass(arp, 5_200);

  // Verzögerung auf dem Arpeggio, im Takt der punktierten Achtel – das ist
  // der Grund, warum wenige Töne nach mehr klingen.
  const verzug = Math.round(SCHLAG * 0.75 * ABTASTRATE);
  const arpL = new Float64Array(n);
  const arpR = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    arpL[i] = arp[i] + (i >= verzug ? arpR[i - verzug] * 0.42 : 0);
    arpR[i] = (i >= verzug ? arpL[i - verzug] * 0.46 : 0) + arp[i] * 0.6;
  }

  const einblenden = 2.4;
  const ausblenden = 3.2;

  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    const rand = Math.min(weich(t / einblenden), weich((sekunden - t) / ausblenden));

    const mitte = flaeche[i] + bass[i] + puls[i];
    let l = (mitte + arpL[i] * 0.8) * rand;
    let r = (mitte + arpR[i] * 0.8) * rand;

    // Weiche Begrenzung statt harter Übersteuerung.
    l = Math.tanh(l * 1.25) * 0.82;
    r = Math.tanh(r * 1.25) * 0.82;

    links[i] = l;
    rechts[i] = r;
  }

  return { links, rechts, abtastrate: ABTASTRATE };
}

/** Als 16-Bit-WAV schreiben. */
export function schreibeWav(pfad, { links, rechts, abtastrate }) {
  const n = links.length;
  const daten = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i += 1) {
    daten.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(links[i] * 32767))), i * 4);
    daten.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(rechts[i] * 32767))), i * 4 + 2);
  }

  const kopf = Buffer.alloc(44);
  kopf.write('RIFF', 0);
  kopf.writeUInt32LE(36 + daten.length, 4);
  kopf.write('WAVE', 8);
  kopf.write('fmt ', 12);
  kopf.writeUInt32LE(16, 16);
  kopf.writeUInt16LE(1, 20); // PCM
  kopf.writeUInt16LE(2, 22); // Stereo
  kopf.writeUInt32LE(abtastrate, 24);
  kopf.writeUInt32LE(abtastrate * 4, 28);
  kopf.writeUInt16LE(4, 32);
  kopf.writeUInt16LE(16, 34);
  kopf.write('data', 36);
  kopf.writeUInt32LE(daten.length, 40);

  fs.writeFileSync(pfad, Buffer.concat([kopf, daten]));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const sekunden = Number(process.argv[2] ?? 90);
  const ziel = process.argv[3] ?? 'musik.wav';
  schreibeWav(ziel, erzeugeMusik(sekunden));
  console.log(`${ziel}: ${sekunden.toFixed(1)} s`);
}
