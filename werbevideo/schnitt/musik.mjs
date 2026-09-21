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

/**
 * Klatschen – die zweite Schicht über der Snare.
 *
 * Nicht ein Rauschstoß, sondern **vier kurz nacheinander**: So klingt eine
 * Gruppe, die zusammen klatscht, und genau daher kommt die Breite. Ein
 * einzelner Stoß an derselben Stelle wäre nur eine zweite Snare.
 */
function clap(staerke = 1) {
  const dauer = 0.2;
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  for (const [versatz, gewicht] of [
    [0, 0.65],
    [0.009, 0.85],
    [0.019, 1],
    [0.03, 0.5],
  ]) {
    const teil = rauschen(dauer - versatz, { halbwert: 0.028, hp: 1_400, tp: 7_500 });
    const ab = Math.round(versatz * ABTASTRATE);
    for (let i = 0; i < teil.length; i += 1) proben[ab + i] += teil[i] * gewicht;
  }
  // Der Nachhall macht aus vier Stößen einen Raum.
  const schweif = rauschen(dauer, { halbwert: 0.09, hp: 1_800, tp: 6_000 });
  for (let i = 0; i < n; i += 1) proben[i] = (proben[i] * 0.55 + schweif[i] * 0.3) * staerke;
  return proben;
}

/**
 * Ride – der Beckenschlag, der den Refrain trägt.
 *
 * Gegenüber der HiHat länger und tiefer angesetzt: Sie hält den Takt, ohne
 * ihn zu zerhacken. Die Glocke obendrauf gibt ihr den Anschlagspunkt.
 */
function ride(staerke = 1) {
  const proben = rauschen(0.42, { halbwert: 0.16, hp: 4_200, tp: 14_000 });
  const n = proben.length;
  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    // Die Glocke: ein paar feste Teiltöne, kurz angerissen.
    const glocke =
      (Math.sin(2 * Math.PI * 2_450 * t) + Math.sin(2 * Math.PI * 3_120 * t) * 0.6) *
      Math.exp(-t / 0.05);
    proben[i] = (proben[i] * 0.5 + glocke * 0.22) * staerke;
  }
  return proben;
}

/**
 * Stab: ein kurzer, harter Akkordschlag.
 *
 * Steht auf den Gegenzählzeiten und füllt die Lücken, die der Galopp der
 * Gitarre lässt. Sehr kurze Hülle – ein langer Akkord an derselben Stelle
 * verkleistert den Takt, statt ihn zu betonen.
 */
function stab(halbtoene, staerke = 1) {
  const dauer = 0.13;
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  for (const halbton of halbtoene) {
    for (const verstimmung of [-0.18, 0, 0.17]) {
      const f = ton(halbton + 12 + verstimmung);
      const phase0 = Math.random();
      for (let i = 0; i < n; i += 1) {
        const t = i / ABTASTRATE;
        proben[i] += saege(f * t + phase0) * schlag(t, dauer, 0.002, 0.035);
      }
    }
  }
  for (let i = 0; i < n; i += 1) proben[i] = Math.tanh(proben[i] * 2.2) * 0.42 * staerke;
  return proben;
}

/**
 * Sub-Drop: ein tiefer Ton, der nach unten wegrutscht.
 *
 * Er sitzt **auf** dem ersten Schlag eines Refrains, nicht davor: Er ist der
 * Aufprall nach dem Anlauf, nicht seine Vorbereitung.
 */
function subDrop(staerke = 1) {
  const dauer = 1.1;
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  let phase = 0;
  for (let i = 0; i < n; i += 1) {
    const t = i / ABTASTRATE;
    const f = 34 + 86 * Math.exp(-t / 0.12);
    phase += f / ABTASTRATE;
    proben[i] = Math.sin(2 * Math.PI * phase) * Math.exp(-t / 0.42) * staerke;
  }
  return proben;
}

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
    /*
     * Zerre: Das ist der Unterschied zwischen „Fläche" und „Riff".
     *
     * Zweistufig – erst weich in die Sättigung, dann noch einmal härter. Eine
     * einzige starke Stufe macht den Akkord matschig, weil sie alle Teiltöne
     * gleichzeitig plattdrückt; zwei sanftere lassen den Grundton stehen.
     */
    const weich1 = Math.tanh(proben[i] * 2.4);
    proben[i] = Math.tanh(weich1 * 1.35) * 0.46 * staerke;
  }
  return proben;
}

/**
 * Abgedämpfter Anschlag – der Galopp.
 *
 * Dieselben Saiten, aber sehr kurz gehalten und mit angehobenen Mitten: So
 * klingt eine Hand, die auf den Saiten liegt. Aus gleichmäßigen Achteln wird
 * damit eine Figur, die nach vorn drückt, statt nur mitzulaufen.
 */
function gitarreGedaempft(halbtoene, staerke = 1) {
  const dauer = 0.1;
  const n = Math.round(dauer * ABTASTRATE);
  const proben = new Float64Array(n);
  for (const halbton of halbtoene.slice(0, 2)) {
    for (const verstimmung of [-0.1, 0.11]) {
      const f = ton(halbton + 12 + verstimmung);
      const phase0 = Math.random();
      for (let i = 0; i < n; i += 1) {
        const t = i / ABTASTRATE;
        proben[i] += saege(f * t + phase0) * schlag(t, dauer, 0.002, 0.026);
      }
    }
  }
  for (let i = 0; i < n; i += 1) proben[i] = Math.tanh(proben[i] * 2.8) * 0.4 * staerke;
  hochpass(proben, 260);
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
    /*
     * Die Oktave darunter läuft mit – halb so laut und als reiner Sägezahn.
     * Eine einzelne Stimme geht im Refrain zwischen Gitarre und Becken unter;
     * zwei Oktaven übereinander setzen sich durch, ohne lauter zu sein.
     */
    const oben = rechteck(phase, 0.42) * 0.45 + saege(phase) * 0.55;
    const unten = saege(phase * 0.5) * 0.42;
    proben[i] = (oben + unten) * h * staerke;
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
  /*
   * Die Folge der Abschnitte.
   *
   * Vor **jedem** Refrain steht ein Anlauf – das ist der Grund, warum ein
   * Refrain als Einsatz wirkt und nicht als Fortsetzung. Die Strophen sind
   * auf je einen Durchlauf gekürzt: In einem Werbevideo hat niemand Geduld
   * für acht Takte Leerlauf, und die Brücke liefert die Ruhe, die es dafür
   * braucht, an der Stelle, an der sie hingehört.
   */
  const muster = [
    'refrain',
    'refrain',
    'strophe',
    'anlauf',
    'refrain',
    'strophe',
    'bruecke',
    'anlauf',
    'refrain',
  ];
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
          /*
           * Doppelschlag der Bassdrum im Refrain: ein zweiter Tritt eine
           * Sechzehntel nach der Eins und nach der Drei. Das ist der
           * Unterschied zwischen „geht" und „drückt" – und er kostet nichts
           * an Lautstärke, weil er in die Lücke fällt.
           */
          if (voll && (schlagNr === 0 || schlagNr === 2)) {
            mischeEin(spuren.schlagzeug, zeit + SECHZEHNTEL * 2.5, bassdrum(0.55));
          }
          // Snare auf 2 und 4 – der Rückschlag. Im Refrain klatscht die Runde
          // mit: zwei Schichten auf demselben Schlag, breiter als eine.
          if (schlagNr === 1 || schlagNr === 3) {
            mischeEin(spuren.schlagzeug, zeit, snare(voll ? 1 : 0.75));
            if (voll) mischeEin(spuren.becken, zeit, clap(0.5));
          }
          /*
           * Becken: im Refrain Sechzehntel statt Achtel, dazu die Ride auf
           * jeder Zählzeit. Doppeltes Tempo im Becken ist der billigste und
           * wirksamste Weg, einen Takt schneller wirken zu lassen, ohne ihn
           * schneller zu machen – und das Tempo liegt fest, weil die Schnitte
           * des Motion-Films daran hängen.
           */
          const teilung = voll ? 4 : 2;
          for (let teil = 0; teil < teilung; teil += 1) {
            const offen = voll && schlagNr === 3 && teil === teilung - 1;
            const betont = teil === 0;
            mischeEin(
              spuren.becken,
              zeit + teil * (SCHLAG / teilung),
              hihat(offen, (betont ? 0.5 : 0.26) * (voll ? 0.9 : 0.75)),
            );
          }
          if (voll) mischeEin(spuren.becken, zeit, ride(0.3));
        }

        // Wirbel am Ende des Abschnitts – das Signal „gleich passiert etwas".
        if (takt === 3 && (art === 'anlauf' || art === 'strophe')) {
          for (let s = 0; s < 8; s += 1) {
            const zeit = taktBeginn + 2 * SCHLAG + s * SECHZEHNTEL;
            mischeEin(spuren.schlagzeug, zeit, tom(-17 + s, 0.5 + s * 0.05));
          }
        }
        /*
         * Und ein kurzer Snare-Wirbel am Ende jedes zweiten Refrain-Takts.
         * Vier Abschnitte lang dieselbe Figur ist ein Takt; dieselbe Figur mit
         * einem Fill alle zwei Takte ist ein Stück.
         */
        if (voll && takt % 2 === 1) {
          for (let s = 0; s < 4; s += 1) {
            mischeEin(
              spuren.schlagzeug,
              taktBeginn + 3 * SCHLAG + s * SECHZEHNTEL,
              snare(0.3 + s * 0.16),
            );
          }
        }
      }

      if ((voll || art === 'bruecke') && takt === 0) {
        mischeEin(spuren.becken, taktBeginn, crash(voll ? 0.7 : 0.4));
        // Der Aufprall nach dem Anlauf: ein tiefer Ton, der wegrutscht.
        if (voll) mischeEin(spuren.fx, taktBeginn, subDrop(0.75));
      }
      // Ein zweites Becken in der Mitte des Refrains hält ihn wach.
      if (voll && takt === 2) {
        mischeEin(spuren.becken, taktBeginn, crash(0.4));
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
        /*
         * Der Galopp: auf jeder Zählzeit ein gehaltener Akkord, danach zwei
         * kurze abgedämpfte Anschläge. Gleichmäßige Achtel laufen mit; diese
         * Figur schiebt.
         */
        for (let schlagNr = 0; schlagNr < 4; schlagNr += 1) {
          const zeit = taktBeginn + schlagNr * SCHLAG;
          mischeEin(spuren.gitarre, zeit, gitarrenakkord(akkord.quinte, ACHTEL * 0.95, 1));
          mischeEin(spuren.gitarre, zeit + 2 * SECHZEHNTEL, gitarreGedaempft(akkord.quinte, 0.85));
          mischeEin(spuren.gitarre, zeit + 3 * SECHZEHNTEL, gitarreGedaempft(akkord.quinte, 0.7));
        }
        /*
         * Stabs auf den Gegenzählzeiten – sie füllen genau die Lücken, die
         * der Galopp offen lässt, und sitzen auf der Und-Zählzeit, wo der
         * Takt sonst am dünnsten ist.
         */
        for (const achtel of [1, 5]) {
          mischeEin(spuren.gitarre, taktBeginn + achtel * ACHTEL, stab(akkord.akkord, 0.55));
        }
      } else if (art === 'anlauf') {
        mischeEin(spuren.gitarre, taktBeginn, gitarrenakkord(akkord.quinte, TAKTLAENGE * 0.9, 0.5));
      }

      // --- Lead und Gegenmelodie -------------------------------------------
      if (voll) {
        const zeile = HOOK[takt % HOOK.length];
        zeile.forEach((halbton, s) => {
          if (halbton === null) return;
          mischeEin(spuren.lead, taktBeginn + s * ACHTEL, leadnote(halbton, ACHTEL * 1.6, 0.55));
          /*
           * Eine zweite Stimme eine Terz darüber, leiser. Welche Terz – große
           * oder kleine – entscheidet der Akkord: Die Melodie steht in Dur,
           * über den beiden Mollakkorden muss die Begleitstimme drei statt
           * vier Halbtöne höher liegen, sonst reibt sie.
           */
          const terz = akkord.name.endsWith('m') ? 3 : 4;
          mischeEin(
            spuren.lead,
            taktBeginn + s * ACHTEL,
            leadnote(halbton + terz, ACHTEL * 1.6, 0.26),
          );
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

  /*
   * Sidechain: Der Bass geht jedes Mal kurz zurück, wenn die Bassdrum tritt.
   *
   * Beide leben im selben Frequenzbereich, und wer sie gleichzeitig laufen
   * lässt, bekommt keinen doppelten Druck, sondern Matsch – die Begrenzung
   * am Ende zieht dann *alles* herunter, sobald der Tritt kommt. Hier folgt
   * die Bass-Lautstärke stattdessen der Hüllkurve der Bassdrum: Sie macht auf
   * jedem Tritt Platz und kommt sofort wieder. Das ist das Pumpen, an dem man
   * moderne Produktionen erkennt.
   *
   * Der Auslöser ist die Schlagzeugspur selbst, nicht ein zweites Raster:
   * Damit greift es an jedem Tritt, auch an den Doppelschlägen.
   */
  {
    const fenster = Math.round(0.006 * ABTASTRATE);
    const huellkurve = new Float64Array(n);
    let spitze = 0;
    for (let i = 0; i < n; i += 1) {
      const wert = Math.abs(spuren.schlagzeug[i]);
      // Schnell hoch, langsam runter – eine klassische Hüllkurvenverfolgung.
      spitze = wert > spitze ? wert : spitze * 0.99986;
      huellkurve[i] = spitze;
    }
    for (let i = 0; i < n; i += 1) {
      const ab = Math.min(1, huellkurve[Math.max(0, i - fenster)] * 1.5);
      spuren.bass[i] *= 1 - 0.72 * ab;
    }
  }

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
    const mitte = spuren.schlagzeug[i] * 1.0 + spuren.bass[i] * 0.9 + spuren.streicher[i] * 0.42;
    const seiteL = spuren.gitarre[i] * 0.66 + spuren.becken[i] * 0.5 + spuren.glocken[i] * 0.42;
    const seiteR = spuren.gitarre[i] * 0.58 + spuren.becken[i] * 0.56 + spuren.glocken[i] * 0.46;

    let l = (mitte + seiteL + leadL[i] * 0.58 + spuren.fx[i] * 0.45) * rand;
    let r = (mitte + seiteR + leadR[i] * 0.58 + spuren.fx[i] * 0.45) * rand;

    /*
     * Weiche Begrenzung – bewusst **milde**.
     *
     * Der erste Anlauf drückte hier zweistufig auf Lautheit: 3 dB mehr, aber
     * der Scheitelfaktor fiel von 13 auf 8,7 dB und die gemessene Dichte der
     * Anschläge *sank*, obwohl im Arrangement mehr Schläge stehen. Das ist
     * genau der falsche Tausch – plattgedrückt klingt lauter, aber nicht
     * schneller. Die Energie kommt aus den Noten, nicht aus dem Begrenzer.
     */
    l = Math.tanh(l * 0.95) * 0.94;
    r = Math.tanh(r * 0.95) * 0.94;

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
