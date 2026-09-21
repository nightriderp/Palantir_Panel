/**
 * Musik für den Schnitt – selbst erzeugt, nicht zusammengesucht.
 *
 * Warum synthetisiert und nicht ein Stück von einer Plattform? Weil ein Video,
 * das öffentlich läuft, an der Musik hängen bleibt, sobald deren Lizenz nicht
 * eindeutig ist. Was hier entsteht, stammt aus ein paar hundert Zeilen
 * Rechnung – daran hat niemand Rechte außer euch.
 *
 * **Die Anlage:** ein Opening, wie es vor einer Serie läuft. 172 Schläge je
 * Minute, die „Königsweg-Folge" (IV – V – iii – vi), die praktisch jedes
 * japanische Titellied trägt, und ein Aufbau mit Strophe, Anlauf und Refrain.
 * Gespielt von acht Stimmen, die alle hier gerechnet werden:
 *
 *   Bassdrum, Snare, HiHat, Crash   – geformtes Rauschen und Sinus-Rutschen
 *   Bass                            – Sägezahn, tiefpassgefiltert
 *   Rhythmusgitarre                 – verstimmter Sägezahn-Stapel, angezerrt
 *   Lead                            – die Melodie, mit Vibrato und Echo
 *   Glocken und Streicher           – für Vorspann und Weite
 *
 * Aufruf:
 *   node schnitt/musik.mjs <sekunden> <zieldatei.wav>
 */

import fs from 'node:fs';

const ABTASTRATE = 48_000;
const TAKT = 172; // Schläge je Minute
const SCHLAG = 60 / TAKT;
const TAKTLAENGE = SCHLAG * 4;
const ACHTEL = SCHLAG / 2;
const SECHZEHNTEL = SCHLAG / 4;

/** Halbtonabstand zu Frequenz (A4 = 440 Hz, also Abstand 0). */
const ton = (halbtoene) => 440 * 2 ** (halbtoene / 12);

/**
 * Die Akkordfolge: A – B – G#m – C#m, ein Takt je Akkord.
 *
 * In Japan heißt sie „Königsweg" (王道進行) und steht unter so vielen
 * Titelliedern, dass sie sofort nach Vorspann klingt: die vierte Stufe als
 * Auftakt, die fünfte als Zug nach vorn, dann zwei Mollakkorde, die es
 * offenhalten. Genau deshalb steht sie hier.
 */
const FOLGE = [
  { name: 'A', grund: -12, akkord: [-12, -8, -5], quinte: [-12, -5], bass: -24 },
  { name: 'B', grund: -10, akkord: [-10, -6, -3], quinte: [-10, -3], bass: -22 },
  { name: 'G#m', grund: -13, akkord: [-13, -10, -6], quinte: [-13, -6], bass: -25 },
  { name: 'C#m', grund: -8, akkord: [-8, -5, -1], quinte: [-8, -1], bass: -20 },
];

/**
 * Der Refrain-Einfall: eine steigende Linie über die vier Akkorde.
 * `null` ist eine Pause – Luft gehört zur Melodie.
 */
const HOOK = [
  [7, 9, 11, 12, 11, 9, 7, null],
  [9, 11, 12, 14, 12, 11, 9, null],
  [6, 9, 11, 9, 6, 2, null, null],
  [4, 7, 11, 7, 4, null, null, null],
];

/** Gegenmelodie der Strophe – ruhiger, eine Oktave tiefer gedacht. */
const STROPHE = [
  [0, null, 2, null, 4, null, 2, null],
  [2, null, 4, null, 5, null, 4, null],
  [-1, null, 2, null, 4, null, 2, null],
  [-5, null, -1, null, 4, null, 2, null],
];

const weich = (t) => (t < 0 ? 0 : t > 1 ? 1 : t * t * (3 - 2 * t));

/** Abklingen mit Anschlag: kurzer Anstieg, danach exponentieller Abfall. */
function schlag(t, dauer, anstieg, halbwert) {
  if (t < 0 || t > dauer) return 0;
  const auf = t < anstieg ? t / anstieg : 1;
  return auf * Math.exp(-t / halbwert);
}

function huelle(t, dauer, anstieg, abfall) {
  if (t < 0 || t > dauer) return 0;
  return Math.min(weich(t / anstieg), weich((dauer - t) / abfall));
}

/** Tiefpass erster Ordnung über eine ganze Spur. */
function tiefpass(proben, grenze) {
  const alpha = 1 / (1 + (1 / (2 * Math.PI * grenze)) * ABTASTRATE);
  let letzter = 0;
  for (let i = 0; i < proben.length; i += 1) {
    letzter += alpha * (proben[i] - letzter);
    proben[i] = letzter;
  }
  return proben;
}

/** Hochpass erster Ordnung: das Signal minus seinen tiefen Anteil. */
function hochpass(proben, grenze) {
  const alpha = 1 / (1 + (1 / (2 * Math.PI * grenze)) * ABTASTRATE);
  let letzter = 0;
  for (let i = 0; i < proben.length; i += 1) {
    letzter += alpha * (proben[i] - letzter);
    proben[i] -= letzter;
  }
  return proben;
}

/** Sägezahn aus der Phase (0…1) – der Grundklang von Bass und Gitarre. */
const saege = (phase) => 2 * (phase - Math.floor(phase)) - 1;
const dreieck = (phase) => 4 * Math.abs((phase % 1) - 0.5) - 1;
const rechteck = (phase, breite = 0.5) => (phase % 1 < breite ? 1 : -1);

// ---------------------------------------------------------------------------
// Stimmen
// ---------------------------------------------------------------------------

function mischeEin(spur, beginn, proben, staerke = 1) {
  const versatz = Math.round(beginn * ABTASTRATE);
  for (let i = 0; i < proben.length; i += 1) {
    const pos = versatz + i;
    if (pos < 0 || pos >= spur.length) continue;
    spur[pos] += proben[i] * staerke;
  }
}

/** Rauschstoß, oben oder unten beschnitten – Grundlage aller Becken. */
function rauschen(dauer, { halbwert, hp = 0, tp = 0 }) {
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  for (let i = 0; i < n; i += 1) proben[i] = Math.random() * 2 - 1;
  if (hp > 0) hochpass(proben, hp);
  if (tp > 0) tiefpass(proben, tp);
  for (let i = 0; i < n; i += 1) {
    proben[i] *= Math.exp(-(i / ABTASTRATE) / halbwert);
  }
  return proben;
}

function bassdrum(staerke = 1) {
  const dauer = 0.42;
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    // Von 165 Hz in 55 ms hinunter auf 48 Hz – das ist der „Bauch".
    const f = 48 + 117 * Math.exp(-t / 0.055);
    phase += f / ABTASTRATE;
    proben[i] = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.16) * staerke;
  }
  // Ein Hauch Anschlag, sonst verschwindet sie auf kleinen Boxen.
  const klick = rauschen(0.012, { halbwert: 0.004, hp: 1_800 });
  for (let i = 0; i < klick.length; i += 1) proben[i] += klick[i] * 0.35 * staerke;
  return proben;
}

function snare(staerke = 1) {
  const koerper = new Float64Array(Math.round(0.22 * ABTASTRATE));
  for (let i = 0; i < koerper.length; i += 1) {
    const t = i / ABTASTRATE;
    koerper[i] =
      (Math.sin(2 * Math.PI * 185 * t) * 0.6 + Math.sin(2 * Math.PI * 332 * t) * 0.4) *
      Math.exp(-t / 0.055);
  }
  const teppich = rauschen(0.22, { halbwert: 0.075, hp: 1_200, tp: 9_000 });
  const proben = new Float64Array(koerper.length);
  for (let i = 0; i < proben.length; i += 1) {
    proben[i] = (koerper[i] * 0.5 + teppich[i] * 0.85) * staerke;
  }
  return proben;
}

const hihat = (offen, staerke = 1) => {
  const proben = rauschen(offen ? 0.3 : 0.055, {
    halbwert: offen ? 0.11 : 0.016,
    hp: 7_000,
  });
  for (let i = 0; i < proben.length; i += 1) proben[i] *= staerke;
  return proben;
};

const crash = (staerke = 1) => {
  const proben = rauschen(2.2, { halbwert: 0.65, hp: 3_500, tp: 13_000 });
  for (let i = 0; i < proben.length; i += 1) proben[i] *= staerke;
  return proben;
};

function tom(halbton, staerke = 1) {
  const dauer = 0.3;
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  const grund = ton(halbton);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    phase += (grund * (1 + 0.7 * Math.exp(-t / 0.05))) / ABTASTRATE;
    proben[i] = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.09) * staerke;
  }
  return proben;
}

/** Bass: Sägezahn mit Oberton, kurz und trocken. */
function bassnote(halbton, dauer, staerke = 1) {
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  const f = ton(halbton);
  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    const h = huelle(t, dauer, 0.004, Math.min(0.06, dauer / 3));
    proben[i] = (saege(f * t) * 0.7 + Math.sin(2 * Math.PI * f * t) * 0.6) * h * staerke;
  }
  return proben;
}

/** Rhythmusgitarre: drei verstimmte Sägezähne, danach angezerrt. */
function gitarrenakkord(halbtoene, dauer, staerke = 1) {
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  for (const halbton of halbtoene) {
    for (const verstimmung of [-0.14, 0, 0.13]) {
      const f = ton(halbton + 12 + verstimmung);
      const phase0 = Math.random();
      for (let i = 0; i < n; i += 1) {
        const t = i / ABTASTRATE;
        proben[i] += saege(f * t + phase0) * schlag(t, dauer, 0.003, 0.085);
      }
    }
  }
  for (let i = 0; i < n; i += 1) {
    // Zerre: Das ist der Unterschied zwischen „Fläche" und „Riff".
    proben[i] = Math.tanh(proben[i] * 1.9) * 0.5 * staerke;
  }
  return proben;
}

/** Lead: Rechteck plus Sägezahn, mit Vibrato – die Stimme, die man mitsummt. */
function leadnote(halbton, dauer, staerke = 1) {
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  const grund = ton(halbton);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    // Vibrato setzt erst nach 80 ms ein, wie bei einer gehaltenen Stimme.
    const vib = 1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * weich(t / 0.08);
    phase += (grund * vib) / ABTASTRATE;
    const h = huelle(t, dauer, 0.008, Math.min(0.07, dauer / 2.5));
    proben[i] = (rechteck(phase, 0.42) * 0.45 + saege(phase) * 0.55) * h * staerke;
  }
  return proben;
}

/** Glocke: Sinus mit unharmonischem Oberton – für Vorspann und Übergänge. */
function glocke(halbton, dauer, staerke = 1) {
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  const f = ton(halbton + 12);
  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    proben[i] =
      (Math.sin(2 * Math.PI * f * t) + Math.sin(2 * Math.PI * f * 2.76 * t) * 0.34) *
      Math.exp(-t / 0.45) *
      staerke;
  }
  return proben;
}

/** Streicher: gehaltener Akkord mit langsamem Anstieg. */
function streicher(halbtoene, dauer, staerke = 1) {
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  for (const halbton of halbtoene) {
    for (const verstimmung of [-0.1, 0.1]) {
      const f = ton(halbton + 12 + verstimmung);
      const phase0 = Math.random();
      for (let i = 0; i < n; i += 1) {
        const t = i / ABTASTRATE;
        proben[i] += saege(f * t + phase0) * huelle(t, dauer, 0.35, 0.5) * 0.2;
      }
    }
  }
  for (let i = 0; i < n; i += 1) proben[i] *= staerke;
  return proben;
}

/** Anlauf: Rauschen, dessen Höhe über die Dauer steigt. */
function anlauf(dauer, staerke = 1) {
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  for (let i = 0; i < n; i += 1) proben[i] = Math.random() * 2 - 1;
  hochpass(proben, 900);
  for (let i = 0; i < n; i += 1) {
    const t = i / n;
    proben[i] *= t * t * staerke * 0.55;
  }
  return proben;
}

// ---------------------------------------------------------------------------
// Aufbau des Stücks
// ---------------------------------------------------------------------------

/**
 * Welche Abschnitte in welcher Reihenfolge – so lang, wie der Schnitt ist.
 *
 * Jeder Abschnitt umfasst vier Takte, also genau einen Durchlauf der Folge.
 */
function planen(sekunden) {
  const abschnitt = 4 * TAKTLAENGE;
  const muster = ['refrain', 'refrain', 'strophe', 'strophe', 'anlauf', 'refrain', 'bruecke'];
  const plan = ['vorspann', 'anlauf'];
  let i = 0;
  // Ein Abschnitt bleibt für den Ausklang reserviert.
  while ((plan.length + 2) * abschnitt <= sekunden) {
    plan.push(muster[i % muster.length]);
    i += 1;
  }
  plan.push('ausklang');
  return plan;
}

export function erzeugeMusik(sekunden) {
  const n = Math.round(sekunden * ABTASTRATE);

  const spuren = {
    schlagzeug: new Float64Array(n),
    becken: new Float64Array(n),
    bass: new Float64Array(n),
    gitarre: new Float64Array(n),
    lead: new Float64Array(n),
    glocken: new Float64Array(n),
    streicher: new Float64Array(n),
    fx: new Float64Array(n),
  };

  const plan = planen(sekunden);

  plan.forEach((art, abschnittNr) => {
    const beginn = abschnittNr * 4 * TAKTLAENGE;
    const voll = art === 'refrain';
    const halb = art === 'strophe' || art === 'anlauf';

    for (let takt = 0; takt < 4; takt += 1) {
      const akkord = FOLGE[takt % FOLGE.length];
      const taktBeginn = beginn + takt * TAKTLAENGE;
      if (taktBeginn >= sekunden) return;

      // --- Schlagzeug ------------------------------------------------------
      if (voll || halb) {
        for (let schlagNr = 0; schlagNr < 4; schlagNr += 1) {
          const zeit = taktBeginn + schlagNr * SCHLAG;
          // Bassdrum auf 1 und 3, dazu ein Vorschlag vor der 3 – der Trick,
          // der eine gerade Achtel-Figur nach vorn kippen lässt.
          if (schlagNr === 0 || schlagNr === 2) {
            mischeEin(spuren.schlagzeug, zeit, bassdrum(voll ? 1 : 0.8));
          }
          if (voll && schlagNr === 1) {
            mischeEin(spuren.schlagzeug, zeit + 3 * SECHZEHNTEL, bassdrum(0.7));
          }
          // Snare auf 2 und 4 – der Rückschlag.
          if (schlagNr === 1 || schlagNr === 3) {
            mischeEin(spuren.schlagzeug, zeit, snare(voll ? 1 : 0.75));
          }
          // HiHat in Achteln, die Zählzeit betont.
          for (let achtel = 0; achtel < 2; achtel += 1) {
            const offen = voll && schlagNr === 3 && achtel === 1;
            mischeEin(
              spuren.becken,
              zeit + achtel * ACHTEL,
              hihat(offen, (achtel === 0 ? 0.5 : 0.3) * (voll ? 1 : 0.75)),
            );
          }
        }
        // Wirbel am Ende des Abschnitts – das Signal „gleich passiert etwas".
        if (takt === 3 && (art === 'anlauf' || art === 'strophe')) {
          for (let s = 0; s < 8; s += 1) {
            const zeit = taktBeginn + 2 * SCHLAG + s * SECHZEHNTEL;
            mischeEin(spuren.schlagzeug, zeit, tom(-17 + s, 0.5 + s * 0.05));
          }
        }
      }

      if ((voll || art === 'bruecke') && takt === 0) {
        mischeEin(spuren.becken, taktBeginn, crash(voll ? 0.55 : 0.4));
      }

      // --- Bass ------------------------------------------------------------
      if (voll || halb || art === 'bruecke') {
        const laenge = voll ? ACHTEL * 0.9 : SCHLAG * 0.9;
        const schritte = voll ? 8 : 4;
        for (let s = 0; s < schritte; s += 1) {
          // Im Refrain läuft der Bass in Achteln und springt jede zweite
          // Zählzeit auf die Quinte – das hält die Linie in Bewegung.
          const halbton = voll && s % 4 === 3 ? akkord.bass + 7 : akkord.bass;
          mischeEin(
            spuren.bass,
            taktBeginn + s * (voll ? ACHTEL : SCHLAG),
            bassnote(halbton, laenge, voll ? 0.9 : 0.7),
          );
        }
      }

      // --- Gitarre ---------------------------------------------------------
      if (voll) {
        for (let s = 0; s < 8; s += 1) {
          mischeEin(
            spuren.gitarre,
            taktBeginn + s * ACHTEL,
            gitarrenakkord(akkord.quinte, ACHTEL * 0.92, s % 2 === 0 ? 1 : 0.7),
          );
        }
      } else if (art === 'anlauf') {
        mischeEin(spuren.gitarre, taktBeginn, gitarrenakkord(akkord.quinte, TAKTLAENGE * 0.9, 0.5));
      }

      // --- Lead und Gegenmelodie -------------------------------------------
      if (voll) {
        const zeile = HOOK[takt % HOOK.length];
        zeile.forEach((halbton, s) => {
          if (halbton === null) return;
          mischeEin(spuren.lead, taktBeginn + s * ACHTEL, leadnote(halbton, ACHTEL * 1.6, 0.5));
        });
      } else if (art === 'strophe') {
        const zeile = STROPHE[takt % STROPHE.length];
        zeile.forEach((halbton, s) => {
          if (halbton === null) return;
          mischeEin(spuren.glocken, taktBeginn + s * ACHTEL, glocke(halbton, 0.9, 0.45));
        });
      }

      // --- Glocken im Vorspann ---------------------------------------------
      if (art === 'vorspann') {
        for (let s = 0; s < 4; s += 1) {
          const halbton = akkord.akkord[s % akkord.akkord.length] + 12;
          mischeEin(spuren.glocken, taktBeginn + s * SCHLAG, glocke(halbton, 1.1, 0.6));
        }
      }

      // --- Streicher --------------------------------------------------------
      if (voll || art === 'bruecke' || art === 'vorspann' || art === 'ausklang') {
        mischeEin(
          spuren.streicher,
          taktBeginn,
          streicher(akkord.akkord, TAKTLAENGE, art === 'ausklang' ? 1 : 0.7),
        );
      }

      // --- Ausklang: ein letzter Schlag, dann stehen lassen ------------------
      if (art === 'ausklang' && takt === 0) {
        mischeEin(spuren.schlagzeug, taktBeginn, bassdrum(1));
        mischeEin(spuren.becken, taktBeginn, crash(0.7));
        mischeEin(spuren.gitarre, taktBeginn, gitarrenakkord(akkord.quinte, TAKTLAENGE * 2, 0.9));
        mischeEin(spuren.bass, taktBeginn, bassnote(akkord.bass, TAKTLAENGE * 2, 0.9));
      }
    }

    // Anlauf in den nächsten Abschnitt.
    if (art === 'anlauf') {
      mischeEin(spuren.fx, beginn + 2 * TAKTLAENGE, anlauf(2 * TAKTLAENGE, 1));
    }
  });

  // --- Klangfarbe je Spur ----------------------------------------------------
  tiefpass(spuren.bass, 1_100);
  tiefpass(spuren.gitarre, 6_500);
  hochpass(spuren.gitarre, 180);
  tiefpass(spuren.lead, 7_500);
  tiefpass(spuren.streicher, 3_200);
  tiefpass(spuren.glocken, 9_000);

  // Echo auf dem Lead, im Takt der punktierten Achtel – wenige Töne, viel Raum.
  const verzug = Math.round(SCHLAG * 0.75 * ABTASTRATE);
  const leadL = new Float64Array(n);
  const leadR = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    leadL[i] = spuren.lead[i] + (i >= verzug ? leadR[i - verzug] * 0.38 : 0);
    leadR[i] = spuren.lead[i] * 0.85 + (i >= verzug ? leadL[i - verzug] * 0.42 : 0);
  }

  // --- Mischung ---------------------------------------------------------------
  const links = new Float64Array(n);
  const rechts = new Float64Array(n);
  const einblenden = 0.25;
  const ausblenden = Math.min(3.5, sekunden * 0.06);

  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    const rand = Math.min(weich(t / einblenden), weich((sekunden - t) / ausblenden));

    // Mitte: alles, was Wucht trägt. Seiten: Gitarre und Lead-Echo.
    const mitte = spuren.schlagzeug[i] * 0.95 + spuren.bass[i] * 0.85 + spuren.streicher[i] * 0.5;
    const seiteL = spuren.gitarre[i] * 0.6 + spuren.becken[i] * 0.5 + spuren.glocken[i] * 0.45;
    const seiteR = spuren.gitarre[i] * 0.52 + spuren.becken[i] * 0.55 + spuren.glocken[i] * 0.5;

    let l = (mitte + seiteL + leadL[i] * 0.55 + spuren.fx[i] * 0.4) * rand;
    let r = (mitte + seiteR + leadR[i] * 0.55 + spuren.fx[i] * 0.4) * rand;

    // Weiche Begrenzung statt harter Übersteuerung.
    l = Math.tanh(l * 0.85) * 0.9;
    r = Math.tanh(r * 0.85) * 0.9;

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
