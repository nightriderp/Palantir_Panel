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
 * **Nur Admins können keine Abzeichen verdienen** (Betreiber, 21.09.2026). Was
 * hinter einem Recht aus dem Rollen-Katalog liegt, taugt nicht als Abzeichen:
 * Ein gewöhnliches Konto käme nie daran, und ein Abzeichen, das man nicht
 * erreichen kann, ist keine Auszeichnung, sondern eine Auskunft über die eigene
 * Rolle. Der Katalog hängt deshalb ausschließlich an Vorgängen, die jedem
 * freigeschalteten Konto offenstehen.
 *
 * **Schwellen nur auf Kostenlosem.** Die Staffeln (Runden, Platzierungen,
 * Anmeldungen) hängen an Vorgängen, die keine Ressourcen verbrauchen. Server,
 * Klone und Sicherungen kosten Plattenplatz und Rechenzeit auf einem geteilten
 * Homeserver – dort gibt es je genau ein Abzeichen und keine Leiter, sonst käme
 * der Farming-Anreiz durch die Hintertür zurück.
 *
 * **Die Platzierungs-Leiter ist mit Absicht albern** (Betreiber, 21.09.2026).
 * Bei einem guten Dutzend Konten ist „unter den besten 50" niemandes Leistung –
 * genau das ist der Witz, und die Beschreibungen sagen es auch. Wer das nicht
 * mag, streicht die Rubrik; der Rest des Katalogs hängt nicht daran.
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
export const ACHIEVEMENT_CATEGORIES = [
  'server',
  'backup',
  'arcade',
  'platzierung',
  'ausdauer',
  'konto',
] as const;

export type AchievementCategory = (typeof ACHIEVEMENT_CATEGORIES)[number];

/** Überschrift einer Rubrik in der Übersicht. */
export const ACHIEVEMENT_CATEGORY_LABELS: Record<AchievementCategory, string> = {
  server: 'Server',
  backup: 'Sicherungen',
  arcade: 'Spielhalle',
  platzierung: 'Platzierungen',
  ausdauer: 'Ausdauer',
  konto: 'Konto',
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

  // Platzierungen – die alberne Leiter (Betreiber, 21.09.2026)
  'platz50',
  'platz20',
  'platz10',
  'platz5',
  'platz3',
  'platz2',
  'spielhallenlegende',

  // Ausdauer – Staffeln auf Vorgänge, die nichts kosten
  'runden10',
  'hartnaeckig',
  'runden50',
  'runden100',
  'runden250',
  'runden500',
  'runden1000',
  'anmeldung10',
  'anmeldung50',
  'anmeldung100',
  'vielbeschaeftigt',
  'sammler10',
  'sammler20',
  'sammler30',

  // Konto (B1)
  'ersteStunde',
  'doppeltHaeltBesser',
  'zutrittVerweigert',
  'nachtschicht',
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

  // --- Platzierungen --------------------------------------------------------
  /*
   * Die alberne Leiter. Gezählt wird der **beste** Platz über alle
   * Bestenlisten: Wer in einem Spiel vorne steht, bekommt alle Stufen darunter
   * gleich mit. Das ist kein Versehen, sondern der Witz – bei einem Dutzend
   * Konten ist „Top 50" ohnehin geschenkt.
   */
  platz50: {
    id: 'platz50',
    name: 'Unter den besten 50',
    description: 'Top 50! Bei aktuell deutlich weniger als fünfzig Konten. Stark.',
    hint: 'Stehe in einer Bestenliste unter den ersten fünfzig.',
    category: 'platzierung',
    title: null,
  },
  platz20: {
    id: 'platz20',
    name: 'Unter den besten 20',
    description: 'Top 20. Das sind immer noch alle.',
    hint: 'Stehe in einer Bestenliste unter den ersten zwanzig.',
    category: 'platzierung',
    title: null,
  },
  platz10: {
    id: 'platz10',
    name: 'Unter den besten 10',
    description: 'Top 10. Jetzt wird es langsam knapp.',
    hint: 'Stehe in einer Bestenliste unter den ersten zehn.',
    category: 'platzierung',
    title: null,
  },
  platz5: {
    id: 'platz5',
    name: 'Unter den besten 5',
    description: 'Top 5. Hier hört der Spaß auf und die Bestenliste fängt an.',
    hint: 'Stehe in einer Bestenliste unter den ersten fünf.',
    category: 'platzierung',
    title: null,
  },
  platz3: {
    id: 'platz3',
    name: 'Auf dem Treppchen',
    description: 'Platz drei oder besser. Das ist tatsächlich etwas.',
    hint: 'Stehe in einer Bestenliste auf Platz drei oder besser.',
    category: 'platzierung',
    title: 'Treppchen',
  },
  platz2: {
    id: 'platz2',
    name: 'Zweitbester',
    description: 'Platz zwei oder besser. Der erste ist nur einen Versuch entfernt.',
    hint: 'Stehe in einer Bestenliste auf Platz zwei oder besser.',
    category: 'platzierung',
    title: null,
  },
  spielhallenlegende: {
    id: 'spielhallenlegende',
    name: 'Spielhallenlegende',
    description: 'Platz eins in einer Bestenliste – zumindest für den Moment.',
    hint: 'Stehe in einer Bestenliste auf Platz eins.',
    category: 'platzierung',
    title: 'Spielhallenlegende',
  },

  // --- Ausdauer -------------------------------------------------------------
  runden10: {
    id: 'runden10',
    name: 'Zehn Runden',
    description: 'Zehn Runden gespielt. Ein Anfang.',
    hint: 'Spiele insgesamt zehn Runden.',
    category: 'ausdauer',
    title: null,
  },
  hartnaeckig: {
    id: 'hartnaeckig',
    name: 'Hartnäckig',
    description: 'Fünfundzwanzig Runden. Die nächste wird die gute.',
    hint: 'Spiele insgesamt fünfundzwanzig Runden.',
    category: 'ausdauer',
    title: null,
  },
  runden50: {
    id: 'runden50',
    name: 'Fünfzig Runden',
    description: 'Fünfzig Runden. Das Panel hat übrigens auch andere Seiten.',
    hint: 'Spiele insgesamt fünfzig Runden.',
    category: 'ausdauer',
    title: null,
  },
  runden100: {
    id: 'runden100',
    name: 'Hundert Runden',
    description: 'Dreistellig. Respekt, ehrlich.',
    hint: 'Spiele insgesamt hundert Runden.',
    category: 'ausdauer',
    title: 'Dauergast',
  },
  runden250: {
    id: 'runden250',
    name: 'Zweihundertfünfzig Runden',
    description: 'Zweihundertfünfzig. Niemand hat das verlangt.',
    hint: 'Spiele insgesamt zweihundertfünfzig Runden.',
    category: 'ausdauer',
    title: null,
  },
  runden500: {
    id: 'runden500',
    name: 'Fünfhundert Runden',
    description: 'Fünfhundert Runden. Der Homeserver hat auch Spiele, weißt du.',
    hint: 'Spiele insgesamt fünfhundert Runden.',
    category: 'ausdauer',
    title: null,
  },
  runden1000: {
    id: 'runden1000',
    name: 'Tausend Runden',
    description:
      'Tausend Runden. An diesem Punkt ist es zwischen dir und der Spielhalle persönlich.',
    hint: 'Spiele insgesamt tausend Runden.',
    category: 'ausdauer',
    title: 'Spielhallen-Urgestein',
  },
  anmeldung10: {
    id: 'anmeldung10',
    name: 'Zehnmal angemeldet',
    description: 'Zehn Anmeldungen. Du findest hierher.',
    hint: 'Melde dich zehnmal an.',
    category: 'ausdauer',
    title: null,
  },
  anmeldung50: {
    id: 'anmeldung50',
    name: 'Fünfzigmal angemeldet',
    description: 'Fünfzig Anmeldungen. Das Lesezeichen sitzt.',
    hint: 'Melde dich fünfzigmal an.',
    category: 'ausdauer',
    title: null,
  },
  anmeldung100: {
    id: 'anmeldung100',
    name: 'Hundertmal angemeldet',
    description: 'Hundert Anmeldungen. Willkommen zurück. Schon wieder.',
    hint: 'Melde dich hundertmal an.',
    category: 'ausdauer',
    title: 'Stammgast',
  },
  vielbeschaeftigt: {
    id: 'vielbeschaeftigt',
    name: 'Vielbeschäftigt',
    description: 'Fünfzig protokollierte Handgriffe. Du benutzt das Ding wirklich.',
    hint: 'Hinterlasse fünfzig Einträge im Protokoll.',
    category: 'ausdauer',
    title: null,
  },
  /*
   * Abzeichen für Abzeichen – der Gipfel der Sinnlosigkeit und deshalb genau
   * richtig hier (Betreiber, 21.09.2026). Sie zählen den eigenen Bestand mit,
   * weshalb die Vergabe nach einem Treffer noch einmal nachfasst (siehe
   * `service.ts`): Sonst käme „Zehn Abzeichen" erst beim nächsten Vorgang an.
   */
  sammler10: {
    id: 'sammler10',
    name: 'Zehn Abzeichen',
    description: 'Zehn Abzeichen gesammelt. Dieses hier ist eines davon.',
    hint: 'Schalte zehn Abzeichen frei.',
    category: 'ausdauer',
    title: null,
  },
  sammler20: {
    id: 'sammler20',
    name: 'Zwanzig Abzeichen',
    description: 'Zwanzig Abzeichen. Es gibt ein Abzeichen dafür, Abzeichen zu haben.',
    hint: 'Schalte zwanzig Abzeichen frei.',
    category: 'ausdauer',
    title: null,
  },
  sammler30: {
    id: 'sammler30',
    name: 'Dreißig Abzeichen',
    description: 'Dreißig Abzeichen. Wir haben beide zu viel Zeit investiert.',
    hint: 'Schalte dreißig Abzeichen frei.',
    category: 'ausdauer',
    title: 'Sammelwut',
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
 *
 * Die Abstände wachsen nach oben: Die ersten Stufen kommen von allein, weil die
 * Platzierungs-Leiter geschenkt ist; die letzten verlangen, dass jemand die
 * Spielhalle wirklich leerspielt. Die höchste Stufe steht bewusst auf
 * `ACHIEVEMENT_IDS.length` und nicht auf einer festen Zahl – sie rückt mit
 * jedem neuen Abzeichen von allein nach.
 */
export const ACHIEVEMENT_LEVELS: readonly AchievementLevel[] = [
  { level: 1, required: 0, label: 'Neuling' },
  { level: 2, required: 2, label: 'Eingelebt' },
  { level: 3, required: 5, label: 'Angekommen' },
  { level: 4, required: 9, label: 'Kenner' },
  { level: 5, required: 14, label: 'Routiniert' },
  { level: 6, required: 20, label: 'Veteran' },
  { level: 7, required: 26, label: 'Urgestein' },
  { level: 8, required: 31, label: 'Legendär' },
  { level: 9, required: ACHIEVEMENT_IDS.length, label: 'Vollständig' },
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
