/**
 * Erfolge, Titel und Stufen (Betreiber-Wunsch 21.09.2026).
 *
 * Eine rein spielerische Ebene über dem Panel: Wer etwas zum ersten Mal tut
 * oder oft genug wiederholt, schaltet ein Abzeichen frei; manche Abzeichen
 * bringen einen Titel mit, den das Konto neben seinem Anzeigenamen tragen darf.
 * Die Stufe ergibt sich allein aus der Zahl der freigeschalteten Abzeichen.
 *
 * **Warum Abzeichen und keine Erfahrungspunkte je Aktion.** Ein Punktestand,
 * der mit jeder Aktion wächst, belohnt in diesem Panel genau das Falsche: Server
 * anlegen, Backups anstoßen und Klone ziehen kosten Plattenplatz, Ports und
 * Rechenzeit auf einem Homeserver, den sich alle teilen. Ein Abzeichen lässt
 * sich dagegen genau einmal verdienen – danach bringt Wiederholung nichts mehr.
 * Deshalb gibt es hier weder eine Punkte-Tabelle noch einen Punktestand am
 * Konto, sondern nur die Menge der freigeschalteten Abzeichen (siehe
 * {@link levelForUnlocked}).
 *
 * **Warum Schwellen bewusst niedrig bleiben.** Die Instanz hat ein paar Dutzend
 * Konten, keine Tausend. Eine Stufenleiter, die 500 Backups verlangt, wäre für
 * diesen Kreis unerreichbar und damit wirkungslos. Die höchste Schwelle im
 * Katalog liegt deshalb bei 25.
 *
 * **Einmal freigeschaltet, bleibt freigeschaltet.** Abzeichen werden nie wieder
 * entzogen. Das ist keine Nachlässigkeit, sondern notwendig: Die Zählungen
 * stützen sich auf das Audit-Log, und dessen Einträge wandern nach 24 Monaten
 * ins Archiv (`AUDIT_RETENTION_MONTHS`). Würde die Stufe laufend neu berechnet,
 * sänke sie still in dem Moment, in dem alte Einträge wegrollen. Der
 * freigeschaltete Zustand liegt deshalb als eigene Zeile in der Datenbank und
 * nicht als Abfrage über das Log.
 */

// ---------------------------------------------------------------------------
// Kategorien
// ---------------------------------------------------------------------------

/**
 * Rubriken des Katalogs – zugleich die Reihenfolge der Abschnitte in der
 * Übersicht (F-Erfolge).
 */
export const ACHIEVEMENT_CATEGORIES = ['server', 'backup', 'arcade', 'konto', 'betrieb'] as const;

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

/** Überschrift einer Rubrik in der Übersicht. */
export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  server: 'Server',
  backup: 'Sicherungen',
  arcade: 'Spielhalle',
  konto: 'Konto',
  betrieb: 'Betrieb',
};

// ---------------------------------------------------------------------------
// Katalog
// ---------------------------------------------------------------------------

/**
 * Kennungen aller Abzeichen.
 *
 * Reihenfolge = Reihenfolge innerhalb der Rubrik in der Übersicht. Der Katalog
 * ist additiv erweiterbar: neue Kennung hier, Definition in
 * {@link ACHIEVEMENT_CATALOG}, Auslöser in der Regel-Tabelle des Backends.
 * Das Entfernen einer Kennung ist dagegen ein Breaking Change – bereits
 * freigeschaltete Zeilen ließen sich nicht mehr zuordnen.
 */
export const ACHIEVEMENT_IDS = [
  // Server (B3)
  'grundsteinleger',
  'flottenkommando',
  'doppelgaenger',
  'gastgeber',
  'schraubergeist',
  'aufraeumer',

  // Sicherungen (B5)
  'guertelUndHosentraeger',
  'vorsorglich',
  'esLiefDochGestern',

  // Spielhalle (F8)
  'eingeworfen',
  'alleskoenner',
  'hartnaeckig',
  'spielhallenlegende',

  // Konto (B1)
  'ersteStunde',
  'doppeltHaeltBesser',
  'zutrittVerweigert',
  'nachtschicht',

  // Betrieb (B8)
  'tuersteher',
  'schriftsetzer',
  'hausmeisterei',
] as const;

/** Gültige Abzeichen-Kennung – verhindert Freitext-Strings. */
export type AchievementId = (typeof ACHIEVEMENT_IDS)[number];

/** Beschreibung eines Abzeichens für die Übersicht. */
export interface AchievementDefinition {
  readonly id: AchievementId;
  /** Angezeigter Name des Abzeichens. */
  readonly name: string;
  /** Ein Satz, was man getan hat – steht unter dem Namen, wenn es freigeschaltet ist. */
  readonly description: string;
  /**
   * Ein Satz, wie man es bekommt – steht an Stelle der Beschreibung, solange es
   * verschlossen ist. Bei {@link AchievementDefinition.secret} zeigt die
   * Oberfläche ihn nicht.
   */
  readonly hint: string;
  readonly category: AchievementCategory;
  /**
   * Titel, den dieses Abzeichen mitbringt; `null`, wenn es keinen gibt.
   *
   * Bewusst nur an wenigen Abzeichen: Trüge jedes einen Titel, wäre die Auswahl
   * eine Liste von zwanzig Einträgen und keine Auszeichnung mehr. Alle Titel
   * sind geschlechtsneutral formuliert – sie stehen neben einem fremden Namen,
   * und das Panel kennt kein Geschlecht zum Konto.
   */
  readonly title: string | null;
  /**
   * Verschlossene Abzeichen dieser Art erscheinen in der Übersicht ohne Namen
   * und ohne Hinweis. Die Überraschung ist der ganze Witz daran – ein Hinweis
   * „Werde einmal abgewiesen" würde dazu einladen, es abzuarbeiten.
   */
  readonly secret?: true;
}

/**
 * Der Katalog (Betreiber-Wunsch 21.09.2026).
 *
 * Alle Auslöser hängen an Vorgängen, die das Panel **ohnehin schon**
 * protokolliert (Audit-Log, Pflichtenheft §6) oder speichert (Arcade-Punkte).
 * Es gibt deshalb kein Abzeichen für „Server neu gestartet": Der Neustart ist
 * ein Live-Ereignis und steht nicht im Log – ein Abzeichen dafür hätte eine
 * zweite Protokollierung verlangt, nur um gezählt werden zu können.
 *
 * Ebenso bewusst **kein** Abzeichen, das sich durch Wiederholen einer teuren
 * oder zerstörenden Aktion erreichen lässt. `aufraeumer` (Server gelöscht) gibt
 * es genau einmal, nicht zehnmal; `vorsorglich` zählt angelegte Sicherungen bis
 * 10 und danach nie wieder.
 */
export const ACHIEVEMENT_CATALOG: Record<AchievementId, AchievementDefinition> = {
  // --- Server ---------------------------------------------------------------
  grundsteinleger: {
    id: 'grundsteinleger',
    name: 'Grundsteinleger',
    description: 'Du hast deinen ersten Server angelegt.',
    hint: 'Lege einen Server an.',
    category: 'server',
    title: null,
  },
  flottenkommando: {
    id: 'flottenkommando',
    name: 'Flottenkommando',
    description: 'Fünf Server gehen auf dein Konto.',
    hint: 'Lege insgesamt fünf Server an.',
    category: 'server',
    title: 'Flottenkommando',
  },
  doppelgaenger: {
    id: 'doppelgaenger',
    name: 'Doppelgänger',
    description: 'Warum neu bauen, wenn es den schon gibt.',
    hint: 'Klone einen Server.',
    category: 'server',
    title: null,
  },
  gastgeber: {
    id: 'gastgeber',
    name: 'Gastgeber',
    description: 'Du hast jemanden auf einen deiner Server gelassen.',
    hint: 'Füge ein Mitglied zu einem Server hinzu.',
    category: 'server',
    title: 'Gastgeber',
  },
  schraubergeist: {
    id: 'schraubergeist',
    name: 'Schraubergeist',
    description: 'Fünfundzwanzig Mal an den Einstellungen gedreht. Jetzt läuft es bestimmt.',
    hint: 'Ändere fünfundzwanzig Mal die Einstellungen eines Servers.',
    category: 'server',
    title: 'Schraubergeist',
  },
  aufraeumer: {
    id: 'aufraeumer',
    name: 'Aufräumer',
    description: 'Einmal durchgewischt – ein Server weniger.',
    hint: 'Lösche einen Server, den du nicht mehr brauchst.',
    category: 'server',
    title: null,
  },

  // --- Sicherungen ----------------------------------------------------------
  guertelUndHosentraeger: {
    id: 'guertelUndHosentraeger',
    name: 'Gürtel und Hosenträger',
    description: 'Deine erste Sicherung liegt bereit.',
    hint: 'Lege eine Sicherung an.',
    category: 'backup',
    title: null,
  },
  vorsorglich: {
    id: 'vorsorglich',
    name: 'Vorsorglich',
    description: 'Zehn Sicherungen. Man weiß ja nie.',
    hint: 'Lege insgesamt zehn Sicherungen an.',
    category: 'backup',
    title: null,
  },
  esLiefDochGestern: {
    id: 'esLiefDochGestern',
    name: 'Es lief doch gestern noch',
    description: 'Du hast eine Sicherung zurückgespielt. Gut, dass du sie hattest.',
    hint: 'Spiele eine Sicherung zurück.',
    category: 'backup',
    title: 'Zeitumkehr',
  },

  // --- Spielhalle -----------------------------------------------------------
  eingeworfen: {
    id: 'eingeworfen',
    name: 'Eingeworfen',
    description: 'Erste Runde in der Spielhalle gedreht.',
    hint: 'Spiele eine Runde in der Arcade.',
    category: 'arcade',
    title: null,
  },
  alleskoenner: {
    id: 'alleskoenner',
    name: 'Alleskönner',
    description: 'Jedes Minispiel mindestens einmal gespielt.',
    hint: 'Spiele jedes Minispiel mindestens einmal.',
    category: 'arcade',
    title: null,
  },
  hartnaeckig: {
    id: 'hartnaeckig',
    name: 'Hartnäckig',
    description: 'Fünfundzwanzig Runden. Die nächste wird die gute.',
    hint: 'Spiele insgesamt fünfundzwanzig Runden.',
    category: 'arcade',
    title: null,
  },
  spielhallenlegende: {
    id: 'spielhallenlegende',
    name: 'Spielhallenlegende',
    description: 'Platz eins in einer Bestenliste – zumindest für den Moment.',
    hint: 'Stehe in einer Bestenliste auf Platz eins.',
    category: 'arcade',
    title: 'Spielhallenlegende',
  },

  // --- Konto ----------------------------------------------------------------
  ersteStunde: {
    id: 'ersteStunde',
    name: 'Erste Stunde',
    description: 'Du warst von Anfang an dabei – eines der ersten fünf Konten.',
    hint: 'Gehöre zu den ersten fünf Konten der Instanz.',
    category: 'konto',
    title: 'Erste Stunde',
  },
  doppeltHaeltBesser: {
    id: 'doppeltHaeltBesser',
    name: 'Doppelt hält besser',
    description: 'Zwei-Faktor eingeschaltet. Vorbildlich.',
    hint: 'Schalte die Zwei-Faktor-Anmeldung ein.',
    category: 'konto',
    title: null,
  },
  zutrittVerweigert: {
    id: 'zutrittVerweigert',
    name: 'Zutritt verweigert',
    description: 'Du hast an einer Tür gerüttelt, die dir nicht gehört. Steht jetzt im Protokoll.',
    hint: 'Wird sich schon ergeben.',
    category: 'konto',
    title: 'Zutritt verweigert',
    secret: true,
  },
  nachtschicht: {
    id: 'nachtschicht',
    name: 'Nachtschicht',
    description: 'Zwischen drei und fünf Uhr morgens im Panel unterwegs gewesen.',
    hint: 'Irgendwann wirst du wach sein, wenn andere schlafen.',
    category: 'konto',
    title: 'Nachtschicht',
    secret: true,
  },

  // --- Betrieb --------------------------------------------------------------
  tuersteher: {
    id: 'tuersteher',
    name: 'Türsteher',
    description: 'Du hast jemanden hereingelassen – ein Konto freigeschaltet.',
    hint: 'Schalte ein wartendes Konto frei.',
    category: 'betrieb',
    title: null,
  },
  schriftsetzer: {
    id: 'schriftsetzer',
    name: 'Schriftsetzer',
    description: 'Eigene Schrift hochgeladen. Das Panel trägt jetzt deine Handschrift.',
    hint: 'Lade eine eigene Schrift für die Oberfläche hoch.',
    category: 'betrieb',
    title: null,
  },
  hausmeisterei: {
    id: 'hausmeisterei',
    name: 'Hausmeisterei',
    description: 'Fünfzig protokollierte Handgriffe. Jemand muss den Laden ja zusammenhalten.',
    hint: 'Hinterlasse fünfzig Einträge im Protokoll.',
    category: 'betrieb',
    title: 'Hausmeisterei',
  },
};

/** Alle Abzeichen in Katalogreihenfolge. */
export const ACHIEVEMENTS: readonly AchievementDefinition[] = ACHIEVEMENT_IDS.map(
  (id) => ACHIEVEMENT_CATALOG[id],
);

/** Prüft, ob ein beliebiger String eine bekannte Abzeichen-Kennung ist. */
export function isAchievementId(value: string): value is AchievementId {
  return Object.prototype.hasOwnProperty.call(ACHIEVEMENT_CATALOG, value);
}

/**
 * Abzeichen, die einen Titel mitbringen – die vollständige Auswahlliste, wenn
 * jemand alles freigeschaltet hat.
 */
export const TITLE_ACHIEVEMENTS: readonly AchievementDefinition[] = ACHIEVEMENTS.filter(
  (entry) => entry.title !== null,
);

/** Titel eines Abzeichens; `null`, wenn es keinen mitbringt oder unbekannt ist. */
export function titleForAchievement(id: string): string | null {
  return isAchievementId(id) ? ACHIEVEMENT_CATALOG[id].title : null;
}

// ---------------------------------------------------------------------------
// Stufen
// ---------------------------------------------------------------------------

/** Eine Stufe der Leiter. */
export interface AchievementLevel {
  /** Stufennummer, beginnend bei 1. */
  readonly level: number;
  /** Ab so vielen freigeschalteten Abzeichen gilt diese Stufe. */
  readonly required: number;
  /** Angezeigter Name der Stufe. */
  readonly label: string;
}

/**
 * Die Stufenleiter (Betreiber-Wunsch 21.09.2026 „Level aufsteigen").
 *
 * Abgeleitet aus der Zahl der freigeschalteten Abzeichen – es gibt **keinen**
 * zweiten Punktestand, der nebenher mitliefe und eigens gespeichert werden
 * müsste. Wer ein Abzeichen bekommt, sieht seine Stufe steigen; wer nichts tut,
 * bleibt stehen. Aufsteigend sortiert; `required: 0` ist der Einstieg, den jedes
 * Konto ohne Zutun hat.
 */
export const ACHIEVEMENT_LEVELS: readonly AchievementLevel[] = [
  { level: 1, required: 0, label: 'Neuling' },
  { level: 2, required: 2, label: 'Eingelebt' },
  { level: 3, required: 5, label: 'Stammgast' },
  { level: 4, required: 9, label: 'Kenner' },
  { level: 5, required: 13, label: 'Veteran' },
  { level: 6, required: 17, label: 'Urgestein' },
  { level: 7, required: ACHIEVEMENT_IDS.length, label: 'Vollständig' },
];

/** Erreichte Stufe bei `unlockedCount` freigeschalteten Abzeichen. */
export function levelForUnlocked(unlockedCount: number): AchievementLevel {
  let erreicht = ACHIEVEMENT_LEVELS[0] as AchievementLevel;

  for (const stufe of ACHIEVEMENT_LEVELS) {
    if (unlockedCount >= stufe.required) erreicht = stufe;
  }

  return erreicht;
}

/**
 * Nächste Stufe nach `unlockedCount`; `null` auf der höchsten.
 *
 * Die Oberfläche zeigt damit „noch 2 bis Stammgast", ohne die Leiter selbst
 * durchsuchen zu müssen.
 */
export function nextLevelAfter(unlockedCount: number): AchievementLevel | null {
  return ACHIEVEMENT_LEVELS.find((stufe) => stufe.required > unlockedCount) ?? null;
}

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/**
 * Ein Abzeichen aus Sicht eines Kontos.
 *
 * Bei einem verschlossenen geheimen Abzeichen (`secret`) sind `name`,
 * `description` und `hint` bewusst leer und `id` steht trotzdem darin – die
 * Oberfläche braucht einen stabilen Schlüssel für die Kachel, soll aber nichts
 * verraten. Sobald es freigeschaltet ist, kommen die Texte mit.
 */
export interface AchievementDto {
  id: AchievementId;
  category: AchievementCategory;
  /** Leer, solange ein geheimes Abzeichen verschlossen ist. */
  name: string;
  /** Beschreibung bei freigeschalteten, Hinweis bei verschlossenen Abzeichen. */
  description: string;
  /** Titel, den dieses Abzeichen mitbringt; `null`, wenn es keinen gibt. */
  title: string | null;
  /** Verschlossenes Geheimnis – die Oberfläche zeigt eine anonyme Kachel. */
  secret: boolean;
  /** ISO-8601-Zeitstempel der Freischaltung; `null`, solange verschlossen. */
  unlockedAt: string | null;
}

/**
 * Ein wählbarer Titel.
 *
 * `achievementId` ist der gespeicherte Wert – nicht der Text. Wird ein Titel im
 * Katalog später umbenannt, trägt das Konto weiter denselben Titel und nicht
 * plötzlich keinen mehr.
 */
export interface AchievementTitleDto {
  achievementId: AchievementId;
  title: string;
}

/**
 * Serverseitig berechnetes `permissions`-Objekt (Pflichtenheft §5.2).
 *
 * Der Bereich kennt keine eigene Permission im Katalog: Abzeichen sammelt jedes
 * freigeschaltete Konto, und zwar nur die eigenen. `canChooseTitle` ist deshalb
 * schlicht „es gibt mindestens einen freigeschalteten Titel".
 */
export interface AchievementOverviewPermissions {
  canChooseTitle: boolean;
}

/** Die Abzeichen-Übersicht eines Kontos (Betreiber-Wunsch 21.09.2026). */
export interface AchievementOverviewDto {
  /** Alle Abzeichen des Katalogs, freigeschaltete wie verschlossene. */
  entries: AchievementDto[];
  unlockedCount: number;
  totalCount: number;
  level: AchievementLevel;
  /** Nächste Stufe; `null` auf der höchsten. */
  nextLevel: AchievementLevel | null;
  /** Titel, die das Konto tragen darf – aus seinen freigeschalteten Abzeichen. */
  availableTitles: AchievementTitleDto[];
  /** Getragener Titel; `null`, wenn keiner gewählt ist. */
  selectedTitle: AchievementTitleDto | null;
  permissions: AchievementOverviewPermissions;
}

/**
 * Ergebnis einer Titel-Wahl.
 *
 * Gibt die ganze Übersicht zurück, damit die Seite nach dem Wechsel nicht noch
 * einmal laden muss – dieselbe Linie wie beim Absenden eines Arcade-Ergebnisses.
 */
export type AchievementTitleChangeDto = AchievementOverviewDto;
