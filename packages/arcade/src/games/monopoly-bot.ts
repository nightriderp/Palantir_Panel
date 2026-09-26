/**
 * Monopoly – Computergegner.
 *
 * Kein Suchbaum (der Würfel macht Vorausrechnen wertlos), sondern eine
 * Bewertung des Vermögens mit Aufschlag für Farbgruppen: Wer eine Gruppe
 * vervollständigt, kann bauen, und dort liegt das Geld. Die drei Stufen
 * unterscheiden sich in Rücklage, Kauf- und Baulust, Bietgrenzen und darin,
 * ob sie Handel erkennen und selbst anbieten.
 *
 * Der Bot sieht nur, was alle sehen (Besitz, Bargeld, Häuser); die Reihenfolge
 * der Kartenstapel nutzt er nicht.
 */

import { type RngState, nextRandom } from '../rng.js';
import { type BotLevel } from '../turn.js';
import { FELDER, GRUPPEN, BAHNHOEFE, WERKE, kaeuflich } from './monopoly-daten.js';
import {
  MINDEST_SCHRITT,
  abloeseBetrag,
  anzahlIn,
  besitztGruppe,
  gruppeHatHaeuser,
  handelAnwenden,
  hypothekWert,
  kannAbloesen,
  kannBauen,
  kannHypothek,
  kannVerkaufen,
  miete,
  pruefeAngebot,
  type Angebot,
  type MonopolyZug,
  type MonopolyZustand,
} from './monopoly-kern.js';

type Erlaubt = (m: MonopolyZug) => boolean;

function eigeneFelder(s: MonopolyZustand, seat: number): number[] {
  return FELDER.flatMap((_, i) => (s.besitzer[i] === seat ? [i] : []));
}

function runde10(x: number): number {
  return Math.floor(x / 10) * 10;
}

/** Größte Miete, die ein Gegner gerade verlangen könnte – daran misst sich die Rücklage. */
function gefahr(s: MonopolyZustand, seat: number): number {
  let max = 0;
  FELDER.forEach((_, i) => {
    const o = s.besitzer[i];
    if (o === null || o === undefined || o === seat) return;
    max = Math.max(max, miete(s, i, 7));
  });
  return max;
}

function reserve(s: MonopolyZustand, seat: number, level: BotLevel): number {
  if (level === 'leicht') return 50;
  const g = gefahr(s, seat);
  if (level === 'mittel') return Math.min(400, Math.max(100, Math.round(g * 0.4)));
  return Math.min(700, Math.max(150, Math.round(g * 0.6)));
}

/** Vermögen mit Aufschlag für (fast) vollständige Gruppen – Grundlage für Handel und Gebote. */
export function botWert(s: MonopolyZustand, seat: number): number {
  const p = s.spieler[seat];
  if (!p || p.bankrott) return 0;
  let w = p.geld + p.freiKarten.length * 30;
  FELDER.forEach((f, i) => {
    if (s.besitzer[i] !== seat) return;
    w += s.hypothek[i] ? Math.floor(f.preis / 2) : f.preis;
    w += (s.haeuser[i] ?? 0) * f.hauspreis;
  });
  for (let g = 0; g < 8; g += 1) {
    const felder = GRUPPEN[g] ?? [];
    const n = anzahlIn(s, seat, felder);
    const summe = felder.reduce((a, f) => a + (FELDER[f]?.preis ?? 0), 0);
    if (n === felder.length) w += summe * 1.5;
    else if (n === felder.length - 1 && n > 0) w += summe * 0.2;
  }
  w += [0, 0, 40, 120, 250][anzahlIn(s, seat, BAHNHOEFE)] ?? 0;
  if (anzahlIn(s, seat, WERKE) === 2) w += 40;
  return w;
}

function nachHandel(s: MonopolyZustand, a: Angebot): MonopolyZustand {
  const kopie: MonopolyZustand = {
    ...s,
    besitzer: [...s.besitzer],
    spieler: s.spieler.map((p) => ({ ...p, freiKarten: [...p.freiKarten] })),
  };
  handelAnwenden(kopie, a);
  return kopie;
}

/** Würde `level` als Empfänger das Angebot annehmen? */
function annehmbar(s: MonopolyZustand, a: Angebot, level: BotLevel, zufall: number): boolean {
  if (pruefeAngebot(s, a) !== null) return false;
  const danach = nachHandel(s, a);
  const ich = botWert(danach, a.an) - botWert(s, a.an);
  const er = botWert(danach, a.von) - botWert(s, a.von);
  if (level === 'leicht') return ich > -20 && zufall < 0.8;
  if (level === 'mittel') return ich > 0 && ich >= er * 0.5;
  return ich > 0 && ich >= er;
}

function handelsZug(a: Angebot): MonopolyZug {
  return {
    type: 'handel',
    an: a.an,
    gebeFelder: a.gebeFelder,
    nehmeFelder: a.nehmeFelder,
    gebeGeld: a.gebeGeld,
    nehmeGeld: a.nehmeGeld,
    gebeKarten: a.gebeKarten,
    nehmeKarten: a.nehmeKarten,
  };
}

/**
 * Sucht ein Angebot, das dem Bot eine Farbgruppe schließt und das der Partner
 * vermutlich annimmt (geschätzt mit der mittleren Stufe – ob dort ein Mensch
 * sitzt, weiß der Bot nicht).
 */
function handelsVorschlag(s: MonopolyZustand, seat: number, level: BotLevel): MonopolyZug | null {
  const p = s.spieler[seat];
  if (!p) return null;
  const rest = p.geld - reserve(s, seat, level) * 0.5;
  for (let g = 0; g < 8; g += 1) {
    const felder = GRUPPEN[g] ?? [];
    if (anzahlIn(s, seat, felder) !== felder.length - 1) continue;
    const fehlend = felder.find((f) => s.besitzer[f] !== seat);
    if (fehlend === undefined) continue;
    const owner = s.besitzer[fehlend];
    if (owner === null || owner === undefined || owner === seat) continue;
    const preis = FELDER[fehlend]?.preis ?? 0;
    const basis: Angebot = {
      von: seat,
      an: owner,
      gebeFelder: [],
      nehmeFelder: [fehlend],
      gebeGeld: 0,
      nehmeGeld: 0,
      gebeKarten: 0,
      nehmeKarten: 0,
    };
    const lohnt = (a: Angebot): boolean =>
      annehmbar(s, a, 'mittel', 0) && botWert(nachHandel(s, a), seat) - botWert(s, seat) > 0;
    // Tausch: ein Grundstück, das dem Partner seinerseits eine Gruppe schließt.
    for (const t of eigeneFelder(s, seat)) {
      const tg = FELDER[t]?.gruppe ?? -1;
      if (tg < 0 || tg > 7 || tg === g || gruppeHatHaeuser(s, t)) continue;
      const tf = GRUPPEN[tg] ?? [];
      if (anzahlIn(s, owner, tf) !== tf.length - 1) continue;
      const diff = Math.max(0, preis - (FELDER[t]?.preis ?? 0));
      if (diff > rest) continue;
      const a = { ...basis, gebeFelder: [t], gebeGeld: diff };
      if (lohnt(a)) return handelsZug(a);
    }
    for (const faktor of [1.5, 2, 2.5, 3]) {
      const geld = runde10(preis * faktor);
      if (geld > rest) break;
      const a = { ...basis, gebeGeld: geld };
      if (lohnt(a)) return handelsZug(a);
    }
  }
  return null;
}

function schuldenTilgen(s: MonopolyZustand, seat: number, erlaubt: Erlaubt): MonopolyZug {
  if (erlaubt({ type: 'bezahlen' })) return { type: 'bezahlen' };
  const eigene = eigeneFelder(s, seat);
  // Erst Einzelgrundstücke belasten, dann Häuser abgeben, zuletzt die Gruppen.
  const einzeln = eigene.filter((f) => {
    const g = FELDER[f]?.gruppe ?? -1;
    return kannHypothek(s, seat, f) === null && !(g < 8 && besitztGruppe(s, seat, g));
  });
  einzeln.sort((a, b) => hypothekWert(a) - hypothekWert(b));
  const e = einzeln[0];
  if (e !== undefined) return { type: 'hypothek', feld: e };
  const verkauf = eigene.filter((f) => kannVerkaufen(s, seat, f) === null);
  verkauf.sort((a, b) => (FELDER[a]?.hauspreis ?? 0) - (FELDER[b]?.hauspreis ?? 0));
  const v = verkauf[0];
  if (v !== undefined) return { type: 'verkaufen', feld: v };
  const rest = eigene.find((f) => kannHypothek(s, seat, f) === null);
  if (rest !== undefined) return { type: 'hypothek', feld: rest };
  return { type: 'aufgeben' };
}

function gruppenLage(
  s: MonopolyZustand,
  seat: number,
  feld: number,
): { schliesst: boolean; blockt: boolean } {
  const g = FELDER[feld]?.gruppe ?? -1;
  const felder = (GRUPPEN[g] ?? []).filter((f) => f !== feld);
  if (felder.length === 0) return { schliesst: false, blockt: false };
  const schliesst = felder.every((f) => s.besitzer[f] === seat);
  const erster = s.besitzer[felder[0] ?? 0];
  const blockt =
    erster !== null &&
    erster !== undefined &&
    erster !== seat &&
    felder.every((f) => s.besitzer[f] === erster);
  return { schliesst, blockt };
}

function kaufEntscheidung(
  s: MonopolyZustand,
  seat: number,
  level: BotLevel,
  rng: RngState,
  erlaubt: Erlaubt,
): MonopolyZug {
  const feld = s.kaufFeld ?? 0;
  const p = s.spieler[seat];
  const preis = FELDER[feld]?.preis ?? 0;
  if (!p) return { type: 'ablehnen' };
  const { schliesst, blockt } = gruppenLage(s, seat, feld);
  const res = reserve(s, seat, level);
  let kaufen = false;
  if (level === 'leicht') kaufen = p.geld - preis >= res && nextRandom(rng) < 0.8;
  else if (level === 'mittel') kaufen = p.geld - preis >= res || (schliesst && p.geld >= preis);
  else
    kaufen =
      p.geld - preis >= Math.min(res * 0.5, 100) || ((schliesst || blockt) && p.geld >= preis);
  if (kaufen && erlaubt({ type: 'kaufen' })) return { type: 'kaufen' };
  // Schwer belastet für eine vollständige Gruppe notfalls ein Einzelgrundstück.
  if (level === 'schwer' && schliesst && p.geld < preis) {
    const pfand = eigeneFelder(s, seat).find((f) => {
      const g = FELDER[f]?.gruppe ?? -1;
      return (
        g !== FELDER[feld]?.gruppe &&
        kannHypothek(s, seat, f) === null &&
        !(g < 8 && besitztGruppe(s, seat, g))
      );
    });
    const gesamt = eigeneFelder(s, seat)
      .filter((f) => kannHypothek(s, seat, f) === null)
      .reduce((a, f) => a + hypothekWert(f), 0);
    if (pfand !== undefined && p.geld + gesamt >= preis) return { type: 'hypothek', feld: pfand };
  }
  return { type: 'ablehnen' };
}

function gebot(
  s: MonopolyZustand,
  seat: number,
  level: BotLevel,
  rng: RngState,
  erlaubt: Erlaubt,
): MonopolyZug {
  const v = s.versteigerung;
  const p = s.spieler[seat];
  if (!v || !p) return { type: 'passen' };
  const f = FELDER[v.feld];
  if (!f) return { type: 'passen' };
  const { schliesst, blockt } = gruppenLage(s, seat, v.feld);
  let faktor: number;
  if (level === 'leicht') faktor = 0.6 + nextRandom(rng) * 0.5;
  else if (level === 'mittel') faktor = schliesst ? 1.4 : blockt ? 1.2 : 1.0;
  else {
    faktor = schliesst ? 1.9 : blockt ? 1.5 : 0.95;
    if (f.typ === 'bahnhof') faktor += 0.15 * anzahlIn(s, seat, BAHNHOEFE);
  }
  const rueck = level === 'leicht' ? 0 : reserve(s, seat, level) * 0.5;
  const max = Math.min(Math.floor(f.preis * faktor), p.geld - rueck);
  const mindest = v.bieter === null ? MINDEST_SCHRITT : v.gebot + MINDEST_SCHRITT;
  if (mindest > max) return { type: 'passen' };
  // In großen Schritten auf die eigene Grenze zu – hält Versteigerungen kurz.
  const betrag = Math.min(max, Math.max(mindest, runde10(v.gebot + (max - v.gebot) / 2)));
  const zug: MonopolyZug = { type: 'bieten', betrag };
  return erlaubt(zug) ? zug : { type: 'passen' };
}

function verwalten(
  s: MonopolyZustand,
  seat: number,
  level: BotLevel,
  rng: RngState,
  erlaubt: Erlaubt,
): MonopolyZug | null {
  const p = s.spieler[seat];
  if (!p) return null;
  const res = reserve(s, seat, level);
  const eigene = eigeneFelder(s, seat);

  const inGruppe = (f: number): boolean => {
    const g = FELDER[f]?.gruppe ?? -1;
    return g >= 0 && g < 8 && besitztGruppe(s, seat, g);
  };
  // Schwer baut mit halber Rücklage – drei Häuser auf einer Gruppe sind der
  // große Mietsprung, dafür darf das Polster dünner werden.
  const bauRes = level === 'schwer' ? res * 0.5 : res;

  // Bebaubar, wenn Geld keine Rolle spielte (Wunschliste für Schwer).
  const reich: MonopolyZustand = {
    ...s,
    spieler: s.spieler.map((q, i) => (i === seat ? { ...q, geld: 1_000_000 } : q)),
  };
  const wunsch = eigene.filter((f) => kannBauen(reich, seat, f) === null);

  // Hypotheken in eigenen Gruppen zuerst ablösen – sie blockieren das Bauen.
  const abloesbar = eigene.filter((f) => kannAbloesen(s, seat, f) === null);
  abloesbar.sort((a, b) => (inGruppe(a) ? 0 : 1) - (inGruppe(b) ? 0 : 1) || a - b);
  for (const f of abloesbar) {
    const kosten = abloeseBetrag(f);
    if (level === 'schwer') {
      if (
        inGruppe(f)
          ? p.geld - kosten >= bauRes
          : wunsch.length === 0 && p.geld - kosten >= res * 1.5
      ) {
        return { type: 'abloesen', feld: f };
      }
    } else if (p.geld - kosten >= res * (level === 'leicht' ? 1 : 1.5)) {
      return { type: 'abloesen', feld: f };
    }
  }

  const baubar = eigene.filter((f) => kannBauen(s, seat, f) === null);
  // Bestes Verhältnis von Mietsprung zu Baukosten zuerst.
  const nutzen = (f: number): number => {
    const d = FELDER[f];
    if (!d) return 0;
    const h = s.haeuser[f] ?? 0;
    return ((d.miete[h + 1] ?? 0) - (d.miete[h] ?? 0)) / d.hauspreis;
  };
  if (baubar.length > 0 && (level !== 'leicht' || nextRandom(rng) < 0.6)) {
    baubar.sort((a, b) => nutzen(b) - nutzen(a) || a - b);
    const f = baubar[0];
    if (f !== undefined && p.geld - (FELDER[f]?.hauspreis ?? 0) >= bauRes)
      return { type: 'bauen', feld: f };
  }

  // Schwer belastet Einzelgrundstücke, um eine Gruppe auf drei Häuser zu bringen.
  if (level === 'schwer' && wunsch.some((f) => (s.haeuser[f] ?? 0) < 3)) {
    const pfand = eigene
      .filter((f) => !inGruppe(f) && kannHypothek(s, seat, f) === null)
      .sort((a, b) => hypothekWert(a) - hypothekWert(b))[0];
    if (pfand !== undefined) return { type: 'hypothek', feld: pfand };
  }

  if (s.handelZahl === 0 && level !== 'leicht') {
    const chance = level === 'schwer' ? 0.35 : 0.1;
    if (nextRandom(rng) < chance) {
      const vorschlag = handelsVorschlag(s, seat, level);
      if (vorschlag && erlaubt(vorschlag)) return vorschlag;
    }
  }
  return null;
}

function gefaengnisEntscheidung(
  s: MonopolyZustand,
  seat: number,
  level: BotLevel,
  rng: RngState,
  erlaubt: Erlaubt,
): MonopolyZug | null {
  const p = s.spieler[seat];
  if (!p || !p.gefaengnis || s.phase !== 'wuerfeln') return null;
  const frei = FELDER.filter((_, i) => kaeuflich(i) && s.besitzer[i] === null).length;
  let raus: boolean;
  if (level === 'leicht') raus = nextRandom(rng) < 0.4;
  // Solange es noch viel zu kaufen gibt, lohnt die Freiheit; später ist das
  // Gefängnis ein sicherer Ort vor hohen Mieten.
  else if (level === 'mittel') raus = frei > 6;
  else raus = frei > 4;
  if (!raus) return null;
  if (erlaubt({ type: 'karteNutzen' })) return { type: 'karteNutzen' };
  if (p.geld >= 50 + reserve(s, seat, level) && erlaubt({ type: 'freikaufen' }))
    return { type: 'freikaufen' };
  return null;
}

export function botZug(
  s: MonopolyZustand,
  seat: number,
  level: BotLevel,
  rng: RngState,
  erlaubt: Erlaubt,
): MonopolyZug {
  const sicher = (m: MonopolyZug | null, rueckfall: MonopolyZug): MonopolyZug =>
    m && erlaubt(m) ? m : rueckfall;
  switch (s.phase) {
    case 'zahlen':
      return sicher(schuldenTilgen(s, seat, erlaubt), { type: 'aufgeben' });
    case 'handel': {
      const a = s.angebot;
      const ja = a !== null && annehmbar(s, a, level, nextRandom(rng));
      return sicher(ja ? { type: 'handelAnnehmen' } : null, { type: 'handelAblehnen' });
    }
    case 'versteigerung':
      return sicher(gebot(s, seat, level, rng, erlaubt), { type: 'passen' });
    case 'kaufen':
      return sicher(kaufEntscheidung(s, seat, level, rng, erlaubt), { type: 'ablehnen' });
    case 'wuerfeln':
    case 'zugEnde': {
      const ende: MonopolyZug =
        s.phase === 'wuerfeln' || s.paschNochmal ? { type: 'wuerfeln' } : { type: 'zugEnde' };
      const m =
        verwalten(s, seat, level, rng, erlaubt) ??
        gefaengnisEntscheidung(s, seat, level, rng, erlaubt);
      return sicher(m, ende);
    }
    default:
      return { type: 'zugEnde' };
  }
}
