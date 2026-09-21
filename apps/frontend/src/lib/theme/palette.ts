/**
 * Die Themes der Oberfläche – **die einzige Quelle für jeden Farbwert**.
 *
 * Bis hierher standen die Farben als literale Hex-Werte in
 * `tailwind.config.ts`. Dort konnte es nur ein Aussehen geben: Ein Token wie
 * `canvas` löste zur Bauzeit auf genau eine Farbe auf, und die stand danach
 * fest in jeder erzeugten Klasse. Jetzt führt die Konfiguration nur noch auf
 * CSS-Variablen (`rgb(var(--c-canvas) / <alpha-value>)`), und die Werte dieser
 * Variablen kommen von hier – je Theme ein Satz.
 *
 * **Warum Hex und nicht gleich Kanäle.** Die Variablen tragen
 * `R G B`-Tripel, weil Tailwind seinen Alpha-Wert nur so anhängen kann
 * (`bg-canvas/75`). Geschrieben werden sie trotzdem als Hex: Das ist das
 * Format, in dem Farben besprochen, aus Entwürfen übernommen und in jedem
 * Werkzeug angezeigt werden. Die Umrechnung macht {@link kanaele} – einmal,
 * geprüft, statt zwanzigmal von Hand.
 *
 * **Was hier absichtlich fehlt.** Die drei Ampelpunkte der Konsole
 * (`terminal.*` in der Konfiguration) bleiben literal. Sie sind bewusst die
 * bekannten Fensterfarben und keine Statusfarben – sie sagen „hier ist ein
 * Terminal". Ein Theme, das sie umfärbt, nähme ihnen genau diese Aussage.
 *
 * Ein neues Theme ist ein weiterer Eintrag in {@link THEMES}. Mehr nicht:
 * Komponenten kennen nur Tokens, und `farbtokens.test.tsx` prüft **jedes**
 * Theme auf Lesbarkeit, bevor es jemand zu sehen bekommt.
 */

/**
 * Die Farbstellen eines Themes.
 *
 * Jeder Schlüssel wird zu einer CSS-Variablen (siehe {@link variablenName}).
 * Gelesen werden sie an zwei Stellen: von den Farbtokens in
 * `tailwind.config.ts` und – für das, was sich nicht als Utility-Klasse
 * schreiben lässt (Platzhalter, Scrollbalken, `accent-color`) – von
 * `app/globals.css`. Wer hier ein Feld ergänzt, muss es an einer der beiden
 * verwenden, sonst entsteht eine Variable, die niemand liest.
 */
export interface Palette {
  /** Seitenhintergrund. */
  readonly canvas: string;
  /**
   * Erhabene Flächen: Modals, Popover, Dropdowns.
   *
   * Die Fläche, die am weitesten **vom Grund weg** liegt – im dunklen Theme
   * also die hellste, im hellen die hellste ebenfalls (dort ist der Grund
   * leicht getönt und das Erhabene weiß). Für Text ist sie der Bezugspunkt,
   * an dem die Rampe gemessen wird.
   */
  readonly surface: string;
  readonly surfaceMuted: string;
  readonly surfaceDeep: string;
  /**
   * Oberer Stopp des Kartenverlaufs (`bg-card-gradient`).
   *
   * Liegt zwischen `surface` und `surfaceDeep` und war bis zur Umstellung
   * überhaupt kein Token, sondern ein literaler Wert im Verlauf.
   */
  readonly surfaceCard: string;
  /**
   * Grund der Live-Konsole.
   *
   * ⚠️ **Folgt der Polarität des Themes, auch wenn Terminals sonst dunkel
   * sind.** Die Konsole setzt ihre Ausgabe in die Tokens der Anwendung –
   * `ink.muted` für stdout, `danger` für stderr, `brand` für Eingaben
   * (`ConsoleTab.tsx`). Ein dunkler Kasten in einem hellen Theme bräuchte
   * dafür eine eigene, zweite Textrampe; ohne die stünde dunkler Text auf
   * dunklem Grund. Der Kasten hebt sich stattdessen wie bisher durch seinen
   * Abstand zur Karte ab, nur eben nach der anderen Seite.
   */
  readonly surfaceConsole: string;
  /** Haupttext. */
  readonly ink: string;
  readonly inkMuted: string;
  readonly inkSoft: string;
  readonly inkFaint: string;
  /** Inaktives – darf als Einziges unter 4,5:1 liegen. */
  readonly inkDisabled: string;
  /** Platzhalter in Eingabefeldern. */
  readonly placeholder: string;
  /** Markenfarbe: Primäraktion, aktive Navigation, Fokusring. */
  readonly brand: string;
  /** Hellere Marke – für Marken*text*, der 4,5:1 halten muss. */
  readonly brandBright: string;
  /** Zweite Markenfarbe: Verlauf und RAM-Kennzahlen. */
  readonly accent: string;
  readonly success: string;
  readonly warning: string;
  /** Zwischen Warnung und Gefahr („stoppt"). */
  readonly caution: string;
  readonly danger: string;
  /**
   * Grundfarbe aller Auflagen: Trennlinien (`line`) und dezente Füllflächen
   * (`fill`) sind nichts als diese Farbe mit wenigen Prozent Deckkraft.
   *
   * Auf dunklem Grund ist sie weiß, auf hellem müsste sie schwarz sein – **der
   * Grund, warum sie überhaupt eine Variable ist.** Stünde sie fest auf Weiß,
   * wäre jedes helle Theme von vornherein ausgeschlossen: Weiße Haarlinien auf
   * weißer Karte sind keine.
   */
  readonly overlay: string;
  /** Greifer des Scrollbalkens. */
  readonly scrollbar: string;
  /**
   * Der Pfeil im Auswahlfeld (`select`).
   *
   * Steckt als SVG in einer `url()`-Datenadresse, und **dorthinein setzt CSS
   * keine Variablen ein** – der Inhalt ist für den Browser ein eigenes
   * Dokument. Lange war das die eine Farbe, die kein Theme erreichte.
   *
   * Gelöst, indem nicht die Farbe in die Adresse wandert, sondern die fertige
   * Adresse in die Variable: {@link themesCss} baut je Theme eine eigene
   * (`--select-pfeil`), mit der Farbe bereits eingebacken. Diese Farbstelle
   * bekommt deshalb als einzige **kein** `--c-…` – sie wird nicht als Farbe
   * gelesen, sondern als fertiges Hintergrundbild.
   */
  readonly selectPfeil: string;
}

/** Ein wählbares Aussehen der Oberfläche. */
export interface Theme {
  /**
   * Kennung – steht im Cookie und als `data-theme` am `<html>`-Element.
   *
   * Nur Kleinbuchstaben, Ziffern und Bindestriche: Der Wert landet
   * unverändert in einem CSS-Attributselektor, der ohne Anführungszeichen
   * geschrieben wird (`:root[data-theme=schmiedefeuer]`). Alles andere wäre
   * dort kein gültiger Bezeichner. `themes.test.ts` hält die Regel fest.
   */
  readonly id: string;
  /** Name in der Auswahl. */
  readonly name: string;
  /** Ein Satz darunter – wonach es aussieht, nicht welche Farben es hat. */
  readonly beschreibung: string;
  /**
   * Ob die Oberfläche dunkel oder hell ist.
   *
   * Geht als `color-scheme` in den erzeugten Block. Daran hängt, in welcher
   * Farbe der Browser das zeichnet, was nicht uns gehört: Scrollbalken,
   * Datumswähler, Autovervollständigung.
   */
  readonly farbschema: 'dark' | 'light';
  /**
   * Wie kräftig die Schlagschatten fallen – 1 ist der bisherige Wert.
   *
   * **Keine Farbe, deshalb kein Palettenwert.** Schatten sind überall schwarz;
   * was sich zwischen hell und dunkel unterscheidet, ist allein, wie viel
   * davon man sieht. Auf dunklem Grund fällt ein Schatten kaum auf und darf
   * kräftig sein; auf hellem Grund wird aus demselben Wert ein dunkler Hof um
   * jedes Modal. Ein Faktor genügt: {@link themesCss} rechnet die drei
   * Deckkräfte daraus aus, damit im Stylesheet gewöhnliche Zahlen stehen und
   * kein `calc()` in einem Alphawert.
   */
  readonly schattenStaerke: number;
  /**
   * Die Schrift der Überschriften – `null` heißt: die des Betreibers.
   *
   * **Nur Titel, nie Lesetext.** Eine Schmuckschrift bei 13px ist nicht zu
   * lesen, und welche Schrift den Fließtext trägt, entscheidet der Betreiber
   * in der Administration (Arbeitspaket S-3). Ein Theme greift ihm da nicht
   * hinein; es legt eine zweite Schrift auf das, was ohnehin groß ist.
   *
   * Der Wert ist der **Familienname** aus dem Katalog der mitgelieferten
   * Schriften (`apps/backend/src/modules/fonts/bundled.ts`) – dort liegen die
   * Dateien, hier steht nur, wer welche trägt. Fehlt die Familie in der
   * Instanz oder hat der Betreiber sie ausgeblendet, entsteht keine
   * `@font-face`-Regel und die Überschrift fällt auf seine Schrift zurück.
   *
   * ⚠️ **Ohne Anführungszeichen geschrieben.** CSS erlaubt mehrteilige
   * Familiennamen als Folge von Bezeichnern (`Racing Sans One`), und das
   * erzeugte Stylesheet muss frei von `"` und `'` bleiben – siehe
   * {@link themesCss}. `themes.test.ts` hält die Schreibweise fest.
   */
  readonly anzeigeSchrift: string | null;
  readonly palette: Palette;
}

/** Kennung des Themes, das gilt, solange niemand etwas gewählt hat. */
export const STANDARD_THEME_ID = 'standard';

export const THEMES: readonly Theme[] = [
  {
    id: STANDARD_THEME_ID,
    name: 'Standard',
    beschreibung: 'Das gewohnte Panel: tiefes Blauschwarz, Violett und Türkis.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: null,
    /*
     * Wertgleich mit dem, was bis zur Umstellung in `tailwind.config.ts`
     * stand. Die Begründungen zu den einzelnen Stufen – warum `ink.faint`
     * der Boden ist, warum `fill` bei 4 % liegt – stehen weiterhin dort bei
     * den Tokens; hier stehen nur die Zahlen.
     */
    palette: {
      canvas: '#0a0b0f',
      surface: '#1a1c24',
      surfaceMuted: '#14161d',
      surfaceDeep: '#12141b',
      surfaceCard: '#161820',
      surfaceConsole: '#0c0e13',
      /*
       * Die Textrampe: vier Stufen, von denen zwei lange niemand
       * unterscheiden konnte.
       *
       * Das Anheben aus Review 2026-09-16 (Befund 12.7) hatte `soft` und
       * `faint` aneinandergeschoben – auf `surface` standen sie bei 5,43 und
       * 4,64, ein Schritt von 1,17, und `muted` darüber lag mit 1,22 kaum
       * besser. Nominell vier Textstufen, sichtbar drei: Ein Abschnittslabel
       * (`soft`) und ein Zeitstempel (`faint`) sahen gleich wichtig aus, und
       * die Oberfläche wirkte dadurch flach.
       *
       * ⚠️ **Aufgespreizt wird nach oben, nicht nach unten.** `faint` ist der
       * Boden und bleibt, wo er ist: Die hellste Fläche, gegen die Text
       * bestehen muss, ist `surface` (Grund der Popover), und dort hält
       * #7e8696 genau 4,64. Eine Stufe dunkler wäre unter 4,5. hafenmeisters
       * schöneres, tieferes Grau (#6b7283) liegt bei 3,53 und fällt durch AA –
       * es ist deshalb **nicht** übernehmbar.
       *
       * Die Rampe ist bewusst die Form (R, R+8, R+24) – ein durchgehender
       * Blaustich in drei Helligkeiten.
       */
      ink: '#e8ebf2',
      inkMuted: '#aab2c2',
      inkSoft: '#929aaa',
      inkFaint: '#7e8696',
      inkDisabled: '#4a505e',
      placeholder: '#5a6172',
      brand: '#7c5cff',
      brandBright: '#9b82ff',
      accent: '#22d3ee',
      success: '#3ddc84',
      warning: '#fbbf24',
      caution: '#fb923c',
      danger: '#ff6b6b',
      overlay: '#ffffff',
      scrollbar: '#272c38',
      selectPfeil: '#9aa2b2',
    },
  },
  {
    id: 'schmiedefeuer',
    name: 'Schmiedefeuer',
    beschreibung: 'Warmes Halbdunkel, Gold und Glut – Werkstatt statt Rechenzentrum.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Cinzel',
    /*
     * Der Gegenentwurf zum Standard: dieselbe Helligkeitsrampe, aber jede
     * Stufe warm statt kühl. Dass die Rampe dieselbe **Form** behält, ist
     * kein Zufall, sondern die Bedingung – die Abstände zwischen den
     * Textstufen tragen die Hierarchie der Oberfläche, und die darf ein Theme
     * nicht einebnen (`farbtokens.test.tsx`).
     *
     * `success` bleibt grün und `danger` rot. Ein Theme darf die Stimmung
     * ändern, nicht die Bedeutung: Wer einen abgestürzten Server sucht, sucht
     * nach Rot.
     */
    palette: {
      canvas: '#0c0907',
      surface: '#221b14',
      surfaceMuted: '#1a140f',
      surfaceDeep: '#16110c',
      surfaceCard: '#1c1610',
      surfaceConsole: '#0e0b08',
      ink: '#f7efe3',
      inkMuted: '#d6c3a6',
      inkSoft: '#b19b7e',
      inkFaint: '#988565',
      inkDisabled: '#5d4f3c',
      placeholder: '#6e5e46',
      /*
       * ⚠️ Die Marke ist **dunkler** als Warnung und Hinweis, nicht nur
       * anders gefärbt.
       *
       * In einem goldenen Theme liegen Marke, `warning` und `caution`
       * zwangsläufig im selben Farbton – die erste Fassung hatte die Marke bei
       * 36° und `caution` bei 26°, bei praktisch gleicher Helligkeit (Faktor
       * 1,05). Ein Primärknopf und ein „stoppt"-Abzeichen waren damit dieselbe
       * Farbe. Da der Farbton die Identität des Themes ist, trennt hier die
       * Helligkeit: tiefes Kupfer gegen blasses Gelb und helles Orange.
       * `themes.test.ts` rechnet beides nach.
       */
      brand: '#c47b16',
      brandBright: '#f0b84e',
      accent: '#ff9a4d',
      success: '#4fd48b',
      warning: '#f7d979',
      caution: '#ff9d5c',
      danger: '#ff7a68',
      overlay: '#ffffff',
      scrollbar: '#3a2e1f',
      selectPfeil: '#9c8a70',
    },
  },
  {
    id: 'neonnacht',
    name: 'Neonnacht',
    beschreibung: 'Violettes Dunkel, Magenta und Blitzblau – laut, schnell, gezeichnet.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Chewy',
    /*
     * Das lauteste der Themes. Die Marke steht bei 315°, also weit weg von
     * jeder Statusfarbe – in einem Theme, das ohnehin knallt, ist das die
     * Bedingung dafür, dass ein rotes Abzeichen noch als Warnung liest und
     * nicht als Dekoration.
     */
    palette: {
      canvas: '#0a0614',
      surface: '#1f1634',
      surfaceMuted: '#18102a',
      surfaceDeep: '#140d24',
      surfaceCard: '#1a1230',
      surfaceConsole: '#0c0718',
      ink: '#f5edff',
      inkMuted: '#cdbaec',
      inkSoft: '#a994d0',
      inkFaint: '#9280bd',
      inkDisabled: '#574a72',
      placeholder: '#67588a',
      brand: '#f45fd0',
      brandBright: '#ff8ce4',
      accent: '#4ee2ff',
      success: '#4ade80',
      warning: '#fbbf24',
      caution: '#fb923c',
      danger: '#ff6b6b',
      overlay: '#ffffff',
      scrollbar: '#362a52',
      selectPfeil: '#a08cc4',
    },
  },
  {
    id: 'kanzlei',
    name: 'Kanzlei',
    beschreibung: 'Anthrazit und Messing. Sagt wenig, und das in gutem Zwirn.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Playfair Display',
    /*
     * Der Gegenpol zu Neonnacht: neutrales Anthrazit ohne Farbstich, eine
     * einzige gedeckte Akzentfarbe. Auch hier ist das Messing bewusst dunkler
     * gehalten als Warnung und Hinweis – Messing und Gelb teilen den Farbton
     * fast auf den Grad.
     */
    palette: {
      canvas: '#0d0d0f',
      surface: '#212125',
      surfaceMuted: '#19191c',
      surfaceDeep: '#161618',
      surfaceCard: '#1c1c20',
      surfaceConsole: '#0f0f11',
      ink: '#f0f0f2',
      inkMuted: '#c6c6cc',
      inkSoft: '#a3a3ab',
      inkFaint: '#8b8b93',
      inkDisabled: '#55555c',
      placeholder: '#66666e',
      brand: '#a8831a',
      brandBright: '#e0bf5a',
      accent: '#8fb4d6',
      success: '#5cc98f',
      warning: '#f0d060',
      caution: '#f09c62',
      danger: '#eb7070',
      overlay: '#ffffff',
      scrollbar: '#33333a',
      selectPfeil: '#9a9aa2',
    },
  },
  {
    id: 'hyperraum',
    name: 'Hyperraum',
    beschreibung: 'Tiefes Marineblau, Azur und Eis – kalt, weit und sehr aufgeräumt.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Audiowide',
    /*
     * Kühl wie der Standard, aber ohne dessen Violett: Die Marke steht im
     * Azur (209°), der Grund ist deutlich blauer und tiefer. Damit bleiben die
     * beiden kalten Themes auch nebeneinander auseinanderzuhalten.
     */
    palette: {
      canvas: '#040814',
      surface: '#131d33',
      surfaceMuted: '#0e1628',
      surfaceDeep: '#0b1222',
      surfaceCard: '#101a2e',
      surfaceConsole: '#050a16',
      ink: '#e9f2ff',
      inkMuted: '#b8cce6',
      inkSoft: '#95accb',
      inkFaint: '#7e94b4',
      inkDisabled: '#46556e',
      placeholder: '#566885',
      brand: '#4aa8ff',
      brandBright: '#8ac8ff',
      accent: '#63f0e0',
      success: '#4ade80',
      warning: '#fbbf24',
      caution: '#fb923c',
      danger: '#ff6b6b',
      overlay: '#ffffff',
      scrollbar: '#2a3a55',
      selectPfeil: '#8ba2c0',
    },
  },
  {
    id: 'tageslicht',
    name: 'Tageslicht',
    beschreibung: 'Heller Grund, dunkle Schrift – dieselbe Oberfläche bei Tag.',
    farbschema: 'light',
    /*
     * Ein Faktor von 0,28 statt 1: Auf dunklem Grund fällt ein Schatten kaum
     * auf, auf hellem wird aus demselben Wert ein dunkler Hof um jedes Modal.
     */
    schattenStaerke: 0.28,
    anzeigeSchrift: null,
    /*
     * Das erste Theme, das die Polarität dreht – und damit der Nachweis, dass
     * die Umstellung auf Variablen nicht nur andere Farben, sondern ein
     * anderes Vorzeichen trägt.
     *
     * Drei Dinge kippen mit:
     *
     * 1. `overlay` wird schwarz. Trennlinien und Füllflächen sind nichts als
     *    diese Farbe mit wenigen Prozent – weiße Haarlinien auf weißer Karte
     *    wären keine.
     * 2. Text und Statusfarben werden **dunkel**. Ein Grün, das auf Schwarz
     *    leuchtet, hat auf Weiß keinen Kontrast; die Statusfarben liegen hier
     *    deshalb im tiefen Bereich. Grün bleibt Grün und Rot bleibt Rot – nur
     *    eben so, dass man sie lesen kann.
     * 3. Die Konsole wird hell. Sie setzt ihre Ausgabe in die Tokens der
     *    Anwendung; ein dunkler Kasten bräuchte eine zweite Textrampe.
     *
     * Nebenbei ist es das einzige Theme, in dem der Primärknopf sauber
     * funktioniert: Marke und Akzent müssen hier **beide** dunkel sein – als
     * Text auf hellem Grund –, und genau das braucht auch die weiße Schrift,
     * die auf dem Verlauf steht.
     */
    palette: {
      canvas: '#f2f4f7',
      surface: '#ffffff',
      surfaceMuted: '#e9ecf1',
      surfaceDeep: '#e2e6ed',
      surfaceCard: '#fafbfc',
      surfaceConsole: '#eceff4',
      ink: '#1b2028',
      inkMuted: '#363e4a',
      inkSoft: '#4b5462',
      inkFaint: '#5d6673',
      inkDisabled: '#949cab',
      placeholder: '#7b8494',
      brand: '#4338ca',
      brandBright: '#372ca8',
      accent: '#0e6f78',
      success: '#146c38',
      warning: '#85590a',
      caution: '#9a4a12',
      danger: '#b3261e',
      overlay: '#000000',
      scrollbar: '#c3c9d4',
      selectPfeil: '#5f6875',
    },
  },
  {
    id: 'heldenrot',
    name: 'Heldenrot',
    beschreibung: 'Stahlblaues Dunkel, Signalrot und ein Blitz Blau – großes Kino.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Bangers',
    /*
     * Rot als Marke geht nur, weil es **tiefer** liegt als `danger`. Beide
     * sind rot; auseinander hält sie die Helligkeit, nicht der Farbton –
     * dieselbe Mechanik, die in Schmiedefeuer das Kupfer vom Gelb trennt.
     */
    palette: {
      canvas: '#0b0d12',
      surface: '#1c2029',
      surfaceMuted: '#151922',
      surfaceDeep: '#12161e',
      surfaceCard: '#171b24',
      surfaceConsole: '#0d0f15',
      ink: '#eef1f6',
      inkMuted: '#bcc5d2',
      inkSoft: '#9aa4b4',
      inkFaint: '#848ea0',
      inkDisabled: '#4e5666',
      placeholder: '#5e6675',
      brand: '#d1332e',
      brandBright: '#f4706a',
      accent: '#63a0ff',
      success: '#4ade80',
      warning: '#fbbf24',
      caution: '#fb923c',
      danger: '#ff6b6b',
      overlay: '#ffffff',
      scrollbar: '#2a303c',
      selectPfeil: '#9aa4b5',
    },
  },
  {
    id: 'kampfgeist',
    name: 'Kampfgeist',
    beschreibung: 'Warmes Schwarz, Kobalt und Orange – aufgeladen und laut.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Russo One',
    /*
     * Das Orange ist der Akzent, nicht die Marke – als Marke läge es einen
     * Grad neben `caution`, und ein Primärknopf sähe aus wie ein
     * „stoppt"-Abzeichen. Als Akzent trägt es RAM-Kennzahlen und den
     * Verlauf; dort steht es nie neben einem Status.
     */
    palette: {
      canvas: '#0c0b0a',
      surface: '#21201d',
      surfaceMuted: '#191816',
      surfaceDeep: '#151413',
      surfaceCard: '#1b1a18',
      surfaceConsole: '#0e0d0c',
      ink: '#f6f2ec',
      inkMuted: '#cdc6bb',
      inkSoft: '#a8a196',
      inkFaint: '#8e877c',
      inkDisabled: '#575249',
      placeholder: '#696358',
      brand: '#3b6bf0',
      brandBright: '#87abff',
      accent: '#ff9426',
      success: '#4ade80',
      warning: '#fbbf24',
      caution: '#fb923c',
      danger: '#ff6b6b',
      overlay: '#ffffff',
      scrollbar: '#35322d',
      selectPfeil: '#a29b90',
    },
  },
  {
    id: 'boxenstopp',
    name: 'Boxenstopp',
    beschreibung: 'Asphalt in der Dämmerung, Neon-Türkis und Abendrot.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Racing Sans One',
    palette: {
      canvas: '#0b0a0e',
      surface: '#1e1d24',
      surfaceMuted: '#17161c',
      surfaceDeep: '#131218',
      surfaceCard: '#19181f',
      surfaceConsole: '#0d0c10',
      ink: '#f0f2f4',
      inkMuted: '#bfc4ca',
      inkSoft: '#9ba1a9',
      inkFaint: '#858b94',
      inkDisabled: '#4f545c',
      placeholder: '#5f656d',
      brand: '#17b3a3',
      brandBright: '#4fd9c9',
      accent: '#ff7a9c',
      success: '#4ade80',
      warning: '#fbbf24',
      caution: '#fb923c',
      danger: '#ff6b6b',
      overlay: '#ffffff',
      scrollbar: '#2d2c35',
      selectPfeil: '#9ba1aa',
    },
  },
  {
    id: 'bambushain',
    name: 'Bambushain',
    beschreibung: 'Tuschedunkel, Bambusgrün und ein Schimmer Gold – ruhig und wach.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Cormorant Garamond',
    /*
     * ⚠️ Das Grün der Marke liegt bewusst **weit** unterhalb von `success`:
     * Bambus ist gelbgrün und gedeckt, das „läuft"-Grün leuchtet. Ohne diesen
     * Abstand sähe ein Primärknopf aus wie ein laufender Server.
     */
    palette: {
      canvas: '#090b09',
      surface: '#1b201b',
      surfaceMuted: '#151915',
      surfaceDeep: '#121612',
      surfaceCard: '#171b17',
      surfaceConsole: '#0b0d0b',
      ink: '#eff2ec',
      inkMuted: '#c0c8ba',
      inkSoft: '#9ca699',
      inkFaint: '#869080',
      inkDisabled: '#4f574c',
      placeholder: '#5f6759',
      brand: '#6a9e24',
      brandBright: '#a3cf5c',
      accent: '#e0a63c',
      success: '#4ade80',
      warning: '#fbbf24',
      caution: '#fb923c',
      danger: '#ff6b6b',
      overlay: '#ffffff',
      scrollbar: '#2c322a',
      selectPfeil: '#99a394',
    },
  },
  {
    id: 'drachenfels',
    name: 'Drachenfels',
    beschreibung: 'Nasser Stein, Nordsee-Blau und Glut aus dem Dunkeln.',
    farbschema: 'dark',
    schattenStaerke: 1,
    anzeigeSchrift: 'Metamorphous',
    /*
     * Im Farbton nah an Hyperraum, in der Wirkung weit weg: Der Grund ist
     * Stein statt Weltraum – entsättigtes Grau statt tiefem Marineblau –,
     * und der Akzent ist Glut statt Eis.
     */
    palette: {
      canvas: '#0b0c0d',
      surface: '#20242a',
      surfaceMuted: '#191c21',
      surfaceDeep: '#15181c',
      surfaceCard: '#1b1f24',
      surfaceConsole: '#0d0e10',
      ink: '#edf1f3',
      inkMuted: '#bcc4cb',
      inkSoft: '#99a2ab',
      inkFaint: '#838d97',
      inkDisabled: '#4d555e',
      placeholder: '#5d656e',
      brand: '#4d94b8',
      brandBright: '#8ec4e0',
      accent: '#e86e45',
      success: '#4ade80',
      warning: '#fbbf24',
      caution: '#fb923c',
      danger: '#ff6b6b',
      overlay: '#ffffff',
      scrollbar: '#2b3037',
      selectPfeil: '#99a2ac',
    },
  },
];

/** Das Standard-Theme als Objekt – es ist immer vorhanden. */
export const STANDARD_THEME: Theme = themeMitId(STANDARD_THEME_ID);

function themeMitId(id: string): Theme {
  const gefunden = THEMES.find((thema) => thema.id === id);
  if (gefunden === undefined) throw new Error(`Unbekanntes Theme: ${id}`);
  return gefunden;
}

/**
 * Das Theme zu einer Kennung – **niemals `undefined`**.
 *
 * Ein unbekannter Wert ergibt den Standard, statt einen Fehler zu werfen. Die
 * Kennung kommt aus einem Cookie, also von außen: Sie ist veraltet, sobald ein
 * Theme umbenannt oder entfernt wird, und frei erfunden, sobald jemand das
 * Cookie von Hand setzt. Beides darf die Seite nicht zerlegen – es darf nur
 * dazu führen, dass sie gewöhnlich aussieht.
 */
export function themeFuerId(id: string | undefined | null): Theme {
  if (id === undefined || id === null) return STANDARD_THEME;
  return THEMES.find((thema) => thema.id === id) ?? STANDARD_THEME;
}

/**
 * Hex nach `R G B` – die Schreibweise, die Tailwinds Alpha-Wert verträgt.
 *
 * `rgb(var(--c-canvas) / <alpha-value>)` setzt voraus, dass die Variable die
 * drei Kanäle **ohne** Funktionsklammer enthält. Stünde dort `#0a0b0f` oder
 * `rgb(10,11,15)`, wäre die zusammengesetzte Angabe ungültig und die Farbe
 * fiele ersatzlos aus.
 */
export function kanaele(hex: string): string {
  const treffer = /^#([0-9a-f]{6})$/i.exec(hex);
  if (treffer === null) throw new Error(`Kein sechsstelliger Hex-Wert: ${hex}`);

  const ziffern = treffer[1] ?? '';
  return [0, 2, 4].map((stelle) => parseInt(ziffern.slice(stelle, stelle + 2), 16)).join(' ');
}

/**
 * Name der CSS-Variablen zu einer Farbstelle: `surfaceMuted` → `--c-surface-muted`.
 *
 * Abgeleitet statt aufgelistet, damit eine neue Farbstelle nur an einer Stelle
 * entsteht – in {@link Palette}. Eine zweite Liste hier wäre die erste, die
 * jemand zu pflegen vergisst.
 */
export function variablenName(schluessel: string): string {
  return `--c-${schluessel.replace(/[A-Z]/g, (buchstabe) => `-${buchstabe.toLowerCase()}`)}`;
}

/**
 * Die Deckkraft der drei Schlagschatten im dunklen Theme – der Bezugspunkt.
 *
 * `schattenStaerke` eines Themes ist der Faktor darauf. Die Werte sind
 * dieselben, die vorher fest in `tailwind.config.ts` standen.
 */
const SCHATTEN_BASIS = { glow: 0.3, panel: 0.5, modal: 0.55 } as const;

/** Vier Nachkommastellen genügen – und `0.55 * 0.28` soll nicht als `0.15400000000000003` im Stylesheet landen. */
function alphaWert(zahl: number): string {
  return String(Math.round(zahl * 10000) / 10000);
}

/**
 * Das Hintergrundbild für den Pfeil im Auswahlfeld, mit eingebackener Farbe.
 *
 * ⚠️ **Vollständig prozentkodiert, und das ist keine Schönheitsfrage.** Roh
 * enthielte die Adresse `<`, `>` und `"` – Zeichen, die beim Einbetten in ein
 * `<style>` maskiert werden könnten und die Regel damit still zerstören
 * (siehe {@link themesCss}). `encodeURIComponent` lässt nur Buchstaben,
 * Ziffern, `%`, `.` und `-` übrig; Klammern kommen in diesem SVG nicht vor,
 * weshalb das `url()` ohne Anführungszeichen auskommt.
 */
function selectPfeilAdresse(farbe: string): string {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8">` +
    `<path d="M1 2l3 3 3-3" stroke="${farbe}" fill="none" stroke-width="1.4"/></svg>`;

  return `url(data:image/svg+xml,${encodeURIComponent(svg)})`;
}

function block(selektor: string, thema: Theme): string {
  const zeilen = Object.entries(thema.palette)
    // `selectPfeil` wird nicht als Farbe gelesen, sondern steckt fertig im
    // Hintergrundbild darunter.
    .filter(([schluessel]) => schluessel !== 'selectPfeil')
    .map(([schluessel, wert]) => `${variablenName(schluessel)}:${kanaele(wert)}`);

  const schatten = Object.entries(SCHATTEN_BASIS).map(
    ([name, basis]) => `--schatten-${name}:${alphaWert(basis * thema.schattenStaerke)}`,
  );

  /*
   * Die Anzeigeschrift nur, wenn das Theme eine nennt. Wer keine hat, setzt
   * die Variable gar nicht – und das Token in `tailwind.config.ts` fällt über
   * seinen eigenen Vorgabewert auf die Schrift des Betreibers zurück. Ein
   * leeres `--palantir-font-display:` täte das **nicht**: Eine gesetzte, aber
   * leere Variable ist ein Wert, kein fehlender, und `var(x, ersatz)` greift
   * dann nicht.
   */
  const schrift =
    thema.anzeigeSchrift === null ? [] : [`--palantir-font-display:${thema.anzeigeSchrift}`];

  return [
    `${selektor}{color-scheme:${thema.farbschema}`,
    ...zeilen,
    ...schatten,
    ...schrift,
    `--select-pfeil:${selectPfeilAdresse(thema.palette.selectPfeil)}}`,
  ].join(';');
}

/**
 * Die Variablensätze **aller** Themes als ein Stylesheet.
 *
 * Kommt als `<style>` ins Wurzel-Layout (`app/layout.tsx`). Drei Entscheidungen
 * stecken darin:
 *
 * **Alle Themes, nicht nur das gewählte.** Damit ist das Umschalten ein
 * geändertes Attribut am `<html>`-Element und sonst nichts – kein Neuladen,
 * keine zweite Anfrage, kein Zwischenzustand. Der Preis sind ein paar hundert
 * Byte je Theme im Dokument.
 *
 * **Der Standard steht auf `:root`, die übrigen auf `:root[data-theme=…]`.**
 * So gilt der Standard auch dann, wenn gar kein Attribut gesetzt ist. Und der
 * doppelte Selektor der anderen ist stärker als jedes einfache `:root` –
 * sonst entschiede die Reihenfolge der Stylesheets, in welcher die Variablen
 * am Ende gewinnen, und die ist zwischen diesem `<style>` und dem von Next
 * eingehängten `globals.css` nicht zugesichert.
 *
 * **Der Selektor kommt ohne Anführungszeichen aus.** React setzt den Inhalt
 * eines `<style>`-Elements als Textknoten; ob dabei ein `"` unbeschadet
 * durchkommt, ist eine Eigenschaft der Bibliothek und keine, auf die dieses
 * Stylesheet angewiesen sein sollte. Die Kennungen sind deshalb auf gültige
 * CSS-Bezeichner beschränkt (siehe {@link Theme.id}).
 */
export function themesCss(): string {
  return THEMES.map((thema) =>
    block(thema.id === STANDARD_THEME_ID ? ':root' : `:root[data-theme=${thema.id}]`, thema),
  ).join('\n');
}
