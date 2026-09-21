import { STANDARD_THEME_ID } from './palette';

/**
 * Die Texte, die ein Theme mitbringen darf.
 *
 * Ein Theme ändert bis hierher nur Farben. Das hier ist die zweite Hälfte:
 * ein paar Sätze der Oberfläche dürfen je nach gewähltem Aussehen anders
 * klingen.
 *
 * ---
 *
 * **Die Zonenregel – der wichtigste Satz dieser Datei.**
 *
 * Gewitzte Texte stehen ausschließlich dort, wo ein Missverständnis **nichts
 * kostet**: Begrüßung, Leerzustände, „Seite gibt es nicht". Das sind Stellen,
 * an denen gerade nichts passiert und niemand etwas entscheidet.
 *
 * Neutral bleibt dagegen alles, wo ein Fehlgriff etwas kostet:
 *
 * - Bestätigungen zerstörerischer Aktionen (Server löschen, Backup verwerfen)
 * - Fehlermeldungen und „Kein Zugriff"
 * - Statusanzeigen, Kennzahlen, Zeitangaben
 * - Administration und alles, was mit Sicherheit zu tun hat
 *
 * Dieses Panel startet, stoppt und **löscht** echte Gameserver. Ein
 * Bestätigungsdialog, der einen Scherz macht, statt klar zu sagen, was gleich
 * weg ist, kostet jemandem seine Daten. Deshalb gibt es für solche Texte hier
 * bewusst **keine** Slots – nicht als Regel zum Einhalten, sondern als
 * Mechanik, die es gar nicht erst anbietet.
 *
 * ---
 *
 * **Die Auskunft muss überleben.** Ein Leerzustand sagt nicht nur „hier ist
 * nichts", sondern auch, wie es weitergeht („Lege deinen ersten Gameserver
 * an"). Ein Theme darf den Ton ändern, nicht die Auskunft weglassen. Wer
 * einen Spruch schreibt, der nur witzig ist, hat die Hälfte gelöscht.
 *
 * **Eigene Worte, keine Zitate.** Die Themes spielen auf Stimmungen an, nicht
 * auf bestimmte Filme, und tragen keine fremden Namen oder Zitate – der Code
 * liegt öffentlich. `sprueche.test.ts` erinnert daran.
 */

export interface Spruch {
  readonly titel: string;
  /** Der Satz darunter. Trägt die Auskunft und darf sie nicht verlieren. */
  readonly text: string;
}

/**
 * Jede Stelle, die ein Theme anders formulieren darf – abschließend.
 *
 * Die Liste ist kurz und soll es bleiben. Sie wächst nur um Stellen, die die
 * Zonenregel oben aushalten.
 */
export const SPRUCH_SLOTS = [
  /** Überschrift der Anmeldeseite. */
  'anmeldung',
  /** Noch kein einziger Server angelegt. */
  'serverLeer',
  /** Filter oder Suche ohne Ergebnis. */
  'keinTreffer',
  /** Server ohne Sicherung. */
  'sicherungenLeer',
  /** Leerer Posteingang. */
  'meldungenLeer',
  /** Keine geplanten Aufgaben am Server. */
  'aufgabenLeer',
  /** Aufgerufene Adresse gibt es nicht (404). */
  'nichtGefunden',
] as const;

export type SpruchSlot = (typeof SPRUCH_SLOTS)[number];

/**
 * Die neutralen Texte – **wortgleich mit dem, was vorher fest im Markup
 * stand**.
 *
 * Damit sieht eine Oberfläche ohne Theme-Wahl exakt so aus wie zuvor, und
 * zugleich ist dieser Satz der Rückfall für jedes Theme, das eine Stelle
 * auslässt. Ein Theme muss deshalb **nicht** alle Slots besetzen: Wer nur die
 * Farben ändern will, ändert nur die Farben.
 */
const NEUTRAL: Record<SpruchSlot, Spruch> = {
  anmeldung: {
    titel: 'Willkommen zurück',
    text: 'Melde dich an, um deine Gameserver zu verwalten.',
  },
  serverLeer: {
    titel: 'Noch keine Server',
    text: 'Lege deinen ersten Gameserver an – das dauert nur ein paar Klicks.',
  },
  keinTreffer: {
    titel: 'Kein Treffer',
    text: 'Kein Server passt zu dieser Auswahl. Ändere den Filter oder den Suchbegriff.',
  },
  sicherungenLeer: {
    titel: 'Noch keine Sicherungen',
    text: 'Sichere den Server jetzt oder warte auf den nächsten geplanten Lauf.',
  },
  meldungenLeer: {
    titel: 'Keine Benachrichtigungen',
    text: 'Serverstatus, Backups, Ankündigungen und mehr laufen hier zusammen.',
  },
  aufgabenLeer: {
    titel: 'Keine geplanten Aufgaben',
    text: 'Lege zum Beispiel einen nächtlichen Neustart oder einen Konsolenbefehl zu fester Uhrzeit an.',
  },
  nichtGefunden: {
    titel: 'Diese Seite gibt es nicht',
    text: 'Vielleicht ist der Link veraltet oder es hat sich ein Tippfehler in die Adresse eingeschlichen. Die Übersicht führt zurück zu deinen Servern.',
  },
};

/**
 * Was die einzelnen Themes anders sagen.
 *
 * Der Ton folgt dem Theme, die Auskunft bleibt: Wo der neutrale Text erklärt,
 * wie es weitergeht, erklärt es der gewitzte auch.
 */
const ABWEICHUNGEN: Record<string, Partial<Record<SpruchSlot, Spruch>>> = {
  schmiedefeuer: {
    anmeldung: {
      titel: 'Die Esse brennt noch',
      text: 'Melde dich an – deine Gameserver warten in der Werkstatt.',
    },
    serverLeer: {
      titel: 'Der Amboss ist noch kalt',
      text: 'Schmiede deinen ersten Gameserver – ein paar Klicks, mehr braucht es nicht.',
    },
    keinTreffer: {
      titel: 'Die Suche bleibt ohne Fund',
      text: 'Kein Server passt zu dieser Auswahl. Ändere den Filter oder den Suchbegriff.',
    },
    sicherungenLeer: {
      titel: 'Keine Abschrift vorhanden',
      text: 'Sichere den Server jetzt oder warte auf den nächsten geplanten Lauf.',
    },
    meldungenLeer: {
      titel: 'Die Annalen schweigen',
      text: 'Serverstatus, Backups und Ankündigungen laufen hier zusammen.',
    },
    aufgabenLeer: {
      titel: 'Nichts steht im Plan',
      text: 'Trage zum Beispiel einen nächtlichen Neustart ein oder einen Konsolenbefehl zu fester Stunde.',
    },
    nichtGefunden: {
      titel: 'Hier führt kein Pfad weiter',
      text: 'Der Link ist wohl veraltet oder hat einen Tippfehler. Die Übersicht führt zurück zu deinen Servern.',
    },
  },

  neonnacht: {
    anmeldung: {
      titel: 'Du bist zurück!',
      text: 'Melde dich an, deine Gameserver haben dich vermisst.',
    },
    serverLeer: {
      titel: 'Hier ist ja noch gar nichts los',
      text: 'Leg deinen ersten Gameserver an – ein paar Klicks, dann geht es los.',
    },
    keinTreffer: {
      titel: 'Nichts gefunden!',
      text: 'Kein Server passt dazu. Probier einen anderen Filter oder Suchbegriff.',
    },
    sicherungenLeer: {
      titel: 'Noch kein Backup!',
      text: 'Sichere den Server jetzt oder warte auf den nächsten geplanten Lauf.',
    },
    meldungenLeer: {
      titel: 'Alles ruhig',
      text: 'Serverstatus, Backups, Ankündigungen – alles läuft hier zusammen.',
    },
    aufgabenLeer: {
      titel: 'Kein Plan, kein Stress',
      text: 'Lege zum Beispiel einen nächtlichen Neustart an oder einen Konsolenbefehl zu fester Uhrzeit.',
    },
    nichtGefunden: {
      titel: 'Hoppla, Sackgasse',
      text: 'Der Link ist veraltet oder hat einen Tippfehler. Die Übersicht führt zurück zu deinen Servern.',
    },
  },

  kanzlei: {
    anmeldung: {
      titel: 'Willkommen zurück',
      text: 'Weise dich aus, dann stehen deine Gameserver zur Verfügung.',
    },
    serverLeer: {
      titel: 'Es liegt nichts vor',
      text: 'Ein erster Gameserver ist in wenigen Klicks angelegt.',
    },
    keinTreffer: {
      titel: 'Kein Treffer',
      text: 'Zu dieser Auswahl liegt nichts vor. Ändere den Filter oder den Suchbegriff.',
    },
    sicherungenLeer: {
      titel: 'Keine Sicherung zur Akte',
      text: 'Sichere den Server jetzt oder warte auf den nächsten geplanten Lauf.',
    },
    meldungenLeer: {
      titel: 'Der Posteingang ist leer',
      text: 'Serverstatus, Backups und Ankündigungen laufen hier zusammen.',
    },
    aufgabenLeer: {
      titel: 'Nichts terminiert',
      text: 'Setze zum Beispiel einen nächtlichen Neustart an oder einen Konsolenbefehl zu fester Uhrzeit.',
    },
    nichtGefunden: {
      titel: 'Vorgang nicht auffindbar',
      text: 'Der Link ist veraltet oder enthält einen Tippfehler. Die Übersicht führt zurück zu deinen Servern.',
    },
  },

  hyperraum: {
    anmeldung: {
      titel: 'Willkommen an Bord',
      text: 'Melde dich an, um deine Gameserver zu steuern.',
    },
    serverLeer: {
      titel: 'Der Sektor ist leer',
      text: 'Setz deinen ersten Gameserver aus – ein paar Klicks, dann steht er.',
    },
    keinTreffer: {
      titel: 'Die Sensoren melden nichts',
      text: 'Kein Server passt zu dieser Auswahl. Ändere den Filter oder den Suchbegriff.',
    },
    sicherungenLeer: {
      titel: 'Kein Abbild gespeichert',
      text: 'Sichere den Server jetzt oder warte auf den nächsten geplanten Lauf.',
    },
    meldungenLeer: {
      titel: 'Funkstille',
      text: 'Serverstatus, Backups und Ankündigungen laufen hier zusammen.',
    },
    aufgabenLeer: {
      titel: 'Keine Manöver geplant',
      text: 'Lege zum Beispiel einen nächtlichen Neustart an oder einen Konsolenbefehl zu fester Uhrzeit.',
    },
    nichtGefunden: {
      titel: 'Der Kurs führt ins Leere',
      text: 'Der Link ist veraltet oder enthält einen Tippfehler. Die Übersicht führt zurück zu deinen Servern.',
    },
  },
};

/**
 * Der Text einer Stelle im gewählten Theme.
 *
 * Kennt das Theme die Stelle nicht – oder ist die Kennung unbekannt –, kommt
 * der neutrale Text. Damit kann weder ein neues Theme noch ein von Hand
 * gesetztes Cookie einen leeren Kasten erzeugen.
 */
export function spruch(themeId: string, slot: SpruchSlot): Spruch {
  if (themeId === STANDARD_THEME_ID) return NEUTRAL[slot];
  return ABWEICHUNGEN[themeId]?.[slot] ?? NEUTRAL[slot];
}

/** Nur für Tests: die neutralen Texte und die Abweichungen je Theme. */
export const SPRUCH_TABELLEN = { NEUTRAL, ABWEICHUNGEN } as const;
