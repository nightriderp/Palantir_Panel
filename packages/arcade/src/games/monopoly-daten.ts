/**
 * Monopoly – feste Daten: Spielbrett der klassischen deutschen Ausgabe
 * (Straßennamen, Preise, Mieten) und die Ereignis- und Gemeinschaftskarten.
 *
 * Die Kartentexte sind selbst formuliert; nur die Mechaniken entsprechen den
 * üblichen (Vorrücken, Gefängnis, Zahlen, Erhalten, Reparaturen …).
 */

export type FeldTyp =
  | 'los'
  | 'strasse'
  | 'bahnhof'
  | 'werk'
  | 'steuer'
  | 'ereignis'
  | 'gemeinschaft'
  | 'gefaengnis'
  | 'parken'
  | 'gehGefaengnis';

export interface Feld {
  name: string;
  typ: FeldTyp;
  /** Farbgruppe 0–7 bei Straßen, 8 Bahnhöfe, 9 Werke, sonst -1. */
  gruppe: number;
  /** Kaufpreis (0 bei nicht käuflichen Feldern). */
  preis: number;
  hauspreis: number;
  /** Miete unbebaut, mit 1–4 Häusern, mit Hotel (nur Straßen). */
  miete: number[];
  /** Betrag bei Steuerfeldern. */
  steuer: number;
}

function strasse(
  name: string,
  gruppe: number,
  preis: number,
  hauspreis: number,
  miete: number[],
): Feld {
  return { name, typ: 'strasse', gruppe, preis, hauspreis, miete, steuer: 0 };
}

function sonder(name: string, typ: FeldTyp, steuer = 0): Feld {
  return { name, typ, gruppe: -1, preis: 0, hauspreis: 0, miete: [], steuer };
}

function bahnhof(name: string): Feld {
  return { name, typ: 'bahnhof', gruppe: 8, preis: 200, hauspreis: 0, miete: [], steuer: 0 };
}

function werk(name: string): Feld {
  return { name, typ: 'werk', gruppe: 9, preis: 150, hauspreis: 0, miete: [], steuer: 0 };
}

export const FELDER: readonly Feld[] = [
  sonder('Los', 'los'),
  strasse('Badstraße', 0, 60, 50, [2, 10, 30, 90, 160, 250]),
  sonder('Gemeinschaftsfeld', 'gemeinschaft'),
  strasse('Turmstraße', 0, 60, 50, [4, 20, 60, 180, 320, 450]),
  sonder('Einkommensteuer', 'steuer', 200),
  bahnhof('Südbahnhof'),
  strasse('Chausseestraße', 1, 100, 50, [6, 30, 90, 270, 400, 550]),
  sonder('Ereignisfeld', 'ereignis'),
  strasse('Elisenstraße', 1, 100, 50, [6, 30, 90, 270, 400, 550]),
  strasse('Poststraße', 1, 120, 50, [8, 40, 100, 300, 450, 600]),
  sonder('Gefängnis', 'gefaengnis'),
  strasse('Seestraße', 2, 140, 100, [10, 50, 150, 450, 625, 750]),
  werk('Elektrizitätswerk'),
  strasse('Hafenstraße', 2, 140, 100, [10, 50, 150, 450, 625, 750]),
  strasse('Neue Straße', 2, 160, 100, [12, 60, 180, 500, 700, 900]),
  bahnhof('Westbahnhof'),
  strasse('Münchener Straße', 3, 180, 100, [14, 70, 200, 550, 750, 950]),
  sonder('Gemeinschaftsfeld', 'gemeinschaft'),
  strasse('Wiener Straße', 3, 180, 100, [14, 70, 200, 550, 750, 950]),
  strasse('Berliner Straße', 3, 200, 100, [16, 80, 220, 600, 800, 1000]),
  sonder('Frei Parken', 'parken'),
  strasse('Theaterstraße', 4, 220, 150, [18, 90, 250, 700, 875, 1050]),
  sonder('Ereignisfeld', 'ereignis'),
  strasse('Museumstraße', 4, 220, 150, [18, 90, 250, 700, 875, 1050]),
  strasse('Opernplatz', 4, 240, 150, [20, 100, 300, 750, 925, 1100]),
  bahnhof('Nordbahnhof'),
  strasse('Lessingstraße', 5, 260, 150, [22, 110, 330, 800, 975, 1150]),
  strasse('Schillerstraße', 5, 260, 150, [22, 110, 330, 800, 975, 1150]),
  werk('Wasserwerk'),
  strasse('Goethestraße', 5, 280, 150, [24, 120, 360, 850, 1025, 1200]),
  sonder('Gehe ins Gefängnis', 'gehGefaengnis'),
  strasse('Rathausplatz', 6, 300, 200, [26, 130, 390, 900, 1100, 1275]),
  strasse('Hauptstraße', 6, 300, 200, [26, 130, 390, 900, 1100, 1275]),
  sonder('Gemeinschaftsfeld', 'gemeinschaft'),
  strasse('Bahnhofstraße', 6, 320, 200, [28, 150, 450, 1000, 1200, 1400]),
  bahnhof('Hauptbahnhof'),
  sonder('Ereignisfeld', 'ereignis'),
  strasse('Parkstraße', 7, 350, 200, [35, 175, 500, 1100, 1300, 1500]),
  sonder('Zusatzsteuer', 'steuer', 100),
  strasse('Schlossallee', 7, 400, 200, [50, 200, 600, 1400, 1700, 2000]),
];

/** Felder je Gruppe (Index = Gruppennummer 0–9). */
export const GRUPPEN: readonly (readonly number[])[] = Array.from({ length: 10 }, (_, g) =>
  FELDER.flatMap((f, i) => (f.gruppe === g ? [i] : [])),
);

export const BAHNHOEFE: readonly number[] = GRUPPEN[8] ?? [];
export const WERKE: readonly number[] = GRUPPEN[9] ?? [];

export const GEFAENGNIS_FELD = 10;
export const LOS_GELD = 200;
export const KAUTION = 50;
export const BANK_HAEUSER = 32;
export const BANK_HOTELS = 12;

export function kaeuflich(feld: number): boolean {
  const f = FELDER[feld];
  return f !== undefined && f.preis > 0;
}

export type KartenEffekt =
  | { art: 'geld'; betrag: number }
  | { art: 'ziel'; feld: number }
  | { art: 'bahnhof' }
  | { art: 'werk' }
  | { art: 'zurueck'; schritte: number }
  | { art: 'gefaengnis' }
  | { art: 'frei' }
  | { art: 'reparatur'; haus: number; hotel: number }
  | { art: 'jedem'; betrag: number }
  | { art: 'vonJedem'; betrag: number };

export interface Karte {
  text: string;
  effekt: KartenEffekt;
}

export type StapelName = 'ereignis' | 'gemeinschaft';

export const EREIGNIS_KARTEN: readonly Karte[] = [
  {
    text: 'Der Wind steht günstig: Segle direkt zurück auf Los.',
    effekt: { art: 'ziel', feld: 0 },
  },
  {
    text: 'Ein Abendessen in der Schlossallee wartet. Rücke dorthin vor.',
    effekt: { art: 'ziel', feld: 39 },
  },
  {
    text: 'Premiere im Opernplatz-Viertel! Rücke vor bis zum Opernplatz.',
    effekt: { art: 'ziel', feld: 24 },
  },
  {
    text: 'Frische Brise gefällig? Rücke vor bis zur Seestraße.',
    effekt: { art: 'ziel', feld: 11 },
  },
  {
    text: 'Du nimmst den Bummelzug ab dem Südbahnhof. Rücke dorthin vor.',
    effekt: { art: 'ziel', feld: 5 },
  },
  {
    text: 'Anschluss verpasst! Fahr zum nächsten Bahnhof. Gehört er jemandem, zahlst du die doppelte Miete.',
    effekt: { art: 'bahnhof' },
  },
  {
    text: 'Schienenersatzverkehr: Ab zum nächsten Bahnhof. Hat er einen Besitzer, zahlst du doppelt.',
    effekt: { art: 'bahnhof' },
  },
  {
    text: 'Zählerablesung! Geh zum nächsten Werk. Gehört es jemandem, würfle und zahle das Zehnfache.',
    effekt: { art: 'werk' },
  },
  {
    text: 'Deine Aktien werfen etwas ab: Die Bank schüttet dir 50 € aus.',
    effekt: { art: 'geld', betrag: 50 },
  },
  {
    text: 'Ein Freund im Stadtrat: Du kommst aus dem Gefängnis frei. Karte behalten, bis du sie brauchst.',
    effekt: { art: 'frei' },
  },
  { text: 'Falsch abgebogen – geh drei Felder zurück.', effekt: { art: 'zurueck', schritte: 3 } },
  {
    text: 'Erwischt beim Falschparken vor dem Rathaus. Geh direkt ins Gefängnis, ohne über Los.',
    effekt: { art: 'gefaengnis' },
  },
  {
    text: 'Der Dachdecker war da: Zahle 25 € je Haus und 100 € je Hotel.',
    effekt: { art: 'reparatur', haus: 25, hotel: 100 },
  },
  { text: 'Zu schnell durch die Allee: 15 € Bußgeld.', effekt: { art: 'geld', betrag: -15 } },
  {
    text: 'Du wurdest zum Vereinsvorsitz gewählt und gibst eine Runde aus: Zahle jedem Mitspieler 50 €.',
    effekt: { art: 'jedem', betrag: 50 },
  },
  {
    text: 'Dein Bausparvertrag ist fällig. Kassiere 150 €.',
    effekt: { art: 'geld', betrag: 150 },
  },
];

export const GEMEINSCHAFT_KARTEN: readonly Karte[] = [
  { text: 'Abkürzung gefunden: Rücke vor bis auf Los.', effekt: { art: 'ziel', feld: 0 } },
  {
    text: 'Die Bank hat sich verrechnet – zu deinen Gunsten. Du erhältst 200 €.',
    effekt: { art: 'geld', betrag: 200 },
  },
  { text: 'Zahnarzttermin: Zahle 50 €.', effekt: { art: 'geld', betrag: -50 } },
  {
    text: 'Flohmarkt-Glück: Deine alten Schallplatten bringen 50 €.',
    effekt: { art: 'geld', betrag: 50 },
  },
  {
    text: 'Gute Beziehungen: Du kommst aus dem Gefängnis frei. Karte behalten, bis du sie brauchst.',
    effekt: { art: 'frei' },
  },
  {
    text: 'Das Finanzamt hat Fragen. Geh direkt ins Gefängnis, ohne über Los.',
    effekt: { art: 'gefaengnis' },
  },
  { text: 'Urlaubsgeld! Du bekommst 100 €.', effekt: { art: 'geld', betrag: 100 } },
  { text: 'Steuererstattung: 20 € zurück aufs Konto.', effekt: { art: 'geld', betrag: 20 } },
  {
    text: 'Du hast Geburtstag! Jeder Mitspieler schenkt dir 10 €.',
    effekt: { art: 'vonJedem', betrag: 10 },
  },
  {
    text: 'Deine Lebensversicherung zahlt aus. Du erhältst 100 €.',
    effekt: { art: 'geld', betrag: 100 },
  },
  {
    text: 'Beinbruch beim Tanzkurs: 100 € Krankenhausrechnung.',
    effekt: { art: 'geld', betrag: -100 },
  },
  { text: 'Die Klassenfahrt ist fällig: Zahle 50 €.', effekt: { art: 'geld', betrag: -50 } },
  { text: 'Du hast den Nachbarn beraten. Honorar: 25 €.', effekt: { art: 'geld', betrag: 25 } },
  {
    text: 'Die Stadt saniert deine Straßen: 40 € je Haus und 115 € je Hotel.',
    effekt: { art: 'reparatur', haus: 40, hotel: 115 },
  },
  {
    text: 'Zweiter Platz beim Kürbiswettbewerb. Preisgeld: 10 €.',
    effekt: { art: 'geld', betrag: 10 },
  },
  {
    text: 'Eine entfernte Tante vererbt dir 100 €.',
    effekt: { art: 'geld', betrag: 100 },
  },
];

/** Index der Gefängnisfrei-Karte je Stapel (sie kehrt nach Gebrauch zurück). */
export const FREI_KARTE: Record<StapelName, number> = {
  ereignis: EREIGNIS_KARTEN.findIndex((k) => k.effekt.art === 'frei'),
  gemeinschaft: GEMEINSCHAFT_KARTEN.findIndex((k) => k.effekt.art === 'frei'),
};

export function karte(stapel: StapelName, id: number): Karte | undefined {
  return (stapel === 'ereignis' ? EREIGNIS_KARTEN : GEMEINSCHAFT_KARTEN)[id];
}

/** Farbnamen der Sitze – in der Reihenfolge der Sitzfarben der Oberfläche. */
export const SITZ_NAMEN = ['Rot', 'Blau', 'Grün', 'Gelb', 'Lila', 'Orange'] as const;

export function sitzName(seat: number): string {
  return SITZ_NAMEN[seat] ?? `Sitz ${seat + 1}`;
}
