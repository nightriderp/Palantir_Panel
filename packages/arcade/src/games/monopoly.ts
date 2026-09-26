/**
 * Monopoly – klassische deutsche Ausgabe für 2–6 Spieler.
 *
 * Ablauf eines Zugs in Phasen: `wuerfeln` → (`kaufen` → `versteigerung`) →
 * `zugEnde`. Kann jemand nicht zahlen, schiebt sich `zahlen` dazwischen; ein
 * Handelsangebot macht kurz den Empfänger zum aktiven Sitz (`handel`), danach
 * geht es in der alten Phase weiter.
 *
 * Alle Zahlungen laufen über die Schuldenliste `schulden`: Wer genug Bargeld
 * hat, zahlt sofort, sonst steht er in `zahlen`, bis er verkauft, belastet
 * oder aufgibt. So muss keine Stelle, die Geld verlangt (Miete, Steuer,
 * Karten, Geburtstag), die Pleite selbst behandeln.
 */

import { createRng, rollDie, shuffled } from '../rng.js';
import {
  type TurnGame,
  type TurnLogEntry,
  type TurnOutcome,
  cloneState,
  intIn,
  isRecord,
  pushLog,
} from '../turn.js';
import {
  BANK_HAEUSER,
  BANK_HOTELS,
  BAHNHOEFE,
  FELDER,
  GEFAENGNIS_FELD,
  KAUTION,
  LOS_GELD,
  WERKE,
  FREI_KARTE,
  karte,
  sitzName,
  type Feld,
  type StapelName,
} from './monopoly-daten.js';
import {
  MAX_HANDEL_PRO_ZUG,
  MINDEST_SCHRITT,
  abloeseBetrag,
  hypothekWert,
  handelAnwenden,
  kannAbloesen,
  kannBauen,
  kannHypothek,
  kannVerkaufen,
  lebende,
  miete,
  pruefeAngebot,
  vermoegen,
  type Angebot,
  type EreignisArt,
  type MonopolyOptionen,
  type MonopolyZug,
  type MonopolyZustand,
  type Phase,
  type Versteigerung,
} from './monopoly-kern.js';
import { botZug } from './monopoly-bot.js';

export type { MonopolyOptionen, MonopolyZug, MonopolyZustand } from './monopoly-kern.js';

/** Sicherheitsnetz, falls „Rundenlimit aus" und niemand pleitegeht. */
export const HARTE_RUNDENGRENZE = 500;

export const STARTGELD_WAHL = [1000, 1500, 2000, 2500] as const;
export const RUNDENLIMIT_WAHL = [0, 20, 30, 50] as const;

const DEFAULT_OPTIONS: MonopolyOptionen = {
  startgeld: 1500,
  versteigerung: true,
  freiParkenTopf: false,
  rundenlimit: 30,
};

// ---------------------------------------------------------------------------
// Sicht
// ---------------------------------------------------------------------------

export interface MonopolyAktionen {
  wuerfeln: boolean;
  freikaufen: boolean;
  karteNutzen: boolean;
  kaufen: boolean;
  ablehnen: boolean;
  bieten: boolean;
  passen: boolean;
  bezahlen: boolean;
  aufgeben: boolean;
  zugEnde: boolean;
  handel: boolean;
  handelAntwort: boolean;
  bauen: number[];
  verkaufen: number[];
  hypothek: number[];
  abloesen: number[];
}

export interface MonopolyView {
  felder: readonly Feld[];
  optionen: MonopolyOptionen;
  spieler: {
    geld: number;
    pos: number;
    gefaengnis: boolean;
    versuche: number;
    freiKarten: number;
    bankrott: boolean;
    vermoegen: number;
  }[];
  besitzer: (number | null)[];
  haeuser: number[];
  hypothek: boolean[];
  am: number;
  phase: Phase;
  runde: number;
  zugNr: number;
  wuerfel: [number, number] | null;
  paschNochmal: boolean;
  kaufFeld: number | null;
  versteigerung: Versteigerung | null;
  mindestGebot: number;
  schuld: { von: number; an: number | null; betrag: number; grund: string } | null;
  angebot: Angebot | null;
  letzteKarte: { stapel: StapelName; text: string; seat: number; zugNr: number } | null;
  topf: number;
  bankHaeuser: number;
  bankHotels: number;
  letzteBewegung: { seat: number; von: number; nach: number } | null;
  letztes: { nr: number; arten: EreignisArt[] };
  sieger: number[] | null;
  /** Was `mySeat` gerade tun darf (leer für Zuschauer und wartende Sitze). */
  aktionen: MonopolyAktionen;
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------

function eintrag(s: MonopolyZustand, seat: number | null, text: string): void {
  s.log = pushLog(s.log, { seat, text });
}

function markiere(s: MonopolyZustand, art: EreignisArt): void {
  if (!s.letztes.arten.includes(art)) s.letztes.arten.push(art);
}

function spieler(s: MonopolyZustand, seat: number) {
  const p = s.spieler[seat];
  if (!p) throw new Error(`monopoly: Sitz ${seat} fehlt.`);
  return p;
}

function feldName(feld: number): string {
  return FELDER[feld]?.name ?? `Feld ${feld}`;
}

function euro(betrag: number): string {
  return `${betrag.toLocaleString('de-DE')} €`;
}

function schuld(
  s: MonopolyZustand,
  von: number,
  an: number | null,
  betrag: number,
  grund: string,
  topf: boolean,
): void {
  if (betrag <= 0) return;
  s.schulden.push({ von, an, betrag, grund, topf });
}

function insGefaengnis(s: MonopolyZustand, seat: number): void {
  const p = spieler(s, seat);
  s.letzteBewegung = { seat, von: p.pos, nach: GEFAENGNIS_FELD };
  p.pos = GEFAENGNIS_FELD;
  p.gefaengnis = true;
  p.versuche = 0;
  if (seat === s.am) {
    s.paschNochmal = false;
    s.paschZahl = 0;
  }
  markiere(s, 'gefaengnis');
}

interface LandeMod {
  augen: number;
  bahnhofDoppelt?: boolean;
  werkZehn?: boolean;
}

function bewegeUm(s: MonopolyZustand, seat: number, schritte: number): void {
  const p = spieler(s, seat);
  const von = p.pos;
  const nach = (von + schritte) % 40;
  if (von + schritte >= 40) {
    p.geld += LOS_GELD;
    eintrag(s, seat, `kommt über Los und kassiert ${euro(LOS_GELD)}.`);
  }
  p.pos = nach;
  s.letzteBewegung = { seat, von, nach };
  landen(s, seat, { augen: schritte });
}

/** Vorwärts bis `ziel` (Karten); über Los gibt es Geld. */
function zieheNach(s: MonopolyZustand, seat: number, ziel: number, mod: LandeMod): void {
  const p = spieler(s, seat);
  const von = p.pos;
  if (ziel < von) {
    p.geld += LOS_GELD;
    eintrag(s, seat, `kommt über Los und kassiert ${euro(LOS_GELD)}.`);
  }
  p.pos = ziel;
  s.letzteBewegung = { seat, von, nach: ziel };
  eintrag(s, seat, `zieht auf ${feldName(ziel)}.`);
  landen(s, seat, mod);
}

function landen(s: MonopolyZustand, seat: number, mod: LandeMod): void {
  const p = spieler(s, seat);
  const pos = p.pos;
  const f = FELDER[pos];
  if (!f) return;
  switch (f.typ) {
    case 'strasse':
    case 'bahnhof':
    case 'werk': {
      const owner = s.besitzer[pos] ?? null;
      if (owner === null) {
        s.kaufFeld = pos;
        s.phase = 'kaufen';
        return;
      }
      if (owner === seat) return;
      if (s.hypothek[pos]) {
        eintrag(s, seat, `${f.name} ist belastet – keine Miete fällig.`);
        return;
      }
      let augen = mod.augen;
      if (mod.werkZehn) {
        const a = rollDie(s.rng);
        const b = rollDie(s.rng);
        augen = a + b;
        s.wuerfel = [a, b];
        eintrag(s, seat, `würfelt für das Werk ${a} + ${b}.`);
      }
      const betrag = miete(s, pos, augen, mod);
      schuld(s, seat, owner, betrag, `Miete für ${f.name}`, false);
      markiere(s, 'miete');
      return;
    }
    case 'steuer':
      schuld(s, seat, null, f.steuer, f.name, true);
      markiere(s, 'geld');
      return;
    case 'ereignis':
      karteZiehen(s, seat, 'ereignis');
      return;
    case 'gemeinschaft':
      karteZiehen(s, seat, 'gemeinschaft');
      return;
    case 'gehGefaengnis':
      eintrag(s, seat, 'muss ins Gefängnis.');
      insGefaengnis(s, seat);
      return;
    case 'parken':
      if (s.optionen.freiParkenTopf && s.topf > 0) {
        p.geld += s.topf;
        eintrag(s, seat, `räumt den Frei-Parken-Topf ab: ${euro(s.topf)}.`);
        s.topf = 0;
        markiere(s, 'geld');
      }
      return;
    default:
      return;
  }
}

function naechstesAus(pos: number, ziele: readonly number[]): number {
  for (let i = 1; i <= 40; i += 1) {
    const f = (pos + i) % 40;
    if (ziele.includes(f)) return f;
  }
  return ziele[0] ?? 0;
}

function karteZiehen(s: MonopolyZustand, seat: number, stapel: StapelName): void {
  const deck = s.stapel[stapel];
  const id = deck.shift();
  if (id === undefined) return;
  const k = karte(stapel, id);
  if (!k) return;
  s.letzteKarte = { stapel, id, seat, zugNr: s.zugNr };
  markiere(s, 'karte');
  // Die Freikarte bleibt beim Spieler, bis er sie nutzt oder abgibt.
  if (k.effekt.art !== 'frei') deck.push(id);
  eintrag(
    s,
    seat,
    `zieht eine ${stapel === 'ereignis' ? 'Ereigniskarte' : 'Gemeinschaftskarte'}: „${k.text}"`,
  );
  const p = spieler(s, seat);
  const e = k.effekt;
  switch (e.art) {
    case 'geld':
      if (e.betrag > 0) p.geld += e.betrag;
      else schuld(s, seat, null, -e.betrag, 'Karte', true);
      return;
    case 'ziel':
      zieheNach(s, seat, e.feld, { augen: 0 });
      return;
    case 'bahnhof':
      zieheNach(s, seat, naechstesAus(p.pos, BAHNHOEFE), { augen: 0, bahnhofDoppelt: true });
      return;
    case 'werk':
      zieheNach(s, seat, naechstesAus(p.pos, WERKE), { augen: 0, werkZehn: true });
      return;
    case 'zurueck': {
      const von = p.pos;
      p.pos = (p.pos - e.schritte + 40) % 40;
      s.letzteBewegung = { seat, von, nach: p.pos };
      eintrag(s, seat, `geht zurück auf ${feldName(p.pos)}.`);
      landen(s, seat, { augen: 0 });
      return;
    }
    case 'gefaengnis':
      insGefaengnis(s, seat);
      return;
    case 'frei':
      p.freiKarten.push(stapel);
      return;
    case 'reparatur': {
      let summe = 0;
      FELDER.forEach((_, i) => {
        if (s.besitzer[i] !== seat) return;
        const h = s.haeuser[i] ?? 0;
        summe += h === 5 ? e.hotel : h * e.haus;
      });
      if (summe > 0) schuld(s, seat, null, summe, 'Reparaturen', true);
      else eintrag(s, seat, 'hat nichts zu reparieren.');
      return;
    }
    case 'jedem':
      for (const o of lebende(s)) if (o !== seat) schuld(s, seat, o, e.betrag, 'Karte', false);
      return;
    case 'vonJedem':
      for (const o of lebende(s)) if (o !== seat) schuld(s, o, seat, e.betrag, 'Geschenk', false);
      return;
  }
}

/** Zahlt eine Schuld (Bargeld reicht). */
function zahle(s: MonopolyZustand, index: number): void {
  const d = s.schulden[index];
  if (!d) return;
  const von = spieler(s, d.von);
  von.geld -= d.betrag;
  const an = d.an !== null && !spieler(s, d.an).bankrott ? d.an : null;
  if (an !== null) {
    spieler(s, an).geld += d.betrag;
    eintrag(s, d.von, `zahlt ${euro(d.betrag)} an ${sitzName(an)} (${d.grund}).`);
  } else {
    if (d.topf && s.optionen.freiParkenTopf) s.topf += d.betrag;
    eintrag(s, d.von, `zahlt ${euro(d.betrag)} (${d.grund}).`);
  }
  s.schulden.splice(index, 1);
}

/**
 * Nach jeder Aktion: offene Schulden eintreiben, sonst den Zug fortsetzen.
 * Bleibt in `kaufen`/`versteigerung`/`ende` stehen, weil dort jemand entscheiden muss.
 */
function abschliessen(s: MonopolyZustand): void {
  if (s.phase === 'kaufen' || s.phase === 'versteigerung' || s.phase === 'ende') return;
  while (s.schulden.length > 0) {
    const d = s.schulden[0];
    if (!d) break;
    const von = spieler(s, d.von);
    if (von.bankrott) {
      s.schulden.shift();
      continue;
    }
    if (von.geld >= d.betrag) {
      zahle(s, 0);
      continue;
    }
    s.phase = 'zahlen';
    return;
  }
  if (spieler(s, s.am).bankrott) {
    naechsterSpieler(s);
    return;
  }
  const w = s.weiter;
  s.weiter = { art: 'zugEnde' };
  s.phase = 'zugEnde';
  if (w.art === 'bewegen') {
    bewegeUm(s, s.am, w.schritte);
    abschliessen(s);
  }
}

function beenden(s: MonopolyZustand, text: string, sieger: number[]): void {
  s.phase = 'ende';
  s.sieger = sieger;
  s.endeText = text;
  s.versteigerung = null;
  s.angebot = null;
  s.kaufFeld = null;
  s.schulden = [];
  markiere(s, 'ende');
  eintrag(s, null, text);
}

function beendenNachVermoegen(s: MonopolyZustand, grund: string): void {
  const alive = lebende(s);
  const werte = alive.map((i) => vermoegen(s, i));
  const max = Math.max(...werte);
  const sieger = alive.filter((_, k) => werte[k] === max);
  const namen = sieger.map(sitzName).join(' und ');
  beenden(
    s,
    `${grund} – ${namen} ${sieger.length > 1 ? 'teilen sich' : 'hat'} das größte Vermögen (${euro(max)}).`,
    sieger,
  );
}

function naechsterSpieler(s: MonopolyZustand): void {
  const alive = lebende(s);
  if (alive.length <= 1) {
    const w = alive[0];
    if (w !== undefined) beenden(s, `${sitzName(w)} gewinnt – alle anderen sind pleite.`, [w]);
    return;
  }
  const n = s.spieler.length;
  let next = s.am;
  for (let i = 0; i < n; i += 1) {
    next = (next + 1) % n;
    if (!spieler(s, next).bankrott) break;
  }
  if (next <= s.am) s.runde += 1;
  s.am = next;
  s.phase = 'wuerfeln';
  s.paschZahl = 0;
  s.paschNochmal = false;
  s.handelZahl = 0;
  s.kaufFeld = null;
  s.weiter = { art: 'zugEnde' };
  s.zugNr += 1;
  markiere(s, 'zug');
  const limit = s.optionen.rundenlimit;
  if (limit > 0 && s.runde > limit) {
    beendenNachVermoegen(s, `Rundenlimit (${limit}) erreicht`);
  } else if (s.runde > HARTE_RUNDENGRENZE) {
    beendenNachVermoegen(s, `Nach ${HARTE_RUNDENGRENZE} Runden ist Schluss`);
  }
}

function bankrott(s: MonopolyZustand, seat: number, glaeubiger: number | null): void {
  const p = spieler(s, seat);
  const an = glaeubiger !== null && !spieler(s, glaeubiger).bankrott ? glaeubiger : null;
  // Gebäude gehen zum halben Preis an die Bank zurück, der Erlös zählt zur Masse.
  FELDER.forEach((f, i) => {
    if (s.besitzer[i] !== seat) return;
    const h = s.haeuser[i] ?? 0;
    if (h > 0) {
      p.geld += Math.floor((h * f.hauspreis) / 2);
      if (h === 5) s.bankHotels += 1;
      else s.bankHaeuser += h;
      s.haeuser[i] = 0;
    }
  });
  if (an !== null) {
    const ziel = spieler(s, an);
    ziel.geld += Math.max(0, p.geld);
    FELDER.forEach((_, i) => {
      if (s.besitzer[i] === seat) s.besitzer[i] = an;
    });
    ziel.freiKarten.push(...p.freiKarten);
    eintrag(s, seat, `ist pleite. Alles geht an ${sitzName(an)}.`);
  } else {
    // Die Bank versteigert nicht: Die Grundstücke sind einfach wieder frei.
    FELDER.forEach((_, i) => {
      if (s.besitzer[i] === seat) {
        s.besitzer[i] = null;
        s.hypothek[i] = false;
      }
    });
    for (const k of p.freiKarten) freikarteZurueck(s, k);
    eintrag(s, seat, 'ist pleite. Die Grundstücke gehen zurück an die Bank.');
  }
  p.geld = 0;
  p.freiKarten = [];
  p.bankrott = true;
  p.gefaengnis = false;
  s.schulden = s.schulden
    .filter((d) => d.von !== seat)
    .map((d) => (d.an === seat ? { ...d, an: null } : d));
  markiere(s, 'bankrott');
  const alive = lebende(s);
  if (alive.length <= 1) {
    const w = alive[0];
    if (w !== undefined) beenden(s, `${sitzName(w)} gewinnt – alle anderen sind pleite.`, [w]);
  }
}

function freikarteZurueck(s: MonopolyZustand, stapel: StapelName): void {
  const id = FREI_KARTE[stapel];
  if (!s.stapel[stapel].includes(id)) s.stapel[stapel].push(id);
}

// ---------------------------------------------------------------------------
// Versteigerung
// ---------------------------------------------------------------------------

function mindestGebot(v: Versteigerung): number {
  return v.bieter === null ? MINDEST_SCHRITT : v.gebot + MINDEST_SCHRITT;
}

function versteigerungWeiter(s: MonopolyZustand, vonSeat: number): void {
  const v = s.versteigerung;
  if (!v) return;
  const len = v.reihenfolge.length;
  const start = v.reihenfolge.indexOf(vonSeat);
  for (let i = 1; i <= len; i += 1) {
    const cand = v.reihenfolge[(start + i) % len];
    if (cand === undefined || !v.aktiv.includes(cand)) continue;
    // Einmal reihum ohne neues Gebot: der Höchstbietende bekommt den Zuschlag.
    if (cand === v.bieter) {
      zuschlag(s);
      return;
    }
    if (spieler(s, cand).geld < mindestGebot(v)) {
      v.aktiv = v.aktiv.filter((x) => x !== cand);
      continue;
    }
    v.dran = cand;
    return;
  }
  zuschlag(s);
}

function zuschlag(s: MonopolyZustand): void {
  const v = s.versteigerung;
  if (!v) return;
  if (v.bieter !== null) {
    spieler(s, v.bieter).geld -= v.gebot;
    s.besitzer[v.feld] = v.bieter;
    eintrag(s, v.bieter, `ersteigert ${feldName(v.feld)} für ${euro(v.gebot)}.`);
    markiere(s, 'kauf');
  } else {
    eintrag(s, null, `Niemand bietet – ${feldName(v.feld)} bleibt bei der Bank.`);
  }
  s.versteigerung = null;
  s.phase = 'zugEnde';
  abschliessen(s);
}

// ---------------------------------------------------------------------------
// Züge
// ---------------------------------------------------------------------------

function activeSeats(s: MonopolyZustand): number[] {
  switch (s.phase) {
    case 'ende':
      return [];
    case 'versteigerung':
      return s.versteigerung ? [s.versteigerung.dran] : [];
    case 'zahlen': {
      const d = s.schulden[0];
      return d ? [d.von] : [];
    }
    case 'handel':
      return s.angebot ? [s.angebot.an] : [];
    default:
      return [s.am];
  }
}

const VERWALTEN: readonly Phase[] = ['wuerfeln', 'zugEnde'];
const GELD_BESCHAFFEN: readonly Phase[] = ['wuerfeln', 'zugEnde', 'kaufen', 'zahlen'];

/** Fehlertext oder `null`, wenn der Zug jetzt erlaubt ist. */
function pruefe(s: MonopolyZustand, seat: number, m: MonopolyZug): string | null {
  if (s.phase === 'ende') return 'Die Partie ist vorbei.';
  if (!activeSeats(s).includes(seat)) return 'Du bist gerade nicht am Zug.';
  const p = s.spieler[seat];
  if (!p) return 'Unbekannter Sitz.';
  switch (m.type) {
    case 'wuerfeln':
      if (s.phase === 'wuerfeln') return null;
      if (s.phase === 'zugEnde' && s.paschNochmal) return null;
      return 'Jetzt wird nicht gewürfelt.';
    case 'freikaufen':
      if (s.phase !== 'wuerfeln' || !p.gefaengnis) return 'Du sitzt nicht im Gefängnis.';
      return p.geld >= KAUTION ? null : `Für die Kaution fehlen dir ${euro(KAUTION - p.geld)}.`;
    case 'karteNutzen':
      if (s.phase !== 'wuerfeln' || !p.gefaengnis) return 'Du sitzt nicht im Gefängnis.';
      return p.freiKarten.length > 0 ? null : 'Du hast keine Gefängnisfrei-Karte.';
    case 'kaufen': {
      if (s.phase !== 'kaufen' || s.kaufFeld === null) return 'Hier gibt es nichts zu kaufen.';
      const preis = FELDER[s.kaufFeld]?.preis ?? 0;
      return p.geld >= preis
        ? null
        : 'Dafür reicht dein Geld nicht – nimm eine Hypothek auf oder lehne ab.';
    }
    case 'ablehnen':
      return s.phase === 'kaufen' ? null : 'Hier gibt es nichts abzulehnen.';
    case 'bieten': {
      const v = s.versteigerung;
      if (s.phase !== 'versteigerung' || !v) return 'Gerade läuft keine Versteigerung.';
      if (m.betrag < mindestGebot(v)) return `Das Mindestgebot ist ${euro(mindestGebot(v))}.`;
      return m.betrag <= p.geld ? null : 'So viel Geld hast du nicht.';
    }
    case 'passen':
      return s.phase === 'versteigerung' ? null : 'Gerade läuft keine Versteigerung.';
    case 'bauen':
      if (!VERWALTEN.includes(s.phase) || seat !== s.am) return 'Bauen geht nur in deinem Zug.';
      return kannBauen(s, seat, m.feld);
    case 'verkaufen':
      if (!GELD_BESCHAFFEN.includes(s.phase)) return 'Verkaufen geht gerade nicht.';
      return kannVerkaufen(s, seat, m.feld);
    case 'hypothek':
      if (!GELD_BESCHAFFEN.includes(s.phase)) return 'Eine Hypothek geht gerade nicht.';
      return kannHypothek(s, seat, m.feld);
    case 'abloesen':
      if (!VERWALTEN.includes(s.phase) || seat !== s.am) return 'Ablösen geht nur in deinem Zug.';
      return kannAbloesen(s, seat, m.feld);
    case 'handel':
      if (!VERWALTEN.includes(s.phase) || seat !== s.am) return 'Handeln geht nur in deinem Zug.';
      if (s.handelZahl >= MAX_HANDEL_PRO_ZUG) {
        return `Höchstens ${MAX_HANDEL_PRO_ZUG} Angebote je Zug.`;
      }
      return pruefeAngebot(s, { ...m, von: seat });
    case 'handelAnnehmen':
      if (s.phase !== 'handel' || !s.angebot) return 'Es liegt kein Angebot vor.';
      return pruefeAngebot(s, s.angebot);
    case 'handelAblehnen':
      return s.phase === 'handel' ? null : 'Es liegt kein Angebot vor.';
    case 'bezahlen': {
      const d = s.schulden[0];
      if (s.phase !== 'zahlen' || !d) return 'Es ist nichts zu bezahlen.';
      return p.geld >= d.betrag ? null : `Dir fehlen noch ${euro(d.betrag - p.geld)}.`;
    }
    case 'aufgeben':
      return s.phase === 'zahlen' ? null : 'Aufgeben geht nur, wenn du nicht zahlen kannst.';
    case 'zugEnde':
      if (s.phase !== 'zugEnde') return 'Du kannst deinen Zug noch nicht beenden.';
      return s.paschNochmal ? 'Pasch! Du darfst noch einmal würfeln.' : null;
  }
}

function ausfuehren(s: MonopolyZustand, seat: number, m: MonopolyZug): void {
  const p = spieler(s, seat);
  s.letztes = { nr: s.letztes.nr + 1, arten: [] };
  switch (m.type) {
    case 'wuerfeln': {
      const a = rollDie(s.rng);
      const b = rollDie(s.rng);
      s.wuerfel = [a, b];
      markiere(s, 'wuerfel');
      const summe = a + b;
      const pasch = a === b;
      s.phase = 'zugEnde';
      if (p.gefaengnis) {
        if (pasch) {
          p.gefaengnis = false;
          p.versuche = 0;
          s.paschNochmal = false;
          eintrag(
            s,
            seat,
            `würfelt einen Pasch (${a} + ${b}) und kommt aus dem Gefängnis → ${feldName((p.pos + summe) % 40)}.`,
          );
          bewegeUm(s, seat, summe);
        } else {
          p.versuche += 1;
          if (p.versuche >= 3) {
            p.gefaengnis = false;
            p.versuche = 0;
            eintrag(
              s,
              seat,
              `würfelt ${a} + ${b} – der dritte Fehlversuch. Kaution fällig, dann geht es weiter.`,
            );
            schuld(s, seat, null, KAUTION, 'Kaution', true);
            s.weiter = { art: 'bewegen', schritte: summe };
          } else {
            eintrag(
              s,
              seat,
              `würfelt ${a} + ${b} und bleibt im Gefängnis (Versuch ${p.versuche} von 3).`,
            );
          }
        }
        abschliessen(s);
        return;
      }
      if (pasch) s.paschZahl += 1;
      if (s.paschZahl >= 3) {
        eintrag(s, seat, `würfelt den dritten Pasch in Folge (${a} + ${b}) – ab ins Gefängnis!`);
        insGefaengnis(s, seat);
        abschliessen(s);
        return;
      }
      s.paschNochmal = pasch;
      eintrag(
        s,
        seat,
        `würfelt ${a} + ${b}${pasch ? ' (Pasch)' : ''} → ${feldName((p.pos + summe) % 40)}.`,
      );
      bewegeUm(s, seat, summe);
      abschliessen(s);
      return;
    }
    case 'freikaufen':
      p.geld -= KAUTION;
      if (s.optionen.freiParkenTopf) s.topf += KAUTION;
      p.gefaengnis = false;
      p.versuche = 0;
      markiere(s, 'geld');
      eintrag(s, seat, `zahlt ${euro(KAUTION)} Kaution und ist frei.`);
      return;
    case 'karteNutzen': {
      const k = p.freiKarten.shift();
      if (k) freikarteZurueck(s, k);
      p.gefaengnis = false;
      p.versuche = 0;
      markiere(s, 'karte');
      eintrag(s, seat, 'nutzt eine Gefängnisfrei-Karte.');
      return;
    }
    case 'kaufen': {
      const feld = s.kaufFeld ?? 0;
      const preis = FELDER[feld]?.preis ?? 0;
      p.geld -= preis;
      s.besitzer[feld] = seat;
      s.kaufFeld = null;
      markiere(s, 'kauf');
      eintrag(s, seat, `kauft ${feldName(feld)} für ${euro(preis)}.`);
      s.phase = 'zugEnde';
      abschliessen(s);
      return;
    }
    case 'ablehnen': {
      const feld = s.kaufFeld ?? 0;
      s.kaufFeld = null;
      if (!s.optionen.versteigerung) {
        eintrag(s, seat, `kauft ${feldName(feld)} nicht.`);
        s.phase = 'zugEnde';
        abschliessen(s);
        return;
      }
      const n = s.spieler.length;
      const reihenfolge: number[] = [];
      for (let i = 1; i <= n; i += 1) {
        const x = (s.am + i) % n;
        if (!spieler(s, x).bankrott) reihenfolge.push(x);
      }
      s.versteigerung = {
        feld,
        gebot: 0,
        bieter: null,
        reihenfolge,
        aktiv: [...reihenfolge],
        dran: s.am,
      };
      s.phase = 'versteigerung';
      eintrag(s, seat, `lehnt ${feldName(feld)} ab – die Versteigerung beginnt.`);
      versteigerungWeiter(s, s.am);
      return;
    }
    case 'bieten': {
      const v = s.versteigerung;
      if (!v) return;
      v.gebot = m.betrag;
      v.bieter = seat;
      markiere(s, 'gebot');
      eintrag(s, seat, `bietet ${euro(m.betrag)}.`);
      versteigerungWeiter(s, seat);
      return;
    }
    case 'passen': {
      const v = s.versteigerung;
      if (!v) return;
      v.aktiv = v.aktiv.filter((x) => x !== seat);
      eintrag(s, seat, 'steigt aus der Versteigerung aus.');
      versteigerungWeiter(s, seat);
      return;
    }
    case 'bauen': {
      const f = FELDER[m.feld];
      if (!f) return;
      const h = s.haeuser[m.feld] ?? 0;
      p.geld -= f.hauspreis;
      if (h === 4) {
        s.bankHotels -= 1;
        s.bankHaeuser += 4;
      } else {
        s.bankHaeuser -= 1;
      }
      s.haeuser[m.feld] = h + 1;
      markiere(s, 'bau');
      eintrag(s, seat, `baut ${h === 4 ? 'ein Hotel' : 'ein Haus'} auf ${f.name}.`);
      return;
    }
    case 'verkaufen': {
      const f = FELDER[m.feld];
      if (!f) return;
      const h = s.haeuser[m.feld] ?? 0;
      const halb = Math.floor(f.hauspreis / 2);
      if (h === 5) {
        // Das Hotel wird wieder zu vier Häusern – soweit die Bank Häuser hat.
        const rest = Math.min(4, s.bankHaeuser);
        s.bankHaeuser -= rest;
        s.bankHotels += 1;
        s.haeuser[m.feld] = rest;
        p.geld += halb * (5 - rest);
        eintrag(s, seat, `verkauft das Hotel auf ${f.name} (+${euro(halb * (5 - rest))}).`);
      } else {
        s.bankHaeuser += 1;
        s.haeuser[m.feld] = h - 1;
        p.geld += halb;
        eintrag(s, seat, `verkauft ein Haus auf ${f.name} (+${euro(halb)}).`);
      }
      markiere(s, 'geld');
      return;
    }
    case 'hypothek': {
      const wert = hypothekWert(m.feld);
      s.hypothek[m.feld] = true;
      p.geld += wert;
      markiere(s, 'geld');
      eintrag(s, seat, `nimmt eine Hypothek auf ${feldName(m.feld)} auf (+${euro(wert)}).`);
      return;
    }
    case 'abloesen': {
      const betrag = abloeseBetrag(m.feld);
      s.hypothek[m.feld] = false;
      p.geld -= betrag;
      markiere(s, 'geld');
      eintrag(s, seat, `löst die Hypothek auf ${feldName(m.feld)} ab (−${euro(betrag)}).`);
      return;
    }
    case 'handel': {
      s.angebot = {
        von: seat,
        an: m.an,
        gebeFelder: m.gebeFelder,
        nehmeFelder: m.nehmeFelder,
        gebeGeld: m.gebeGeld,
        nehmeGeld: m.nehmeGeld,
        gebeKarten: m.gebeKarten,
        nehmeKarten: m.nehmeKarten,
      };
      s.rueckPhase = s.phase;
      s.phase = 'handel';
      s.handelZahl += 1;
      markiere(s, 'handel');
      eintrag(s, seat, `macht ${sitzName(m.an)} ein Handelsangebot.`);
      return;
    }
    case 'handelAnnehmen':
    case 'handelAblehnen': {
      const a = s.angebot;
      if (!a) return;
      if (m.type === 'handelAnnehmen') {
        handelAnwenden(s, a);
        markiere(s, 'handel');
        eintrag(s, seat, `nimmt das Angebot von ${sitzName(a.von)} an: ${handelText(a)}.`);
      } else {
        eintrag(s, seat, `lehnt das Angebot von ${sitzName(a.von)} ab.`);
      }
      s.angebot = null;
      s.phase = s.rueckPhase ?? 'zugEnde';
      s.rueckPhase = null;
      return;
    }
    case 'bezahlen':
      zahle(s, 0);
      markiere(s, 'geld');
      abschliessen(s);
      return;
    case 'aufgeben': {
      const d = s.schulden[0];
      bankrott(s, seat, d ? d.an : null);
      abschliessen(s);
      return;
    }
    case 'zugEnde':
      naechsterSpieler(s);
      return;
  }
}

function handelText(a: Angebot): string {
  const teil = (felder: number[], geld: number, karten: number): string => {
    const stuecke = felder.map(feldName);
    if (geld > 0) stuecke.push(euro(geld));
    if (karten > 0) stuecke.push(karten === 1 ? 'eine Freikarte' : `${karten} Freikarten`);
    return stuecke.length > 0 ? stuecke.join(', ') : 'nichts';
  };
  return `${teil(a.gebeFelder, a.gebeGeld, a.gebeKarten)} gegen ${teil(a.nehmeFelder, a.nehmeGeld, a.nehmeKarten)}`;
}

// ---------------------------------------------------------------------------
// Fremde Daten
// ---------------------------------------------------------------------------

function feldListe(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length > 28) return null;
  const out: number[] = [];
  for (const v of raw) {
    const f = intIn(v, 0, 39);
    if (f === null || out.includes(f)) return null;
    out.push(f);
  }
  return out;
}

const EINFACHE = [
  'wuerfeln',
  'freikaufen',
  'karteNutzen',
  'kaufen',
  'ablehnen',
  'passen',
  'handelAnnehmen',
  'handelAblehnen',
  'bezahlen',
  'aufgeben',
  'zugEnde',
] as const;

function parseMove(raw: unknown): MonopolyZug | null {
  if (!isRecord(raw) || typeof raw.type !== 'string') return null;
  const type = raw.type;
  const einfach = EINFACHE.find((t) => t === type);
  if (einfach) return { type: einfach };
  switch (type) {
    case 'bieten': {
      const betrag = intIn(raw.betrag, 1, 1_000_000);
      return betrag === null ? null : { type, betrag };
    }
    case 'bauen':
    case 'verkaufen':
    case 'hypothek':
    case 'abloesen': {
      const feld = intIn(raw.feld, 0, 39);
      return feld === null ? null : { type, feld };
    }
    case 'handel': {
      const an = intIn(raw.an, 0, 5);
      const gebeFelder = feldListe(raw.gebeFelder);
      const nehmeFelder = feldListe(raw.nehmeFelder);
      const gebeGeld = intIn(raw.gebeGeld, 0, 1_000_000);
      const nehmeGeld = intIn(raw.nehmeGeld, 0, 1_000_000);
      const gebeKarten = intIn(raw.gebeKarten, 0, 2);
      const nehmeKarten = intIn(raw.nehmeKarten, 0, 2);
      if (
        an === null ||
        gebeFelder === null ||
        nehmeFelder === null ||
        gebeGeld === null ||
        nehmeGeld === null ||
        gebeKarten === null ||
        nehmeKarten === null
      ) {
        return null;
      }
      return { type, an, gebeFelder, nehmeFelder, gebeGeld, nehmeGeld, gebeKarten, nehmeKarten };
    }
    default:
      return null;
  }
}

function parseOptions(raw: unknown): MonopolyOptionen | null {
  if (raw === undefined || raw === null) return { ...DEFAULT_OPTIONS };
  if (!isRecord(raw)) return null;
  const o: MonopolyOptionen = { ...DEFAULT_OPTIONS };
  if (raw.startgeld !== undefined) {
    const v = STARTGELD_WAHL.find((x) => x === raw.startgeld);
    if (v === undefined) return null;
    o.startgeld = v;
  }
  if (raw.rundenlimit !== undefined) {
    const v = RUNDENLIMIT_WAHL.find((x) => x === raw.rundenlimit);
    if (v === undefined) return null;
    o.rundenlimit = v;
  }
  if (raw.versteigerung !== undefined) {
    if (typeof raw.versteigerung !== 'boolean') return null;
    o.versteigerung = raw.versteigerung;
  }
  if (raw.freiParkenTopf !== undefined) {
    if (typeof raw.freiParkenTopf !== 'boolean') return null;
    o.freiParkenTopf = raw.freiParkenTopf;
  }
  return o;
}

// ---------------------------------------------------------------------------
// Aufbau, Sicht, Ergebnis
// ---------------------------------------------------------------------------

function setup(ctx: { players: number; seed: number; options: MonopolyOptionen }): MonopolyZustand {
  const rng = createRng(ctx.seed);
  const ereignis = shuffled(
    rng,
    Array.from({ length: 16 }, (_, i) => i),
  );
  const gemeinschaft = shuffled(
    rng,
    Array.from({ length: 16 }, (_, i) => i),
  );
  return {
    version: 1,
    optionen: { ...ctx.options },
    spieler: Array.from({ length: ctx.players }, () => ({
      geld: ctx.options.startgeld,
      pos: 0,
      gefaengnis: false,
      versuche: 0,
      freiKarten: [],
      bankrott: false,
    })),
    besitzer: FELDER.map(() => null),
    haeuser: FELDER.map(() => 0),
    hypothek: FELDER.map(() => false),
    am: 0,
    phase: 'wuerfeln',
    runde: 1,
    zugNr: 0,
    wuerfel: null,
    paschZahl: 0,
    paschNochmal: false,
    kaufFeld: null,
    versteigerung: null,
    schulden: [],
    weiter: { art: 'zugEnde' },
    angebot: null,
    rueckPhase: null,
    handelZahl: 0,
    stapel: { ereignis, gemeinschaft },
    letzteKarte: null,
    topf: 0,
    bankHaeuser: BANK_HAEUSER,
    bankHotels: BANK_HOTELS,
    letzteBewegung: null,
    letztes: { nr: 0, arten: [] },
    log: [{ seat: null, text: 'Die Partie beginnt. Rot würfelt zuerst.' }],
    rng,
    sieger: null,
    endeText: null,
  };
}

const KEINE_AKTIONEN: MonopolyAktionen = {
  wuerfeln: false,
  freikaufen: false,
  karteNutzen: false,
  kaufen: false,
  ablehnen: false,
  bieten: false,
  passen: false,
  bezahlen: false,
  aufgeben: false,
  zugEnde: false,
  handel: false,
  handelAntwort: false,
  bauen: [],
  verkaufen: [],
  hypothek: [],
  abloesen: [],
};

function aktionenFuer(s: MonopolyZustand, seat: number | null): MonopolyAktionen {
  if (seat === null || !activeSeats(s).includes(seat)) return KEINE_AKTIONEN;
  const ok = (m: MonopolyZug): boolean => pruefe(s, seat, m) === null;
  const eigene = FELDER.flatMap((_, i) => (s.besitzer[i] === seat ? [i] : []));
  const v = s.versteigerung;
  return {
    wuerfeln: ok({ type: 'wuerfeln' }),
    freikaufen: ok({ type: 'freikaufen' }),
    karteNutzen: ok({ type: 'karteNutzen' }),
    kaufen: ok({ type: 'kaufen' }),
    ablehnen: ok({ type: 'ablehnen' }),
    bieten: v !== null && ok({ type: 'bieten', betrag: mindestGebot(v) }),
    passen: ok({ type: 'passen' }),
    bezahlen: ok({ type: 'bezahlen' }),
    aufgeben: ok({ type: 'aufgeben' }),
    zugEnde: ok({ type: 'zugEnde' }),
    handel: VERWALTEN.includes(s.phase) && seat === s.am && s.handelZahl < MAX_HANDEL_PRO_ZUG,
    handelAntwort: s.phase === 'handel',
    bauen: eigene.filter((f) => ok({ type: 'bauen', feld: f })),
    verkaufen: eigene.filter((f) => ok({ type: 'verkaufen', feld: f })),
    hypothek: eigene.filter((f) => ok({ type: 'hypothek', feld: f })),
    abloesen: eigene.filter((f) => ok({ type: 'abloesen', feld: f })),
  };
}

function view(s: MonopolyZustand, seat: number | null): MonopolyView {
  const d = s.schulden[0];
  const k = s.letzteKarte;
  return {
    felder: FELDER,
    optionen: s.optionen,
    spieler: s.spieler.map((p, i) => ({
      geld: p.geld,
      pos: p.pos,
      gefaengnis: p.gefaengnis,
      versuche: p.versuche,
      freiKarten: p.freiKarten.length,
      bankrott: p.bankrott,
      vermoegen: vermoegen(s, i),
    })),
    besitzer: s.besitzer,
    haeuser: s.haeuser,
    hypothek: s.hypothek,
    am: s.am,
    phase: s.phase,
    runde: s.runde,
    zugNr: s.zugNr,
    wuerfel: s.wuerfel,
    paschNochmal: s.paschNochmal,
    kaufFeld: s.kaufFeld,
    versteigerung: s.versteigerung,
    mindestGebot: s.versteigerung ? mindestGebot(s.versteigerung) : 0,
    schuld:
      s.phase === 'zahlen' && d ? { von: d.von, an: d.an, betrag: d.betrag, grund: d.grund } : null,
    angebot: s.angebot,
    // Nur die zuletzt gezogene Karte – die Reihenfolge der Stapel bleibt verdeckt.
    letzteKarte: k
      ? { stapel: k.stapel, text: karte(k.stapel, k.id)?.text ?? '', seat: k.seat, zugNr: k.zugNr }
      : null,
    topf: s.topf,
    bankHaeuser: s.bankHaeuser,
    bankHotels: s.bankHotels,
    letzteBewegung: s.letzteBewegung,
    letztes: s.letztes,
    sieger: s.sieger,
    aktionen: aktionenFuer(s, seat),
  };
}

function outcome(s: MonopolyZustand): TurnOutcome | null {
  if (s.phase !== 'ende' || !s.sieger) return null;
  return {
    winners: s.sieger,
    summary: s.endeText ?? 'Die Partie ist vorbei.',
    scores: s.spieler.map((_, i) => vermoegen(s, i)),
  };
}

export const game: TurnGame<MonopolyZustand, MonopolyZug, MonopolyOptionen, MonopolyView> = {
  kind: 'turn',
  id: 'monopoly',
  version: 1,
  minPlayers: 2,
  maxPlayers: 6,
  defaultOptions: DEFAULT_OPTIONS,
  parseOptions,
  hiddenInformation: false,
  setup,
  activeSeats,
  parseMove,
  applyMove(state, seat, move) {
    const fehler = pruefe(state, seat, move);
    if (fehler) return { ok: false, error: fehler };
    const s = cloneState(state);
    ausfuehren(s, seat, move);
    return { ok: true, state: s };
  },
  outcome,
  view,
  log(state): TurnLogEntry[] {
    return state.log.slice(-50);
  },
  bot(state, seat, level, rng) {
    return botZug(state, seat, level, rng, (m) => pruefe(state, seat, m) === null);
  },
};
