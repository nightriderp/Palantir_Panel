/**
 * Der Fragenkatalog des Abschlussquiz – der ganze Scherz in Datenform.
 *
 * Das Tutorial verspricht **drei** Fragen. Wer sie beantwortet, bekommt nicht
 * die Urkunde, sondern eine Seitenzahl: „Seite 1 von 43". Dahinter liegt
 * dieser Katalog, und das ist die Pointe – ein Prüfungsbogen, der nicht
 * aufhört. Echtes Wissen, unnützes Wissen, Mittelerde, Dragon Ball, Filme,
 * Serien, Anime, Spiele. Breit gestreut, damit jeder irgendwo glänzt und
 * überall sonst untergeht.
 *
 * **Warum hier und nicht in der Datenbank:** Der Katalog ist für jedes Konto
 * derselbe, ändert sich nur, wenn jemand diese Datei anfasst, und es wird kein
 * Ergebnis gespeichert. Eine Tabelle dafür hieße Vertragsfeld, Migration,
 * Route, Seed, Ladezustand und Fehlerfall – Apparat für Text. Der
 * Erfolge-Katalog (`packages/contracts/src/achievements.ts`) steht aus
 * demselben Grund im Code; er liegt nur deshalb in `contracts`, weil das
 * Backend ihn braucht. Dieser hier bleibt im Frontend, und weil Next je Route
 * bündelt, lädt ihn nur, wer `/tutorial` öffnet.
 *
 * **Eine Rückmeldung je Frage, nicht je Antwort.** Vier Spottzeilen pro Frage
 * wären bei 120 Fragen fast 500 Zeilen, die niemand zweimal liest. Es gibt
 * deshalb ein `echo` je Frage – die Pointe oder der Fun Fact – und die
 * Reaktion auf richtig/falsch kommt wie überall im Tutorial aus einem Zähler
 * (`spott.ts`), nicht aus dem Katalog.
 *
 * ⚠️ **Die richtige Antwort steht nicht immer an derselben Stelle.** Wer eine
 * Frage ergänzt, würfelt `richtig` bitte mit; ein Test hält die Verteilung
 * nach.
 */

export interface KatalogFrage {
  key: string;
  frage: string;
  antworten: readonly string[];
  /** Platz der richtigen Antwort in `antworten`. */
  richtig: number;
  /** Eine Zeile nach dem Antworten – Pointe, Fun Fact oder Seitenhieb. */
  echo: string;
}

/** Themengebiete, rein für die Überschrift über der Frage. */
export const KATALOG_GEBIETE = {
  panel: 'Panel-Wissen',
  wissen: 'Allgemeinbildung',
  unnuetz: 'Unnützes Wissen',
  mittelerde: 'Mittelerde',
  dragonball: 'Dragon Ball',
  film: 'Film',
  serie: 'Serie',
  anime: 'Anime',
  spiel: 'Spiele',
} as const;

export type KatalogGebiet = keyof typeof KATALOG_GEBIETE;

export interface KatalogAbschnitt {
  gebiet: KatalogGebiet;
  fragen: readonly KatalogFrage[];
}

/**
 * Die drei Fragen, die das Tutorial ankündigt – und die einzigen, die etwas
 * mit dem Panel zu tun haben. Sie stehen bewusst vorn: Wer nach ihnen aufhört,
 * hat trotzdem das Richtige gelernt.
 */
const PANEL: readonly KatalogFrage[] = [
  {
    key: 'p1',
    frage: 'Dein Server ist offline. Was tust du zuerst?',
    antworten: [
      'Auf „Starten" drücken.',
      'In die Gruppe schreiben, dass das Panel kaputt ist.',
      'Vorsichtshalber einen zweiten Server anlegen.',
    ],
    richtig: 0,
    echo: 'Der Knopf ist grün, beschriftet und war die ganze Zeit da.',
  },
  {
    key: 'p2',
    frage: 'Wofür ist „Meine Backups" da?',
    antworten: [
      'Zum Anschauen. Benutzt werden sie nie.',
      'Für den Moment, in dem jemand etwas sprengt.',
      'Sicherungen anlegen, herunterladen und wiederherstellen.',
    ],
    richtig: 2,
    echo: 'Und jetzt leg bitte wirklich eine an. Nicht gleich. Jetzt.',
  },
  {
    key: 'p3',
    frage: 'Wer entscheidet, welche Knöpfe du im Panel überhaupt siehst?',
    antworten: ['Der Zufall.', 'Deine Berechtigungen.', 'Der Admin, wenn er gute Laune hat.'],
    richtig: 1,
    echo: 'Der Admin vergibt die Rolle. Die gute Laune ist optional und selten.',
  },
];

/** Echtes Wissen. Das, was man in der Schule hatte und seitdem verdrängt. */
const WISSEN: readonly KatalogFrage[] = [
  {
    key: 'w01',
    frage: 'Wie heißt die Hauptstadt von Australien?',
    antworten: ['Sydney', 'Melbourne', 'Canberra', 'Brisbane'],
    richtig: 2,
    echo: 'Sydney sagen alle. Canberra ist die Antwort. Genau darum steht sie hier.',
  },
  {
    key: 'w02',
    frage: 'Welches chemische Symbol hat Gold?',
    antworten: ['Go', 'Au', 'Ag', 'Gd'],
    richtig: 1,
    echo: 'Von „aurum". Ag wäre Silber – daran scheitern die meisten.',
  },
  {
    key: 'w03',
    frage: 'Wie viele Knochen hat ein erwachsener Mensch ungefähr?',
    antworten: ['106', '206', '306', '156'],
    richtig: 1,
    echo: 'Als Baby waren es über 270. Einige wachsen zusammen.',
  },
  {
    key: 'w04',
    frage: 'Welcher Planet ist der Sonne am nächsten?',
    antworten: ['Venus', 'Merkur', 'Mars', 'Erde'],
    richtig: 1,
    echo: 'Und trotzdem ist Venus der heißere Planet. Danke, Treibhauseffekt.',
  },
  {
    key: 'w05',
    frage: 'Wie viele Bit hat ein Byte?',
    antworten: ['4', '8', '16', '32'],
    richtig: 1,
    echo: 'Acht. Wer hier falsch lag, betreibt gerade einen Gameserver.',
  },
  {
    key: 'w06',
    frage: 'Wer schrieb „Faust"?',
    antworten: ['Schiller', 'Goethe', 'Lessing', 'Heine'],
    richtig: 1,
    echo: 'Goethe. Und er hat über 60 Jahre daran gesessen – du klickst seit vier Minuten.',
  },
  {
    key: 'w07',
    frage: 'Durch welche Hauptstadt fließt die Donau?',
    antworten: ['Prag', 'Wien', 'Warschau', 'Bern'],
    richtig: 1,
    echo: 'Wien, Bratislava, Budapest und Belgrad – vier Hauptstädte an einem Fluss.',
  },
  {
    key: 'w08',
    frage: 'Wie viele Sekunden hat ein Tag?',
    antworten: ['3.600', '86.400', '1.440', '604.800'],
    richtig: 1,
    echo: '86.400. Von denen hast du heute schon einige hier gelassen.',
  },
  {
    key: 'w09',
    frage: 'Was misst ein Barometer?',
    antworten: ['Luftdruck', 'Temperatur', 'Luftfeuchtigkeit', 'Windgeschwindigkeit'],
    richtig: 0,
    echo: 'Luftdruck. Das Ding mit der Feuchtigkeit heißt Hygrometer.',
  },
  {
    key: 'w10',
    frage: 'In welchem Jahr fiel die Berliner Mauer?',
    antworten: ['1987', '1989', '1991', '1985'],
    richtig: 1,
    echo: '9. November 1989. Wegen einer missverstandenen Pressekonferenz, nebenbei.',
  },
  {
    key: 'w11',
    frage: 'Welches Element hat die Ordnungszahl 1?',
    antworten: ['Helium', 'Sauerstoff', 'Wasserstoff', 'Kohlenstoff'],
    richtig: 2,
    echo: 'Wasserstoff. Etwa 90 Prozent aller Atome im Universum.',
  },
  {
    key: 'w12',
    frage: 'Wie viele Zeitzonen hat Russland?',
    antworten: ['5', '8', '11', '14'],
    richtig: 2,
    echo: 'Elf. Ein Land, in dem man beim Frühstück über den Abend telefoniert.',
  },
  {
    key: 'w13',
    frage: 'Welches Landtier ist das schnellste?',
    antworten: ['Gepard', 'Antilope', 'Strauß', 'Pferd'],
    richtig: 0,
    echo: 'Bis etwa 100 km/h – aber nur für ein paar hundert Meter.',
  },
  {
    key: 'w14',
    frage: 'Wie viel ist die Quadratwurzel aus 144?',
    antworten: ['14', '12', '16', '11'],
    richtig: 1,
    echo: 'Zwölf. Wir mussten es auch kurz nachrechnen.',
  },
  {
    key: 'w15',
    frage: 'Wofür steht die Abkürzung „HTTP"?',
    antworten: [
      'High Transfer Text Protocol',
      'Hypertext Transfer Protocol',
      'Hyper Terminal Transport Path',
      'Home Text Transfer Program',
    ],
    richtig: 1,
    echo: 'Das „S" in HTTPS steht übrigens für „Secure", nicht für „Super".',
  },
  {
    key: 'w16',
    frage: 'Wie viele Spieler einer Fußballmannschaft stehen gleichzeitig auf dem Feld?',
    antworten: ['9', '10', '11', '12'],
    richtig: 2,
    echo: 'Elf. Zwölf wäre der Fan, und der zählt nur im Gesang.',
  },
  {
    key: 'w17',
    frage: 'Welcher ist der höchste Berg der Erde über dem Meeresspiegel?',
    antworten: ['K2', 'Mount Everest', 'Kilimandscharo', 'Mont Blanc'],
    richtig: 1,
    echo: 'Vom Fuß aus gemessen gewinnt allerdings der Mauna Kea auf Hawaii.',
  },
  {
    key: 'w18',
    frage: 'Wie heißt die Wissenschaft von den Erdbeben?',
    antworten: ['Geologie', 'Seismologie', 'Vulkanologie', 'Meteorologie'],
    richtig: 1,
    echo: 'Seismologie. Von „seismós", der Erschütterung.',
  },
  {
    key: 'w19',
    frage: 'Wie viele Herzkammern hat ein menschliches Herz?',
    antworten: ['Zwei', 'Vier', 'Drei', 'Eine'],
    richtig: 1,
    echo: 'Zwei Vorhöfe, zwei Kammern. Vier Räume, keine Küche.',
  },
  {
    key: 'w20',
    frage: 'Welche Sprache hat weltweit die meisten Muttersprachler?',
    antworten: ['Englisch', 'Spanisch', 'Mandarin-Chinesisch', 'Hindi'],
    richtig: 2,
    echo: 'Mandarin. Englisch gewinnt erst, wenn man Zweitsprachen mitzählt.',
  },
];

/** Unnützes Wissen. Nichts davon hilft dir je. Genau deshalb steht es hier. */
const UNNUETZ: readonly KatalogFrage[] = [
  {
    key: 'u01',
    frage: 'Wie viele Herzen hat ein Oktopus?',
    antworten: ['Eins', 'Zwei', 'Drei', 'Acht'],
    richtig: 2,
    echo: 'Drei. Zwei für die Kiemen, eins für den Rest – und beim Schwimmen setzt eines aus.',
  },
  {
    key: 'u02',
    frage: 'Welche Farbe hat das Blut eines Oktopus?',
    antworten: ['Blau', 'Rot', 'Grün', 'Farblos'],
    richtig: 0,
    echo: 'Blau, wegen Kupfer statt Eisen im Blutfarbstoff.',
  },
  {
    key: 'u03',
    frage: 'Was ist eine Banane botanisch gesehen?',
    antworten: ['Eine Nuss', 'Eine Beere', 'Ein Kernobst', 'Ein Gemüse'],
    richtig: 1,
    echo: 'Eine Beere. Die Erdbeere dagegen ist keine. Die Botanik trollt seit Jahrhunderten.',
  },
  {
    key: 'u04',
    frage: 'Wie lange dauerte der kürzeste Krieg der Geschichte?',
    antworten: ['Drei Tage', 'Rund 40 Minuten', 'Sechs Stunden', 'Eine Woche'],
    richtig: 1,
    echo: 'Britisch-Sansibarischer Krieg, 1896. Kürzer als dieses Quiz.',
  },
  {
    key: 'u05',
    frage: 'Welche Form hat der Kot eines Wombats?',
    antworten: ['Rund', 'Würfelförmig', 'Spiralig', 'Flach'],
    richtig: 1,
    echo: 'Würfel. Damit er nicht wegrollt – Wombats markieren gern auf Steinen.',
  },
  {
    key: 'u06',
    frage: 'Warum sind Flamingos rosa?',
    antworten: [
      'Wegen ihrer Nahrung',
      'Wegen der Sonne',
      'Das ist ihre Federfarbe von Geburt an',
      'Wegen des Salzwassers',
    ],
    richtig: 0,
    echo: 'Krebstiere und Algen. Ohne die richtige Kost werden sie weiß.',
  },
  {
    key: 'u07',
    frage: 'Welches Säugetier kann nicht springen?',
    antworten: ['Nilpferd', 'Elefant', 'Nashorn', 'Faultier'],
    richtig: 1,
    echo: 'Der Elefant. Zu schwer, zu viel Knochen, zu wenig Interesse.',
  },
  {
    key: 'u08',
    frage: 'Was passiert mit dem Eiffelturm im Sommer?',
    antworten: [
      'Er wird bis zu 15 cm größer',
      'Er schrumpft leicht',
      'Er verändert sich nicht',
      'Er neigt sich nach Westen',
    ],
    richtig: 0,
    echo: 'Eisen dehnt sich bei Wärme aus. Der Turm wächst jeden Sommer ein Stück.',
  },
  {
    key: 'u09',
    frage: 'Wie hieß der erste Hund im Weltall?',
    antworten: ['Belka', 'Strelka', 'Laika', 'Bello'],
    richtig: 2,
    echo: 'Laika, 1957, an Bord von Sputnik 2. Die traurigste Frage dieses Katalogs.',
  },
  {
    key: 'u10',
    frage: 'Ein Tag auf der Venus ist …',
    antworten: [
      'kürzer als eine Stunde',
      'genauso lang wie auf der Erde',
      'länger als ein Venus-Jahr',
      'exakt 24 Stunden',
    ],
    richtig: 2,
    echo: 'Sie dreht sich langsamer, als sie die Sonne umkreist. Und das rückwärts.',
  },
  {
    key: 'u11',
    frage: 'Verdirbt Honig?',
    antworten: [
      'Nach etwa zwei Jahren',
      'Praktisch nie',
      'Nur ungekühlt',
      'Nach einem Jahr zuverlässig',
    ],
    richtig: 1,
    echo: 'In ägyptischen Gräbern wurde essbarer Honig gefunden. Nach 3.000 Jahren.',
  },
  {
    key: 'u12',
    frage: 'Was ist eine Erdnuss botanisch?',
    antworten: ['Eine Nuss', 'Eine Hülsenfrucht', 'Ein Samenkorn', 'Eine Beere'],
    richtig: 1,
    echo: 'Verwandt mit Erbse und Bohne. Der Name ist glatt gelogen.',
  },
  {
    key: 'u13',
    frage: 'Wie viele mögliche Stellungen hat ein Zauberwürfel ungefähr?',
    antworten: ['43 Milliarden', '43 Billionen', '43 Trillionen', '43 Millionen'],
    richtig: 2,
    echo: 'Rund 43 Trillionen – und trotzdem geht jede in höchstens 20 Zügen zu lösen.',
  },
  {
    key: 'u14',
    frage: 'Hat ein Tausendfüßler tausend Beine?',
    antworten: [
      'Ja, immer genau 1.000',
      'Nein, meist deutlich weniger',
      'Ja, aber nur ausgewachsen',
      'Nein, immer mehr',
    ],
    richtig: 1,
    echo: 'Die meisten kommen auf ein paar Dutzend bis ein paar hundert. Der Name übertreibt.',
  },
  {
    key: 'u15',
    frage: 'Welche Farbe hat der Sonnenuntergang auf dem Mars?',
    antworten: ['Rot', 'Blau', 'Grün', 'Violett'],
    richtig: 1,
    echo: 'Blau. Genau andersherum als bei uns – der Staub streut das Licht anders.',
  },
  {
    key: 'u16',
    frage: 'Wie viele Nasenlöcher hat ein Delfin?',
    antworten: ['Zwei', 'Eines', 'Vier', 'Keines'],
    richtig: 1,
    echo: 'Ein Blasloch. Und atmen muss er bewusst – Schlaf geht nur mit einer Hirnhälfte.',
  },
  {
    key: 'u17',
    frage: 'Was ist das härteste natürliche Material?',
    antworten: ['Quarz', 'Stahl', 'Diamant', 'Titan'],
    richtig: 2,
    echo: 'Diamant. Stahl ist nicht mal natürlich – aber das fällt selten auf.',
  },
  {
    key: 'u18',
    frage: 'Wie viele Geschmacksrichtungen unterscheidet die Zunge klassisch?',
    antworten: ['Vier', 'Fünf', 'Sechs', 'Drei'],
    richtig: 1,
    echo: 'Süß, sauer, salzig, bitter – und umami, das erst 1908 dazukam.',
  },
  {
    key: 'u19',
    frage: 'Was ist ein „Murmeltiertag" im übertragenen Sinn?',
    antworten: [
      'Ein besonders langer Tag',
      'Ein Tag, der sich endlos wiederholt',
      'Ein Feiertag im Februar',
      'Ein verschlafener Morgen',
    ],
    richtig: 1,
    echo: 'Nach dem Film. Ungefähr das Gefühl, das dieses Quiz gleich auslösen wird.',
  },
  {
    key: 'u20',
    frage: 'Wie viele Sterne zeigt die Flagge der Europäischen Union?',
    antworten: ['12', '15', '27', 'So viele wie Mitgliedstaaten'],
    richtig: 0,
    echo: 'Immer zwölf – die Zahl steht für Vollständigkeit, nicht für Mitglieder.',
  },
];

/** Mittelerde. Für die, die das Buch gelesen haben, und für die, die es behaupten. */
const MITTELERDE: readonly KatalogFrage[] = [
  {
    key: 'm01',
    frage: 'Wie heißt Frodos Schwert?',
    antworten: ['Andúril', 'Stich', 'Glamdring', 'Narsil'],
    richtig: 1,
    echo: 'Stich. Es leuchtet blau, wenn Orks in der Nähe sind – ein Frühwarnsystem mit Griff.',
  },
  {
    key: 'm02',
    frage: 'Wie heißt Gandalfs Pferd?',
    antworten: ['Schattenfell', 'Brego', 'Hasufel', 'Felaróf'],
    richtig: 0,
    echo: 'Schattenfell, der Fürst aller Rosse. Verträgt keinen Sattel und keine Widerrede.',
  },
  {
    key: 'm03',
    frage: 'Wie viele Ringe erhielten die Menschen?',
    antworten: ['Drei', 'Sieben', 'Neun', 'Einer'],
    richtig: 2,
    echo: 'Neun – und alle neun endeten als Nazgûl. Kein gutes Geschäft.',
  },
  {
    key: 'm04',
    frage: 'Wie viele Ringe bekamen die Zwerge?',
    antworten: ['Sieben', 'Drei', 'Neun', 'Zwölf'],
    richtig: 0,
    echo: 'Sieben. Die Zwerge wurden davon nicht unsichtbar, nur außerordentlich geizig.',
  },
  {
    key: 'm05',
    frage: 'Wer zerstört am Ende tatsächlich den Einen Ring?',
    antworten: ['Frodo', 'Sam', 'Gollum', 'Gandalf'],
    richtig: 2,
    echo: 'Versehentlich, im Fallen. Die größte Heldentat der Geschichte war ein Unfall.',
  },
  {
    key: 'm06',
    frage: 'Wie heißt der Baumhirte, der Merry und Pippin trägt?',
    antworten: ['Schnellbaum', 'Baumbart', 'Lindenholz', 'Buchenbein'],
    richtig: 1,
    echo: 'Baumbart. Er redet langsam, weil nichts Wichtiges schnell gesagt werden kann.',
  },
  {
    key: 'm07',
    frage: 'Wie heißt Aragorns neu geschmiedetes Schwert?',
    antworten: ['Narsil', 'Andúril', 'Stich', 'Orcrist'],
    richtig: 1,
    echo: 'Andúril, „Flamme des Westens" – aus den Scherben von Narsil.',
  },
  {
    key: 'm08',
    frage: 'Wie lautet Sams Nachname?',
    antworten: ['Beutlin', 'Tuk', 'Gamdschie', 'Brandybock'],
    richtig: 2,
    echo: 'Samweis Gamdschie, Gärtner. Der eigentliche Held, wenn man ehrlich ist.',
  },
  {
    key: 'm09',
    frage: 'Aus wie vielen Mitgliedern besteht die Gemeinschaft des Rings?',
    antworten: ['Sieben', 'Acht', 'Neun', 'Zehn'],
    richtig: 2,
    echo: 'Neun Gefährten gegen neun Nazgûl. Tolkien mochte Symmetrie.',
  },
  {
    key: 'm10',
    frage: 'Wie heißt die Riesenspinne in Kankras Lauer?',
    antworten: ['Ungoliant', 'Kankra', 'Arachne', 'Shelan'],
    richtig: 1,
    echo: 'Kankra. Ihre Mutter Ungoliant hat seinerzeit zwei Bäume ausgetrunken.',
  },
  {
    key: 'm11',
    frage: 'Wie hieß Gollum, bevor der Ring ihn bekam?',
    antworten: ['Déagol', 'Sméagol', 'Grima', 'Bilbo'],
    richtig: 1,
    echo: 'Sméagol. Déagol war der Freund, den er dafür umbrachte.',
  },
  {
    key: 'm12',
    frage: 'In welchem Berg muss der Ring vernichtet werden?',
    antworten: ['Karadhras', 'Schicksalsberg', 'Einsamer Berg', 'Methedras'],
    richtig: 1,
    echo: 'Der Orodruin. Ein Vulkan als einzige Entsorgungsstelle – schlechte Infrastruktur.',
  },
  {
    key: 'm13',
    frage: 'Welcher Zauberer ist zu Beginn der Weiße?',
    antworten: ['Gandalf', 'Radagast', 'Saruman', 'Alatar'],
    richtig: 2,
    echo: 'Saruman. Gandalf erbt den Titel erst, nachdem er ein Balrog-Problem gelöst hat.',
  },
  {
    key: 'm14',
    frage: 'Wo leben die Hobbits?',
    antworten: ['Im Auenland', 'In Bruchtal', 'In Rohan', 'In Lothlórien'],
    richtig: 0,
    echo: 'Auenland. Sechs Mahlzeiten am Tag, wenn sie sie kriegen können.',
  },
  {
    key: 'm15',
    frage: 'Wie heißt das Königreich der Pferdeherren?',
    antworten: ['Gondor', 'Rohan', 'Arnor', 'Dale'],
    richtig: 1,
    echo: 'Rohan. Dort kommt Hilfe grundsätzlich im letzten Moment und bei Sonnenaufgang.',
  },
];

/** Dragon Ball. Für den Teil des Freundeskreises, der laut wird. */
const DRAGONBALL: readonly KatalogFrage[] = [
  {
    key: 'd01',
    frage: 'Wie lautet Son Gokus Saiyajin-Name?',
    antworten: ['Kakarott', 'Raditz', 'Bardock', 'Turles'],
    richtig: 0,
    echo: 'Kakarott. Vegeta benutzt ihn ungefähr 4.000-mal, immer im selben Tonfall.',
  },
  {
    key: 'd02',
    frage: 'Wie viele Dragon Balls braucht man für einen Wunsch?',
    antworten: ['Fünf', 'Sechs', 'Sieben', 'Vier'],
    richtig: 2,
    echo: 'Sieben. Danach sind sie ein Jahr lang Steine – die schlechteste Abklingzeit aller Zeiten.',
  },
  {
    key: 'd03',
    frage: 'Wer erfüllt den Wunsch, wenn alle Kugeln zusammen sind?',
    antworten: ['Shenlong', 'Kaio', 'Dende', 'Porunga'],
    richtig: 0,
    echo: 'Auf der Erde Shenlong, auf Namek Porunga. Ja, es gibt Filialen.',
  },
  {
    key: 'd04',
    frage: 'Wie heißt Son Gokus erster Sohn?',
    antworten: ['Son Goten', 'Son Gohan', 'Trunks', 'Pan'],
    richtig: 1,
    echo: 'Gohan. Nach Gokus Adoptivgroßvater benannt – und eigentlich wollte er Gelehrter werden.',
  },
  {
    key: 'd05',
    frage: 'Wie heißt Son Gokus Frau?',
    antworten: ['Bulma', 'Chichi', 'Videl', 'Launch'],
    richtig: 1,
    echo: 'Chichi. Die einzige Person im Universum, vor der Son Goku echte Angst hat.',
  },
  {
    key: 'd06',
    frage: 'Welcher Rasse gehört Piccolo an?',
    antworten: ['Saiyajin', 'Namekianer', 'Mensch', 'Majin'],
    richtig: 1,
    echo: 'Namekianer. Sie trinken Wasser, legen Eier und sind erstaunlich gute Babysitter.',
  },
  {
    key: 'd07',
    frage: 'Wie heißt die Technik, die Son Goku am häufigsten einsetzt?',
    antworten: ['Kienzan', 'Kamehameha', 'Makankosappo', 'Final Flash'],
    richtig: 1,
    echo: 'Das Kamehameha. Aufladezeit: je nach Dramatik zwischen drei Sekunden und zwei Folgen.',
  },
  {
    key: 'd08',
    frage: 'Wie heißt der Raum, in dem ein Jahr wie ein Tag vergeht?',
    antworten: [
      'Der Raum von Geist und Zeit',
      'Die Halle der Ahnen',
      'Das Zimmer des Meisters',
      'Der Turm des Kaio',
    ],
    richtig: 0,
    echo: 'Drinnen ein Jahr, draußen ein Tag. Die einzige Trainingsmethode mit Zeitdehnung und Tapete.',
  },
  {
    key: 'd09',
    frage: 'Wie heißt Son Gokus fliegende Wolke?',
    antworten: ['Nimbus', 'Jindujun', 'Kintoun', 'Alle drei'],
    richtig: 3,
    echo: 'Dieselbe Wolke, drei Namen – je nachdem, welche Übersetzung man geschaut hat.',
  },
  {
    key: 'd10',
    frage: 'Wer besiegt Freezer zuerst endgültig?',
    antworten: ['Son Goku', 'Vegeta', 'Trunks aus der Zukunft', 'Piccolo'],
    richtig: 2,
    echo: 'Trunks, in etwa zwölf Sekunden. Nach mehreren Staffeln Aufbau.',
  },
  {
    key: 'd11',
    frage: 'Wie heißt die Fusion aus Son Goku und Vegeta mit den Ohrringen?',
    antworten: ['Gogeta', 'Vegito', 'Gotenks', 'Kefla'],
    richtig: 1,
    echo: 'Mit Ohrringen: Vegito. Mit Tanz: Gogeta. Es gibt eine Prüfungsordnung dafür.',
  },
  {
    key: 'd12',
    frage: 'Wie lange soll Namek laut Ankündigung noch bis zur Explosion haben?',
    antworten: ['Eine Minute', 'Fünf Minuten', 'Eine Stunde', 'Zehn Minuten'],
    richtig: 1,
    echo: 'Fünf Minuten. Bekanntlich die längsten fünf Minuten der Fernsehgeschichte.',
  },
];

/** Film. Von „kennt jeder" bis „das wusstest du nur, wenn du aufgepasst hast". */
const FILM: readonly KatalogFrage[] = [
  {
    key: 'f01',
    frage: 'In welchem Star-Wars-Film fällt der Satz über Lukes Vater?',
    antworten: [
      'Eine neue Hoffnung',
      'Das Imperium schlägt zurück',
      'Die Rückkehr der Jedi-Ritter',
      'Die dunkle Bedrohung',
    ],
    richtig: 1,
    echo: 'Episode V. Und zitiert wird er bis heute falsch – „Luke, ich bin dein Vater" sagt niemand.',
  },
  {
    key: 'f02',
    frage: 'Wer führte Regie bei „Inception" und „Interstellar"?',
    antworten: ['Denis Villeneuve', 'Christopher Nolan', 'Ridley Scott', 'James Cameron'],
    richtig: 1,
    echo: 'Nolan. Erkennbar daran, dass man den Ton nicht versteht und die Zeit nicht kapiert.',
  },
  {
    key: 'f03',
    frage: 'Welches Auto ist die Zeitmaschine in „Zurück in die Zukunft"?',
    antworten: ['Ford Mustang', 'DeLorean DMC-12', 'Chevrolet Camaro', 'Pontiac Firebird'],
    richtig: 1,
    echo: 'Der DeLorean. Im Drehbuch war zuerst ein Kühlschrank vorgesehen.',
  },
  {
    key: 'f04',
    frage: 'Welche Pille führt in „Matrix" zur Wahrheit?',
    antworten: ['Die blaue', 'Die rote', 'Beide', 'Keine'],
    richtig: 1,
    echo: 'Die rote. Die blaue führt zurück ins Bett, was ehrlich gesagt auch ein Angebot ist.',
  },
  {
    key: 'f05',
    frage: 'Wie heißt der Clown in „Es"?',
    antworten: ['Pennywise', 'Twisty', 'Art', 'Gacy'],
    richtig: 0,
    echo: 'Pennywise. Alle 27 Jahre – ungefähr der Abstand zwischen zwei Backups.',
  },
  {
    key: 'f06',
    frage: 'Welcher Film gewann 2020 den Oscar als bester Film?',
    antworten: ['1917', 'Joker', 'Parasite', 'Once Upon a Time in Hollywood'],
    richtig: 2,
    echo: 'Parasite – der erste nicht englischsprachige Gewinner überhaupt.',
  },
  {
    key: 'f07',
    frage: 'Auf wessen Roman basiert „Jurassic Park"?',
    antworten: ['Stephen King', 'Michael Crichton', 'Arthur C. Clarke', 'Dan Brown'],
    richtig: 1,
    echo: 'Crichton. Im Buch stirbt deutlich mehr Personal.',
  },
  {
    key: 'f08',
    frage: 'Wie lautet die erste Regel des Fight Club?',
    antworten: [
      'Man kämpft nur einmal',
      'Man spricht nicht über den Fight Club',
      'Jeder muss kämpfen',
      'Keine Schuhe',
    ],
    richtig: 1,
    echo: 'Und die zweite Regel ist dieselbe, weil es beim ersten Mal offenbar niemand hört.',
  },
  {
    key: 'f09',
    frage: 'Womit vergleicht Forrest Gump das Leben?',
    antworten: [
      'Mit einem Fluss',
      'Mit einer Schachtel Pralinen',
      'Mit einem Marathon',
      'Mit einer Feder',
    ],
    richtig: 1,
    echo: 'Man weiß nie, was man kriegt. Bei diesem Quiz weiß man es leider genau.',
  },
  {
    key: 'f10',
    frage: 'Was für ein Wesen ist Shrek?',
    antworten: ['Ein Troll', 'Ein Oger', 'Ein Riese', 'Ein Kobold'],
    richtig: 1,
    echo: 'Ein Oger. Und Oger sind wie Zwiebeln – sie haben Schichten.',
  },
  {
    key: 'f11',
    frage: 'Wer führte Regie bei „Der Pate"?',
    antworten: ['Martin Scorsese', 'Francis Ford Coppola', 'Sergio Leone', 'Brian De Palma'],
    richtig: 1,
    echo: 'Coppola. Das Studio wollte ihn während der Dreharbeiten mehrfach feuern.',
  },
  {
    key: 'f12',
    frage: 'Welcher Film spielt größtenteils auf dem Planeten Pandora?',
    antworten: ['Avatar', 'Interstellar', 'Dune', 'Prometheus'],
    richtig: 0,
    echo: 'Avatar. Der erfolgreichste Film aller Zeiten, an den sich niemand erinnert.',
  },
  {
    key: 'f13',
    frage: 'Wie heißt der Hai-Film, mit dem Spielberg berühmt wurde?',
    antworten: ['Deep Blue Sea', 'Der weiße Hai', 'Open Water', 'The Meg'],
    richtig: 1,
    echo: 'Der Hai war meistens kaputt. Deshalb sieht man ihn so selten – und deshalb wirkt er.',
  },
  {
    key: 'f14',
    frage: 'In welchem Film sagt eine Figur „Hier ist Johnny!" durch eine Tür?',
    antworten: ['Psycho', 'Shining', 'Halloween', 'Misery'],
    richtig: 1,
    echo: 'Shining. Die Szene brauchte drei Tage und 60 Türen.',
  },
  {
    key: 'f15',
    frage: 'Welche Farbe hat der Anzug, an dem man den Bösewicht in „Kill Bill" erkennt?',
    antworten: ['Schwarz', 'Gelb', 'Rot', 'Weiß'],
    richtig: 1,
    echo: 'Der gelbe Anzug gehört allerdings der Heldin. Fangfrage – wir entschuldigen uns nicht.',
  },
];

/** Serie. Der Teil, bei dem die Diskussion im Sprachkanal eskaliert. */
const SERIE: readonly KatalogFrage[] = [
  {
    key: 's01',
    frage: 'Welchen Beruf hat Walter White zu Beginn von „Breaking Bad"?',
    antworten: ['Arzt', 'Chemielehrer', 'Apotheker', 'Buchhalter'],
    richtig: 1,
    echo: 'Chemielehrer. Das schlechteste Gehalt mit den besten Grundkenntnissen.',
  },
  {
    key: 's02',
    frage: 'Wie lautet Walter Whites Deckname?',
    antworten: ['Heisenberg', 'Schrödinger', 'Planck', 'Bohr'],
    richtig: 0,
    echo: 'Heisenberg. Nach dem Mann mit der Unschärferelation – passt erschreckend gut.',
  },
  {
    key: 's03',
    frage: 'Welches Wappentier führt Haus Stark?',
    antworten: ['Löwe', 'Drache', 'Schattenwolf', 'Hirsch'],
    richtig: 2,
    echo: 'Der Schattenwolf. Und ja, es endet für die meisten von ihnen schlecht.',
  },
  {
    key: 's04',
    frage: 'Wie lautet das Motto von Haus Stark?',
    antworten: [
      'Unbeugsam, ungebeugt, unzerbrochen',
      'Der Winter naht',
      'Hört mich brüllen',
      'Feuer und Blut',
    ],
    richtig: 1,
    echo: 'Acht Staffeln Vorlaufzeit für einen Winter, der dann drei Folgen dauert.',
  },
  {
    key: 's05',
    frage: 'In welcher Stadt spielt „The Office" (US)?',
    antworten: ['Scranton', 'Slough', 'Springfield', 'Stamford'],
    richtig: 0,
    echo: 'Scranton, Pennsylvania. Papierhandel, echt und trostlos.',
  },
  {
    key: 's06',
    frage: 'Wie heißt der Ort, in dem „Stranger Things" spielt?',
    antworten: ['Derry', 'Hawkins', 'Twin Peaks', 'Riverdale'],
    richtig: 1,
    echo: 'Hawkins, Indiana. Statistisch der gefährlichste Kleinstadtbezirk der Fernsehgeschichte.',
  },
  {
    key: 's07',
    frage: 'Wie heißt das Café in „Friends"?',
    antworten: ['Central Perk', 'Java Joe', 'The Grind', 'Cup of Joe'],
    richtig: 0,
    echo: 'Central Perk. Sechs Menschen, ein Sofa, zehn Jahre – niemand fragt je nach.',
  },
  {
    key: 's08',
    frage: 'In welcher Stadt leben die Simpsons?',
    antworten: ['Shelbyville', 'Springfield', 'Quahog', 'Langley Falls'],
    richtig: 1,
    echo: 'Springfield. Der Bundesstaat bleibt seit über 30 Jahren absichtlich offen.',
  },
  {
    key: 's09',
    frage: 'In welchem deutschen Ort spielt die Serie „Dark"?',
    antworten: ['Winden', 'Wieden', 'Wendland', 'Wildenau'],
    richtig: 0,
    echo: 'Winden. Wo alle miteinander verwandt sind – teilweise mit sich selbst.',
  },
  {
    key: 's10',
    frage: 'Welche Masken tragen die Räuber in „Haus des Geldes"?',
    antworten: ['Picasso', 'Dalí', 'Guy Fawkes', 'Miró'],
    richtig: 1,
    echo: 'Dalí-Masken und rote Overalls. Modisch mutig, kriminaltechnisch praktisch.',
  },
  {
    key: 's11',
    frage: 'Welches Spiel eröffnet „Squid Game"?',
    antworten: ['Tauziehen', 'Rotes Licht, grünes Licht', 'Murmeln', 'Zuckerwabe'],
    richtig: 1,
    echo: 'Die Puppe dreht sich. Danach dreht sich der Magen.',
  },
  {
    key: 's12',
    frage: 'Wie heißt die Hauptfigur am Anfang von „The Walking Dead"?',
    antworten: ['Daryl Dixon', 'Rick Grimes', 'Shane Walsh', 'Glenn Rhee'],
    richtig: 1,
    echo: 'Rick wacht im Krankenhaus auf. Das machen in dem Genre erstaunlich viele.',
  },
  {
    key: 's13',
    frage: 'Wie viele „Bücher" hat „Avatar – Herr der Elemente"?',
    antworten: ['Zwei', 'Drei', 'Vier', 'Fünf'],
    richtig: 1,
    echo: 'Wasser, Erde, Feuer. Luft fehlt, weil davon nur noch einer übrig ist.',
  },
  {
    key: 's14',
    frage: 'Wer spielt Sherlock in der BBC-Serie „Sherlock"?',
    antworten: ['Martin Freeman', 'Benedict Cumberbatch', 'Jonny Lee Miller', 'Tom Hiddleston'],
    richtig: 1,
    echo: 'Cumberbatch. Drei Folgen pro Staffel, drei Jahre Pause – auch eine Form von Spannung.',
  },
  {
    key: 's15',
    frage: 'Was für ein Format ist „Chernobyl" von HBO?',
    antworten: ['Eine Miniserie', 'Eine Dokumentation', 'Ein Zweiteiler', 'Eine laufende Serie'],
    richtig: 0,
    echo: 'Fünf Teile, keine zweite Staffel. Vorbildlich für ein Format, das fertig sein darf.',
  },
];

/** Anime jenseits von Dragon Ball. Der Katalog wird hier statistisch am peinlichsten. */
const ANIME: readonly KatalogFrage[] = [
  {
    key: 'a01',
    frage: 'Wie heißt Narutos Heimatdorf?',
    antworten: ['Suna', 'Konoha', 'Kiri', 'Iwa'],
    richtig: 1,
    echo: 'Konohagakure, das Dorf im Blätterwald. Berufsrisiko: Einsamkeit als Kind.',
  },
  {
    key: 'a02',
    frage: 'Welches Wesen ist in Naruto versiegelt?',
    antworten: [
      'Ein achtschwänziger Ochse',
      'Ein neunschwänziger Fuchs',
      'Ein dreischwänziger Schildkröte',
      'Ein einschwänziger Waschbär',
    ],
    richtig: 1,
    echo: 'Kurama, der Neunschwänzige. Zunächst Fluch, später der beste Freund.',
  },
  {
    key: 'a03',
    frage: 'Was will Ruffy in „One Piece" werden?',
    antworten: [
      'Der stärkste Schwertkämpfer',
      'König der Piraten',
      'Marine-Admiral',
      'Schiffsarzt',
    ],
    richtig: 1,
    echo: 'König der Piraten. Seit über 1.000 Kapiteln unterwegs, und das Ziel steht unverändert.',
  },
  {
    key: 'a04',
    frage: 'Wie heißen die drei Mauern in „Attack on Titan"?',
    antworten: [
      'Maria, Rose, Sina',
      'Anna, Rosa, Sofia',
      'Marta, Rita, Sara',
      'Mira, Rhea, Selene',
    ],
    richtig: 0,
    echo: 'Von außen nach innen. Wer drinnen wohnt, hat Geld; wer draußen wohnt, hat Probleme.',
  },
  {
    key: 'a05',
    frage: 'Was für ein Wesen ist Ryuk in „Death Note"?',
    antworten: ['Ein Dämon', 'Ein Shinigami', 'Ein Geist', 'Ein Engel'],
    richtig: 1,
    echo: 'Ein Todesgott mit Apfelsucht. Die gefährlichste Nebenfigur mit dem harmlosesten Hobby.',
  },
  {
    key: 'a06',
    frage: 'Wie heißt die Hauptfigur in „Demon Slayer"?',
    antworten: ['Zenitsu', 'Inosuke', 'Tanjiro', 'Giyu'],
    richtig: 2,
    echo: 'Tanjiro Kamado. Erkennbar an den Ohrringen und an der guten Nase.',
  },
  {
    key: 'a07',
    frage: 'Wie heißt die vererbbare Kraft in „My Hero Academia"?',
    antworten: ['One For All', 'All For One', 'Quirk Prime', 'Plus Ultra'],
    richtig: 0,
    echo: 'One For All wird weitergegeben, All For One wird genommen. Ein Buchstabe, viel Ärger.',
  },
  {
    key: 'a08',
    frage: 'Wie heißen die Brüder in „Fullmetal Alchemist"?',
    antworten: ['Roy und Riza', 'Edward und Alphonse', 'Ling und Lan Fan', 'Scar und Kimblee'],
    richtig: 1,
    echo: 'Der Kleine ist der mit der Rüstung, der Große ist die Rüstung. Ständige Verwechslung.',
  },
  {
    key: 'a09',
    frage: 'Welches Pokémon begleitet Ash von Anfang an?',
    antworten: ['Glumanda', 'Pikachu', 'Bisasam', 'Evoli'],
    richtig: 1,
    echo: 'Pikachu, das zu Beginn nicht mal in den Ball wollte.',
  },
  {
    key: 'a10',
    frage: 'Wie heißt die schwarze Katze in „Sailor Moon"?',
    antworten: ['Artemis', 'Luna', 'Diana', 'Nyx'],
    richtig: 1,
    echo: 'Luna. Die weiße heißt Artemis – auch hier vertauschen es alle.',
  },
  {
    key: 'a11',
    frage: 'Welches Studio steht hinter „Mein Nachbar Totoro"?',
    antworten: ['Studio Ghibli', 'Toei Animation', 'Madhouse', 'Kyoto Animation'],
    richtig: 0,
    echo: 'Ghibli. Der Totoro im Logo ist bis heute das freundlichste Firmenzeichen der Welt.',
  },
  {
    key: 'a12',
    frage: 'Was verschlingt Yuji zu Beginn von „Jujutsu Kaisen"?',
    antworten: ['Ein Auge', 'Einen Finger', 'Ein Herz', 'Einen Zahn'],
    richtig: 1,
    echo: 'Einen von zwanzig Fingern. Der Rest der Serie besteht daraus, die anderen zu suchen.',
  },
];

/** Spiele – und ein bisschen Serverbetrieb, weil wir hier nun mal sind. */
const SPIEL: readonly KatalogFrage[] = [
  {
    key: 'g01',
    frage: 'Welcher Standard-Port gehört zu einem Minecraft-Java-Server?',
    antworten: ['25565', '27015', '7777', '19132'],
    richtig: 0,
    echo: '25565. Die Bedrock-Ausgabe nimmt 19132 – ein Klassiker für verlorene Abende.',
  },
  {
    key: 'g02',
    frage: 'Wie heißt der Endgegner in Minecraft?',
    antworten: ['Der Wither', 'Der Enderdrache', 'Der Warden', 'Der Ravager'],
    richtig: 1,
    echo: 'Der Enderdrache. Danach gibt es einen Abspann, den niemand liest.',
  },
  {
    key: 'g03',
    frage: 'Was ist ein „Seed" in einem Weltgenerator?',
    antworten: [
      'Ein Startwert für die Zufallsgenerierung',
      'Ein Speicherstand',
      'Ein Bauplan',
      'Ein Ladebildschirm',
    ],
    richtig: 0,
    echo: 'Gleicher Seed, gleiche Welt. Deshalb sehen zwei Server manchmal identisch aus.',
  },
  {
    key: 'g04',
    frage: 'Was bedeutet TPS bei einem Minecraft-Server?',
    antworten: [
      'Ticks pro Sekunde',
      'Transfers pro Sekunde',
      'Trades pro Spieler',
      'Tasks pro Server',
    ],
    richtig: 0,
    echo: 'Zwanzig ist das Maximum. Alles darunter merkt man an zähen Kühen.',
  },
  {
    key: 'g05',
    frage: 'Was macht ein Creeper, bevor er explodiert?',
    antworten: ['Er brüllt', 'Er zischt', 'Er pfeift', 'Er klopft'],
    richtig: 1,
    echo: 'Das Zischen ist das letzte, was dein Bauwerk hört.',
  },
  {
    key: 'g06',
    frage: 'In welcher Mythologie ist „Valheim" angesiedelt?',
    antworten: ['Griechisch', 'Nordisch', 'Ägyptisch', 'Keltisch'],
    richtig: 1,
    echo: 'Nordisch. Man stirbt, verliert alles und läuft nackt zurück – sehr authentisch.',
  },
  {
    key: 'g07',
    frage: 'Wofür steht RCON bei Gameservern?',
    antworten: ['Remote Console', 'Rapid Connection', 'Render Control', 'Resource Container'],
    richtig: 0,
    echo: 'Fernsteuerung der Serverkonsole. Praktisch – und ein Grund, das Passwort ernst zu nehmen.',
  },
  {
    key: 'g08',
    frage: 'Wie viele Spieler sieht eine klassische Runde „Among Us" vor?',
    antworten: ['2 bis 6', '4 bis 10', '8 bis 16', '10 bis 20'],
    richtig: 1,
    echo: 'Vier bis zehn. Und mindestens einer davon lügt schlecht.',
  },
  {
    key: 'g09',
    frage: 'Was ist in Terraria der „Wall of Flesh"?',
    antworten: ['Ein Baumaterial', 'Ein Endgegner der ersten Hälfte', 'Ein Biom', 'Ein Werkzeug'],
    richtig: 1,
    echo: 'Besiegt man ihn, beginnt der Hardmode – und die Welt wird ungemütlich.',
  },
  {
    key: 'g10',
    frage: 'Was beschreibt der Begriff „Tickrate" allgemein?',
    antworten: [
      'Wie oft der Server seinen Zustand berechnet',
      'Wie schnell die Festplatte liest',
      'Wie viele Spieler verbunden sind',
      'Wie groß die Welt ist',
    ],
    richtig: 0,
    echo: 'Je höher, desto flüssiger – und desto mehr Rechenzeit will der Server dafür.',
  },
  {
    key: 'g11',
    frage: 'Was ist ein „Whitelist"-Server?',
    antworten: [
      'Ein Server ohne Mods',
      'Ein Server, auf den nur eingetragene Konten dürfen',
      'Ein Server ohne PvP',
      'Ein Server mit hellem Design',
    ],
    richtig: 1,
    echo: 'Genau das, was einen Freundeskreis-Server von einem öffentlichen unterscheidet.',
  },
  {
    key: 'g12',
    frage: 'Wofür steht „LAN"?',
    antworten: [
      'Local Area Network',
      'Large Access Node',
      'Linked Adapter Network',
      'Low Access Net',
    ],
    richtig: 0,
    echo: 'Und eine LAN-Party ist der Grund, warum dieses Panel überhaupt existiert.',
  },
];

const ABSCHNITTE: readonly KatalogAbschnitt[] = [
  { gebiet: 'wissen', fragen: WISSEN },
  { gebiet: 'unnuetz', fragen: UNNUETZ },
  { gebiet: 'mittelerde', fragen: MITTELERDE },
  { gebiet: 'dragonball', fragen: DRAGONBALL },
  { gebiet: 'film', fragen: FILM },
  { gebiet: 'serie', fragen: SERIE },
  { gebiet: 'anime', fragen: ANIME },
  { gebiet: 'spiel', fragen: SPIEL },
];

export interface GestellteFrage extends KatalogFrage {
  gebiet: KatalogGebiet;
}

/**
 * Reihum eine Frage je Gebiet, bis alle aufgebraucht sind.
 *
 * Nicht nach Themen sortiert, und das ist der Punkt: Auf Tolkien folgt ein
 * Oktopus, darauf ein Standard-Port. Wer blockweise fragt, verliert die
 * Hälfte der Leute im ersten Block, der sie nicht interessiert – so bleibt
 * jedes Gebiet höchstens acht Fragen entfernt.
 *
 * Bewusst reihum und nicht gemischt: Ein `Math.random()` hier hieße, dass
 * derselbe Durchlauf nie zweimal gleich aussieht und kein Test ihn festhalten
 * kann (siehe `spott.ts`, gleiche Regel).
 */
function verzahne(abschnitte: readonly KatalogAbschnitt[]): GestellteFrage[] {
  const laengste = Math.max(0, ...abschnitte.map((abschnitt) => abschnitt.fragen.length));
  const heraus: GestellteFrage[] = [];

  for (let platz = 0; platz < laengste; platz += 1) {
    for (const abschnitt of abschnitte) {
      const frage = abschnitt.fragen[platz];
      if (frage) heraus.push({ ...frage, gebiet: abschnitt.gebiet });
    }
  }

  return heraus;
}

/**
 * Der vollständige Bogen: erst die drei versprochenen Fragen, dann der Rest.
 *
 * Die drei stehen vorn und in dieser Reihenfolge, weil das Tutorial sie
 * ankündigt. Alles danach ist die Pointe.
 */
export const QUIZ_FRAGEN: readonly GestellteFrage[] = [
  ...PANEL.map((frage): GestellteFrage => ({ ...frage, gebiet: 'panel' })),
  ...verzahne(ABSCHNITTE),
];

/** Fragen je Seite. Drei – so viele, wie das Tutorial anfangs verspricht. */
export const FRAGEN_PRO_SEITE = 3;

export const SEITEN_GESAMT = Math.ceil(QUIZ_FRAGEN.length / FRAGEN_PRO_SEITE);

/** Die Fragen einer Seite; `nummer` zählt ab 1. */
export function seitenFragen(nummer: number): readonly GestellteFrage[] {
  const start = (Math.max(1, nummer) - 1) * FRAGEN_PRO_SEITE;

  return QUIZ_FRAGEN.slice(start, start + FRAGEN_PRO_SEITE);
}

/** Platz einer Frage im Gesamtbogen (ab 1) – für „Frage 47 von 124". */
export function frageNummer(seite: number, platzAufSeite: number): number {
  return (Math.max(1, seite) - 1) * FRAGEN_PRO_SEITE + platzAufSeite + 1;
}

/**
 * Richtige Antworten in einer Liste von Antworten (`null` = nicht beantwortet).
 *
 * Nimmt die volle Liste über alle {@link QUIZ_FRAGEN} entgegen, auch wenn
 * hinten fast alles offen ist – wer nach drei Fragen aufhört, hat eben 121
 * Lücken, und die zählen als nichts, nicht als falsch.
 */
export function quizPunkte(antworten: readonly (number | null)[]): number {
  return antworten.reduce<number>((summe, gewaehlt, index) => {
    const frage = QUIZ_FRAGEN[index];
    if (!frage || gewaehlt === null) return summe;

    return gewaehlt === frage.richtig ? summe + 1 : summe;
  }, 0);
}

/** Wie viele Fragen überhaupt beantwortet wurden. */
export function quizBeantwortet(antworten: readonly (number | null)[]): number {
  return antworten.filter((wert) => wert !== null).length;
}
