/**
 * Der Rundgang: welche Stationen er hat und wo sein Zettel hinkommt.
 *
 * Reine Logik, deshalb hier und nicht in der Ansicht: Wohin das Kästchen neben
 * einem hervorgehobenen Element rutscht, wenn dieses ganz unten am Rand klebt,
 * ist Rechnerei – und Rechnerei, die man beim Ausprobieren im Browser nie
 * vollständig trifft, weil genau die Randlagen selten sind. Hier steht sie mit
 * Tests daneben.
 *
 * **Angefasst wird nichts über CSS-Klassen.** Jede Station nennt den Wert eines
 * `data-rundgang`-Attributs; wer ein Element verschiebt oder umbaut, nimmt das
 * Attribut mit, und der Rundgang findet es weiterhin. Fehlt das Element (ein
 * Eintrag, den dieses Konto nicht sehen darf) oder liegt es außerhalb des
 * Bildes (die Seitenleiste als geschlossene Schublade auf dem Telefon), wird
 * die Station übersprungen – siehe {@link naechsterSichtbarer}.
 */

export interface RundgangSchritt {
  key: string;
  /**
   * Wert des `data-rundgang`-Attributs am Zielelement, oder `null` für eine
   * Station ohne Ziel (Begrüßung, Schluss) – die steht dann in der Mitte.
   */
  ziel: string | null;
  titel: string;
  text: string;
}

export const RUNDGANG_SCHRITTE: readonly RundgangSchritt[] = [
  {
    key: 'willkommen',
    ziel: null,
    titel: 'Kurz stehen bleiben.',
    text: 'Du bist zum ersten Mal hier. Wir zeigen dir in einer halben Minute, wo was liegt – sonst klickst du eine Stunde lang auf Dinge und erzählst danach, das Panel sei kaputt. Mit Escape kommst du jederzeit raus.',
  },
  {
    key: 'menue',
    ziel: 'menue',
    titel: 'Das Menü',
    text: 'Auf dem Telefon versteckt sich die Navigation hinter diesem Knopf. Du kannst sie auch mit dem Finger von links hereinziehen. Ja, das ist absichtlich so gebaut. Nein, wir erwarten keinen Applaus.',
  },
  {
    key: 'servers',
    ziel: 'nav-servers',
    titel: 'Deine Server',
    text: 'Hier liegt alles, was läuft oder laufen sollte: Zustand, Auslastung, Adresse zum Kopieren, Start und Stopp. Diese Seite wirst du in 90 Prozent der Fälle brauchen. Die anderen 10 Prozent sind Backups.',
  },
  {
    key: 'server-neu',
    ziel: 'nav-server-new',
    titel: 'Server erstellen',
    text: 'Spiel wählen, Namen vergeben, Ressourcen einstellen, fertig. Dein Kontingent steht daneben – es ist kleiner, als du gleich einstellen willst.',
  },
  {
    key: 'backups',
    ziel: 'nav-my-backups',
    titel: 'Backups',
    text: 'Sichern und wiederherstellen. Merk dir diesen Eintrag besser jetzt, im ruhigen Zustand, als am Freitagabend im anderen.',
  },
  {
    key: 'nachrichten',
    ziel: 'nav-messages',
    titel: 'Nachrichten',
    text: 'Der Chat mit dem Rest der Truppe, samt Zähler für Ungelesenes. Es gibt eine Moderation, und sie wird von echten Menschen bedient.',
  },
  {
    key: 'glocke',
    ziel: 'glocke',
    titel: 'Benachrichtigungen',
    text: 'Server gestartet, Backup fertig, Anfrage beantwortet – alles läuft hier auf. Du kannst alles stummschalten und dich danach wundern, warum dir niemand Bescheid gesagt hat.',
  },
  {
    key: 'arcade',
    ziel: 'nav-arcade',
    titel: 'Arcade',
    text: 'Minispiele mit Bestenliste, für die Zeit, in der dein Server startet. Die Bestenliste zeigt deinen Namen sehr deutlich an.',
  },
  {
    key: 'konto',
    ziel: 'konto',
    titel: 'Dein Konto',
    text: 'Profilbild, Passwort, Zwei-Faktor – und hier schaltest du diesen Rundgang später wieder ein, falls du ihn vermisst. Den zweiten Faktor bitte wirklich einschalten.',
  },
  {
    key: 'tutorial',
    ziel: 'nav-tutorial',
    titel: 'Und wenn du alles vergisst',
    text: 'Dann steht es im Tutorial noch einmal. Ausführlicher. Und unverschämter als hier.',
  },
  {
    key: 'fertig',
    ziel: null,
    titel: 'Das war er.',
    text: 'Du weißt jetzt, wo alles liegt. Was du damit anstellst, ist deine Sache – und steht anschließend im Audit-Log.',
  },
] as const;

export interface Rechteck {
  top: number;
  left: number;
  breite: number;
  hoehe: number;
}

export interface Fenster {
  breite: number;
  hoehe: number;
}

/**
 * Liegt das Ziel im Bild?
 *
 * Nicht nur „gibt es das Element", sondern „sieht man es auch": Die
 * Seitenleiste ist auf dem Telefon als geschlossene Schublade vollständig nach
 * links aus dem Bild geschoben (`-translate-x-full`). Sie steht im DOM, hat
 * eine Größe – und ein Scheinwerfer darauf leuchtete neben den Bildschirm.
 * Ein Element mit Breite oder Höhe null ist ausgeblendet (`md:hidden` am
 * Menü-Knopf) und zählt ebenfalls nicht.
 */
export function istSichtbar(ziel: Rechteck, fenster: Fenster): boolean {
  if (ziel.breite <= 0 || ziel.hoehe <= 0) return false;

  return (
    ziel.left + ziel.breite > 0 &&
    ziel.left < fenster.breite &&
    ziel.top + ziel.hoehe > 0 &&
    ziel.top < fenster.hoehe
  );
}

/**
 * Die nächste Station, die sich auch zeigen lässt.
 *
 * `sichtbar` fragt den Aufrufer, ob es das Ziel gerade gibt – im Browser ein
 * Blick ins DOM, im Test eine Liste. Stationen ohne Ziel sind immer sichtbar.
 * Gibt es in der gewünschten Richtung keine mehr, kommt `null` zurück; für den
 * Rundgang heißt das „zu Ende".
 */
export function naechsterSichtbarer(
  schritte: readonly RundgangSchritt[],
  start: number,
  richtung: 1 | -1,
  sichtbar: (ziel: string) => boolean,
): number | null {
  for (let i = start; i >= 0 && i < schritte.length; i += richtung) {
    const schritt = schritte[i];
    if (!schritt) break;
    if (schritt.ziel === null || sichtbar(schritt.ziel)) return i;
  }

  return null;
}

/** Luft zwischen Zielelement und Ausschnittkante. */
export const AUSSCHNITT_LUFT = 6;

/**
 * Die vier Flächen, die alles **außer** dem Ziel verdecken.
 *
 * Statt eines Lochs per `box-shadow: 0 0 0 9999px` vier schlichte Rechtecke:
 * oben, unten, links, rechts. Sie tragen dieselbe Klasse wie der Schleier
 * hinter der mobilen Schublade, brauchen keinen literalen Farbwert im Code und
 * fangen nebenbei jeden Klick ab – während des Rundgangs soll niemand
 * versehentlich einen Server starten.
 *
 * Ohne Ziel (Begrüßung, Schluss) ist es eine einzige Fläche über allem.
 */
export function ausschnittFlaechen(ziel: Rechteck | null, fenster: Fenster): Rechteck[] {
  if (ziel === null) {
    return [{ top: 0, left: 0, breite: fenster.breite, hoehe: fenster.hoehe }];
  }

  const oben = Math.max(0, ziel.top - AUSSCHNITT_LUFT);
  const unten = Math.min(fenster.hoehe, ziel.top + ziel.hoehe + AUSSCHNITT_LUFT);
  const links = Math.max(0, ziel.left - AUSSCHNITT_LUFT);
  const rechts = Math.min(fenster.breite, ziel.left + ziel.breite + AUSSCHNITT_LUFT);

  return [
    { top: 0, left: 0, breite: fenster.breite, hoehe: oben },
    { top: unten, left: 0, breite: fenster.breite, hoehe: Math.max(0, fenster.hoehe - unten) },
    { top: oben, left: 0, breite: links, hoehe: Math.max(0, unten - oben) },
    {
      top: oben,
      left: rechts,
      breite: Math.max(0, fenster.breite - rechts),
      hoehe: Math.max(0, unten - oben),
    },
  ];
}

/** Breite des Zettels in Bildpunkten – dieselbe Zahl wie `w-80` in der Ansicht. */
export const ZETTEL_BREITE = 320;

/** Abstand des Zettels zum Ziel und zum Fensterrand. */
export const ZETTEL_ABSTAND = 12;

export interface ZettelPlatz {
  top: number;
  left: number;
  /** Wo der Zettel gelandet ist – die Ansicht setzt danach ihr Pfeilchen. */
  seite: 'oben' | 'unten' | 'mitte';
}

/**
 * Wohin der Zettel neben dem hervorgehobenen Element kommt.
 *
 * Erst unter das Ziel, weil man von oben nach unten liest. Passt er dort nicht
 * mehr ganz ins Bild, klappt er darüber; passt er auch dort nicht, bleibt er
 * unten und wird an den Rand geschoben – lieber ein Zettel, der das Ziel
 * teilweise überlappt, als einer, der halb außerhalb des Fensters steht und
 * dessen Knöpfe niemand erreicht.
 *
 * Ohne Ziel steht er mittig.
 */
export function zettelPlatz(
  ziel: Rechteck | null,
  fenster: Fenster,
  zettelHoehe: number,
): ZettelPlatz {
  if (ziel === null) {
    return {
      top: Math.max(ZETTEL_ABSTAND, (fenster.hoehe - zettelHoehe) / 2),
      left: Math.max(ZETTEL_ABSTAND, (fenster.breite - ZETTEL_BREITE) / 2),
      seite: 'mitte',
    };
  }

  const darunter = ziel.top + ziel.hoehe + ZETTEL_ABSTAND;
  const darueber = ziel.top - ZETTEL_ABSTAND - zettelHoehe;

  const passtDarunter = darunter + zettelHoehe + ZETTEL_ABSTAND <= fenster.hoehe;
  const passtDarueber = darueber >= ZETTEL_ABSTAND;

  const seite: ZettelPlatz['seite'] = passtDarunter || !passtDarueber ? 'unten' : 'oben';
  const roh = seite === 'unten' ? darunter : darueber;

  return {
    top: klemme(
      roh,
      ZETTEL_ABSTAND,
      Math.max(ZETTEL_ABSTAND, fenster.hoehe - zettelHoehe - ZETTEL_ABSTAND),
    ),
    left: klemme(
      ziel.left,
      ZETTEL_ABSTAND,
      Math.max(ZETTEL_ABSTAND, fenster.breite - ZETTEL_BREITE - ZETTEL_ABSTAND),
    ),
    seite,
  };
}

function klemme(wert: number, min: number, max: number): number {
  return Math.min(Math.max(wert, min), max);
}
