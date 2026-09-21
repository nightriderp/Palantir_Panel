/**
 * Der Spott des Tutorials – als reine Logik, ohne Zufall.
 *
 * Alles, was die Einweisung dem Nutzer an den Kopf wirft, steht hier und nicht
 * in der Ansicht. Zwei Gründe:
 *
 * 1. **Kein `Math.random()`.** Die Sprüche werden über einen Zähler ausgewählt
 *    (`zeilen[zaehler % zeilen.length]`), nicht gewürfelt. Ein Test kann damit
 *    festhalten, was beim dritten zu schnellen Klick erscheint; mit Zufall
 *    wäre jeder Lauf ein anderer. Nebenbei wiederholt sich so auch nichts
 *    zweimal hintereinander, was beim Würfeln ständig passiert.
 * 2. **Eine Datei für den Ton.** Wer die Einweisung freundlicher (oder
 *    unfreundlicher) haben will, ändert Zeilen hier und fasst keine Komponente
 *    an.
 *
 * Der Ton selbst ist Absicht: Palantir läuft auf einem Homeserver für einen
 * festen Kreis von Freunden (Lastenheft §1). Eine Einweisung, die sich selbst
 * ernst nimmt, liest dort niemand. Eine, die frech ist, schon – und nebenbei
 * steht in jedem Schritt die echte Erklärung.
 */

/** Unter dieser Lesezeit hat niemand gelesen. Gemessen ab Betreten des Schritts. */
export const LESEZEIT_MIN_MS = 2500;

/** Ab hier ist der Nutzer offensichtlich weggegangen (oder eingeschlafen). */
export const LESEZEIT_MAX_MS = 90_000;

export type LesezeitUrteil = 'ueberflogen' | 'gelesen' | 'eingeschlafen';

export function lesezeitUrteil(ms: number): LesezeitUrteil {
  if (ms < LESEZEIT_MIN_MS) return 'ueberflogen';
  if (ms > LESEZEIT_MAX_MS) return 'eingeschlafen';
  return 'gelesen';
}

/** Sekunden mit einer Nachkommastelle und deutschem Komma: `1,3`. */
export function sekunden(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(1).replace('.', ',');
}

const UEBERFLOGEN = [
  'Gelesen in {s} Sekunden. Beeindruckend. Und gelogen.',
  '{s} Sekunden. Selbst die Überschrift war länger.',
  'Nach {s} Sekunden weiter? Der Text hat sich Mühe gegeben.',
  'Wieder {s} Sekunden. Wir zählen mit, nur damit du es weißt.',
] as const;

const EINGESCHLAFEN = [
  'Du warst {s} Sekunden auf dieser Seite. Alles in Ordnung zu Hause?',
  '{s} Sekunden. Der Kaffee war gut, oder?',
  'Willkommen zurück. Nur {s} Sekunden – wir haben die Zeit genutzt und nichts getan.',
] as const;

/**
 * Der passende Spruch zur Lesezeit, oder `null`, wenn sie in Ordnung war.
 *
 * `zaehler` ist die Anzahl der bisherigen Verstöße derselben Art – daraus wählt
 * sich der Spruch aus, ohne sich beim zweiten Mal zu wiederholen.
 */
export function lesezeitSpruch(ms: number, zaehler: number): string | null {
  const urteil = lesezeitUrteil(ms);
  if (urteil === 'gelesen') return null;

  const zeilen = urteil === 'ueberflogen' ? UEBERFLOGEN : EINGESCHLAFEN;
  const zeile = zeilen[Math.abs(zaehler) % zeilen.length] ?? zeilen[0];

  return zeile.replace('{s}', sekunden(ms));
}

/**
 * So oft weicht der „Überspringen"-Knopf aus, bevor er sich ergibt.
 *
 * Er ergibt sich, und zwar sichtbar: Ein Knopf, der unendlich flieht, ist kein
 * Scherz mehr, sondern eine Sackgasse. Nach vier Versuchen bleibt er stehen und
 * tut, was draufsteht.
 */
export const FLUCHT_MAX = 4;

const FLUCHT_TEXTE = [
  'Überspringen',
  'Fast!',
  'Knapp daneben',
  'Du bist hartnäckig',
  'Na gut. Du gewinnst.',
] as const;

export function fluchtText(versuche: number): string {
  const index = Math.min(Math.max(versuche, 0), FLUCHT_TEXTE.length - 1);

  return FLUCHT_TEXTE[index] ?? FLUCHT_TEXTE[0];
}

/** Weicht der Knopf noch aus? Nach {@link FLUCHT_MAX} Versuchen nicht mehr. */
export function fliehtNoch(versuche: number): boolean {
  return versuche < FLUCHT_MAX;
}

/**
 * Wohin der Knopf springt – vier feste Plätze, keine Würfel.
 *
 * Bewusst klein gehalten (±112 px waagerecht, ±28 px senkrecht): Der Knopf soll
 * im Panel bleiben und nicht hinter dem Seitenrand verschwinden, wo ihn auch
 * der Willige nicht mehr fände.
 */
const FLUCHT_PLAETZE = [
  { x: 0, y: 0 },
  { x: -112, y: -28 },
  { x: 96, y: 24 },
  { x: -88, y: 28 },
  { x: 104, y: -24 },
] as const;

export function fluchtVersatz(versuche: number): { x: number; y: number } {
  const index = Math.min(Math.max(versuche, 0), FLUCHT_PLAETZE.length - 1);

  return FLUCHT_PLAETZE[index] ?? { x: 0, y: 0 };
}

/**
 * Die angezeigte Gesamtzahl der Schritte – die echte plus gelegentlich einer.
 *
 * Ab der Hälfte „finden" wir noch einen Schritt; beim letzten stimmt die Zahl
 * wieder. Der Witz lebt davon, dass die Zahl nie falsch **wirkt**: Sie stimmt
 * am Anfang und am Ende, und dazwischen hat man sich eben verzählt.
 */
export function angezeigteGesamt(index: number, gesamt: number): number {
  if (index >= gesamt - 1) return gesamt;
  if (index >= Math.floor(gesamt / 2)) return gesamt + 1;

  return gesamt;
}

/** Die Fußnote zur Zahl darüber – nur dort, wo sie sich gerade geändert hat. */
export function gesamtHinweis(index: number, gesamt: number): string | null {
  const jetzt = angezeigteGesamt(index, gesamt);
  const vorher = index === 0 ? jetzt : angezeigteGesamt(index - 1, gesamt);

  if (jetzt > vorher) return 'Wir haben hinten noch einen gefunden.';
  if (jetzt < vorher) return 'Der eine hat sich erledigt. Gern geschehen.';

  return null;
}

/**
 * Der Balken lügt an genau zwei Stellen.
 *
 * Beim zweiten Schritt steht er fast am Anfang („du hast noch gar nichts
 * geschafft"), beim letzten bei 99 % – die Zahl, die jeder Fortschrittsbalken
 * der Welt schon einmal für eine halbe Stunde gehalten hat. Dazwischen rechnet
 * er ehrlich, sonst fällt die Lüge nicht auf.
 */
export function luegenProzent(index: number, gesamt: number): number {
  if (gesamt <= 0) return 0;
  if (index >= gesamt - 1) return 99;
  if (index === 1) return 3;

  return Math.round((index / gesamt) * 100);
}

export interface Bilanz {
  /** Wie oft zu schnell geklickt wurde. */
  ueberflogen: number;
  /** Wie oft der „Überspringen"-Knopf weggesprungen ist. */
  fluchtversuche: number;
  /** Richtige Antworten im Abschlussquiz. */
  quizPunkte: number;
  /**
   * Wie viele Fragen überhaupt beantwortet wurden.
   *
   * Seit der Bogen 124 Fragen hat, ist das die eigentliche Aussage: Die Quote
   * sagt, wie klug jemand ist, diese Zahl sagt, wie stur.
   */
  quizBeantwortet: number;
  /** Der volle Bogen – für „47 von 124". */
  quizGesamt: number;
}

export interface Zeugnis {
  /** Schulnote von 1 bis 5. Eine 6 gibt es nicht – du bist ja gekommen. */
  wert: number;
  /** Die Begründung, in einem Satz. */
  begruendung: string;
}

/**
 * Die Note am Ende – hergeleitet, nicht gewürfelt.
 *
 * Ausgangspunkt ist die 2: Wer die Einweisung durchklickt, hat schon mehr
 * getan als die meisten. Zu schnelles Lesen und die Jagd auf den
 * Überspringen-Knopf verschlechtern, ein volles Quiz verbessert.
 */
export function zeugnis(bilanz: Bilanz): Zeugnis {
  let wert = 2;
  if (bilanz.ueberflogen > 0) wert += 1;
  if (bilanz.ueberflogen > 2) wert += 1;
  if (bilanz.fluchtversuche >= FLUCHT_MAX) wert += 1;

  // Wissen zählt erst ab einer Menge, bei der Raten nicht mehr trägt.
  const quote = bilanz.quizBeantwortet > 0 ? bilanz.quizPunkte / bilanz.quizBeantwortet : 0;
  if (bilanz.quizBeantwortet >= 10 && quote >= 0.8) wert -= 1;

  // Und dann gibt es noch die, die den ganzen Bogen durchgezogen haben. Denen
  // ist mit einer Note nicht mehr beizukommen.
  if (bilanz.quizGesamt > 0 && bilanz.quizBeantwortet >= bilanz.quizGesamt) wert -= 1;

  wert = Math.min(5, Math.max(1, wert));

  const teile = [
    `${bilanz.quizPunkte} von ${bilanz.quizBeantwortet} beantworteten Fragen richtig`,
    bilanz.ueberflogen > 0 ? `${bilanz.ueberflogen}-mal zu früh geklickt` : 'in Ruhe gelesen',
    bilanz.fluchtversuche > 0
      ? `${bilanz.fluchtversuche}-mal nach dem Überspringen-Knopf gegriffen`
      : 'den Überspringen-Knopf nie gesucht',
  ];

  return { wert, begruendung: `${teile.join(', ')}.` };
}

/**
 * Der Ehrentitel für die zurückgelegte Strecke.
 *
 * Die Note bewertet, wie jemand durchs Tutorial gegangen ist; dieser Satz
 * bewertet, wie weit. Beides gehört auf die Urkunde, weil drei Fragen und 124
 * Fragen nicht dieselbe Leistung sind – auch wenn beide eine Vier ergeben
 * können.
 */
export function ausdauerTitel(beantwortet: number, gesamt: number): string {
  if (gesamt > 0 && beantwortet >= gesamt) {
    return 'Vollständig durchgearbeitet. Alle Fragen. Wir hatten nicht damit gerechnet, dass das je vorkommt.';
  }
  if (beantwortet >= 75)
    return 'Über siebzig Fragen. Irgendwann war es kein Quiz mehr, sondern ein Duell.';
  if (beantwortet >= 45) return 'Fünfundvierzig Fragen. Das war keine Neugier mehr, das war Trotz.';
  if (beantwortet >= 24) return 'Vierundzwanzig Fragen. Respekt, ehrlich. Ein bisschen Sorge auch.';
  if (beantwortet >= 12)
    return 'Ein Dutzend. Du hast gemerkt, dass es weitergeht – und bist geblieben.';
  if (beantwortet >= 6)
    return 'Sechs Fragen. Genug, um zu wissen, worauf du dich eingelassen hättest.';
  if (beantwortet >= 3)
    return 'Drei Fragen, wie angekündigt. Und dann hast du den Ausgang gefunden. Klug.';

  return 'Nicht mal die drei versprochenen Fragen. Das ist auch eine Aussage.';
}

/**
 * Nach so vielen beantworteten Fragen wird nachgefragt, ob das ernst gemeint ist.
 *
 * Die Abstände wachsen: Anfangs oft genug, dass es auffällt, später selten
 * genug, dass es nicht nervt. Wer bei 111 noch da ist, wird nicht mehr durch
 * eine Rückfrage abzubringen sein – aber eine bekommt er trotzdem.
 */
export const NACHFRAGE_SCHWELLEN = [6, 12, 24, 45, 75, 111] as const;

export function nachfrageFaellig(beantwortet: number): boolean {
  return (NACHFRAGE_SCHWELLEN as readonly number[]).includes(beantwortet);
}

export interface Nachfrage {
  titel: string;
  text: string;
  /** Beschriftung für „ja, weiter" – wird mit jeder Schwelle kleinlauter. */
  weiter: string;
  /** Beschriftung für „nein, raus hier". */
  raus: string;
}

const NACHFRAGEN: Record<number, Nachfrage> = {
  6: {
    titel: 'Kurze Zwischenfrage.',
    text: 'Sechs von {gesamt}. Das sind {prozent} Prozent. Wir wollten nur sichergehen, dass du weißt, worauf das hier hinausläuft.',
    weiter: 'Ich weiß, was ich tue',
    raus: 'Ich höre auf',
  },
  12: {
    titel: 'Zwölf.',
    text: 'Du hast ein Dutzend Fragen beantwortet. Es sind {rest} übrig. Das ist keine Drohung, das ist eine Zahl.',
    weiter: 'Weiter',
    raus: 'Das reicht mir',
  },
  24: {
    titel: 'Vierundzwanzig. Ernsthaft?',
    text: 'An dieser Stelle steigen normalerweise alle aus. Du bist nicht normalerweise.',
    weiter: 'Immer noch weiter',
    raus: 'Jetzt ist Schluss',
  },
  45: {
    titel: 'Wir müssen reden.',
    text: 'Fünfundvierzig Fragen. Niemand hat dich dazu gezwungen. Es gibt keinen Preis. Es gab nie einen Preis.',
    weiter: 'Es gibt keinen Preis. Weiter.',
    raus: 'Okay, ich gehe',
  },
  75: {
    titel: 'Fünfundsiebzig.',
    text: 'Deine Urkunde wird das erwähnen. Falls du dich gefragt hast, ob es irgendwo festgehalten wird: ja.',
    weiter: 'Gut. Weiter.',
    raus: 'Ich nehme, was ich habe',
  },
  111: {
    titel: 'Es sind nur noch wenige.',
    text: 'Wir sagen das nicht, um dich zu locken. Wir sagen es, weil wir an dieser Stelle selbst neugierig geworden sind.',
    weiter: 'Zu Ende bringen',
    raus: 'Nein, hier höre ich auf',
  },
};

export function nachfrage(beantwortet: number, gesamt: number): Nachfrage | null {
  const vorlage = NACHFRAGEN[beantwortet];
  if (!vorlage) return null;

  const rest = Math.max(0, gesamt - beantwortet);
  const prozent = gesamt > 0 ? Math.round((beantwortet / gesamt) * 100) : 0;

  return {
    ...vorlage,
    text: vorlage.text
      .replace('{gesamt}', String(gesamt))
      .replace('{rest}', String(rest))
      .replace('{prozent}', String(prozent)),
  };
}

const RICHTIG_ZEILEN = [
  'Richtig.',
  'Korrekt. Notiert.',
  'Stimmt. Ärgerlich, oder?',
  'Richtig – und das ganz ohne Nachschlagen, nehmen wir an.',
  'Ja. Das war die richtige.',
] as const;

const FALSCH_ZEILEN = [
  'Nein.',
  'Falsch. Aber selbstbewusst falsch.',
  'Nicht ganz. Also gar nicht.',
  'Daneben. Passiert den Besten und dir.',
  'Nein. Wir hatten kurz Hoffnung.',
] as const;

/** Die Reaktion auf eine Antwort – wie alles hier über einen Zähler, nicht gewürfelt. */
export function antwortEcho(richtig: boolean, zaehler: number): string {
  const zeilen = richtig ? RICHTIG_ZEILEN : FALSCH_ZEILEN;

  return zeilen[Math.abs(zaehler) % zeilen.length] ?? zeilen[0];
}

const NOTENTEXT: Record<number, string> = {
  1: 'Sehr gut. Wir sind ehrlich überrascht.',
  2: 'Gut. Das hätte auch schlimmer ausgehen können.',
  3: 'Befriedigend. Das Wort sagt alles.',
  4: 'Ausreichend. Du darfst trotzdem Server anlegen. Viel Glück uns allen.',
  5: 'Mangelhaft. Aber bestanden, weil wir dich mögen.',
};

export function notentext(wert: number): string {
  return NOTENTEXT[wert] ?? NOTENTEXT[3] ?? '';
}
