/**
 * Rätsel für Black Stories – alle für die Spielhalle neu geschrieben.
 *
 * Bewusst keine Nacherzählung bekannter Rätselkarten oder „Lateral
 * Thinking"-Klassiker: Wer eine Lösung schon kennt, verdirbt die Runde für
 * alle anderen. Die Geschichten sind makaber, aber ohne blutige Einzelheiten,
 * ohne reale Personen und ohne Kinder als Opfer – es sind Freunde, die hier
 * zusammen spielen, und ein Abend soll mit Lachen enden, nicht mit Schaudern.
 *
 * `stufe`: 1 leicht (wenige Fragen), 2 mittel, 3 schwer (braucht Umwege).
 */

export interface BlackStory {
  id: number;
  titel: string;
  /** Vorderseite: der rätselhafte Satz, den alle sehen. */
  text: string;
  /** Rückseite: was wirklich passiert ist – nur für die Rätselmeisterin. */
  loesung: string;
  stufe: 1 | 2 | 3;
}

export const BLACK_STORIES: readonly BlackStory[] = [
  {
    id: 1,
    titel: 'Zum ersten Mal pünktlich',
    text: 'Zum ersten Mal in seinem Leben kam Herr Brenner auf die Minute pünktlich – und alle Anwesenden trugen Schwarz.',
    loesung:
      'Herr Brenner war berüchtigt dafür, zu jedem Termin zu spät zu kommen. Es war seine eigene Beerdigung, und die Sargträger brachten ihn exakt zur angesetzten Zeit in die Kapelle. Die Trauergäste waren sich einig: Das hat er nur geschafft, weil andere ihn getragen haben.',
    stufe: 1,
  },
  {
    id: 2,
    titel: 'Sieben Buchstaben',
    text: 'Weil in einem Kreuzworträtsel ein einziges Wort fehlte, erbte Frau Kolbe ein Vermögen.',
    loesung:
      'Ihr reicher Onkel hatte im Testament verfügt, dass erbt, wer das Kreuzworträtsel zu Ende löst, über dem er gestorben war. Alle Verwandten bissen sich am letzten Wort mit sieben Buchstaben die Zähne aus. Frau Kolbe, eine leidenschaftliche Rätslerin, fand es sofort: „Erbfall".',
    stufe: 2,
  },
  {
    id: 3,
    titel: 'Die neue Vogelscheuche',
    text: 'Der Bauer war stolz auf seine neue Vogelscheuche, bis die Polizei sie mitnahm.',
    loesung:
      'Ein Wanderer war am Feldrand an einem Herzanfall gestorben und lehnte aufrecht an einem Zaunpfahl. Der kurzsichtige Bauer hielt ihn im Morgennebel für eine Vogelscheuche, die ihm der Nachbar zum Spaß hingestellt hatte, und setzte ihr sogar noch einen Hut auf. Erst dem Briefträger fiel auf, dass die Scheuche teure Wanderschuhe trug.',
    stufe: 2,
  },
  {
    id: 4,
    titel: 'Zu gute Arbeit',
    text: 'Der Maler starb, weil er seine Arbeit zu gut gemacht hatte.',
    loesung:
      'Er war Spezialist für Tarnbemalung und hatte seinen Wohnwagen so täuschend echt als Waldrand bemalt, dass er darauf mächtig stolz war. Nachts parkte er ihn an einem Forstweg. Der Fahrer des Holzlasters sah im Morgengrauen nur Bäume – und fuhr hinein.',
    stufe: 2,
  },
  {
    id: 5,
    titel: 'Dreizehn Uhr nachts',
    text: 'Die Kuckucksuhr rief dreizehnmal, und Herr Albers war gerettet.',
    loesung:
      'Herr Albers war nachts in seinem Flur gestürzt und kam nicht mehr hoch. Seine alte Kuckucksuhr war verstellt und rief um ein Uhr dreizehnmal. Sein Nachbar, ein pensionierter Uhrmacher, hörte das durch die dünne Wand, hielt es nicht aus und klingelte, um die Uhr zu richten. Als niemand öffnete, holte er den Hausmeister.',
    stufe: 1,
  },
  {
    id: 6,
    titel: 'Der Zeuge mit Federn',
    text: 'Der Papagei sagte bei der Testamentseröffnung einen einzigen Satz, und der Neffe musste ins Gefängnis.',
    loesung:
      'Der Neffe hatte wochenlang im Nebenzimmer telefoniert und dabei immer wieder denselben Satz gesagt: „Die Tabletten tausche ich einfach aus." Der Papagei des verstorbenen Onkels hatte ihn gelernt und plapperte ihn vor Notar und Familie nach. Die Untersuchung der Arzneidose erledigte den Rest.',
    stufe: 1,
  },
  {
    id: 7,
    titel: 'Tränen am Grab',
    text: 'Der Bestatter weinte am Grab bitterlicher als alle anderen – dabei hatte er den Toten nie gekannt.',
    loesung:
      'Beim Zurechtrücken des Kissens im Sarg war ihm sein Lottoschein aus der Brusttasche gerutscht. Am Abend der Beerdigung erfuhr er aus den Nachrichten, dass seine Zahlen gewonnen hatten. Der Schein lag da schon zwei Meter tief.',
    stufe: 1,
  },
  {
    id: 8,
    titel: 'Ein ganz besonderer Jahrgang',
    text: 'Der Weinkenner erkannte den Jahrgang beim ersten Schluck – und wusste in diesem Moment, dass er vergiftet worden war.',
    loesung:
      'Von diesem seltenen Jahrgang gab es nur noch eine einzige Flasche, und die gehörte seinem alten Rivalen, dem er einst die Verlobte ausgespannt hatte. Als ihm genau dieser Wein anonym in seinem Stammlokal serviert wurde, verstand er. Der bittere Nachgeschmack war nicht das Holzfass.',
    stufe: 2,
  },
  {
    id: 9,
    titel: 'Günstig vom Hafen',
    text: 'Der Seiltänzer stürzte, weil der Zirkusdirektor sparen wollte.',
    loesung:
      'Der Direktor hatte das teure Sicherheitsnetz durch ein gebrauchtes Fischernetz aus dem Hafen ersetzt. Für Heringe war es bestens geeignet. Für einen erwachsenen Artisten waren die Maschen genau groß genug.',
    stufe: 1,
  },
  {
    id: 10,
    titel: 'Frühjahrsputz',
    text: 'Im Frühling fand man im Garten eine Karotte, zwei Kohlestücke, einen Schal – und Herrn Lindner.',
    loesung:
      'Herr Lindner war im Winter nach einer Feier im Garten eingeschlafen und über Nacht eingeschneit worden. Am nächsten Tag bauten Spaziergänger, die seine Einfahrt als Abkürzung nutzten, aus dem großen Schneehaufen einen prächtigen Schneemann. Erst die Schneeschmelze zeigte, was darin steckte.',
    stufe: 1,
  },
  {
    id: 11,
    titel: 'Partymodus',
    text: 'Weil seine Wohnung eine Party feierte, überlebte Herr Kranz einen Brand.',
    loesung:
      'Beim Einrichten seiner vernetzten Wohnung hatte er den Rauchmelder versehentlich mit dem Szenario „Party" verknüpft. Als nachts ein Kabel in der Küche schmorte, gingen Discolicht und laute Musik an, während er mit Ohrstöpseln schlief. Die genervten Nachbarn riefen die Polizei wegen Ruhestörung – und die Beamten rochen den Rauch.',
    stufe: 2,
  },
  {
    id: 12,
    titel: 'Ziel erreicht',
    text: 'Das Auto meldete „Sie haben Ihr Ziel erreicht", und der Fahrer war tot.',
    loesung:
      'Herr Gerber besuchte jeden Sonntag das Grab seiner Frau und hatte den Friedhof als Ziel eingegeben. Unterwegs versagte sein Herz, doch sein selbstfahrendes Auto fuhr ihn ordnungsgemäß weiter und parkte vor dem Friedhofstor. Der Friedhofsgärtner meinte später, so kurze Wege habe er selten erlebt.',
    stufe: 1,
  },
  {
    id: 13,
    titel: 'Das letzte Passwort',
    text: 'Das Letzte, was der sterbende Herr Wolff tat, war, sein Passwort zu ändern.',
    loesung:
      'Er merkte, dass er vergiftet worden war, und konnte weder sprechen noch telefonieren. Die Ermittler würden sein Handy knacken lassen, also änderte er mit letzter Kraft das Passwort in „MarkusWarsMitGift". Markus war sein Bruder, der sich auf das Erbe gefreut hatte.',
    stufe: 2,
  },
  {
    id: 14,
    titel: 'Hübsche weiße Pilze',
    text: 'Frau Engel las am Abend ihr eigenes Tagebuch und rief sofort den Notarzt.',
    loesung:
      'Frau Engel vergaß seit einiger Zeit, was sie tagsüber getan hatte, und schrieb deshalb alles auf. Am Abend las sie in ihrer eigenen Schrift: „Pilze gesammelt und gebraten – die hübschen weißen." Daneben hatte sie einen Pilz gezeichnet, den sie als Knollenblätterpilz erkannte. Der Notarzt kam rechtzeitig.',
    stufe: 2,
  },
  {
    id: 15,
    titel: 'Die Vorführung',
    text: 'Der Rettungsschwimmer ertrank vor Hunderten Zuschauern, und alle klatschten.',
    loesung:
      'Beim Tag der offenen Tür im Freibad sollte er vorführen, woran man einen Ertrinkenden erkennt. Mitten in der Darbietung bekam er einen Krampf. Seine echte Not sah genau so aus wie das, was er vorführen wollte, und das Publikum applaudierte der gelungenen Darstellung.',
    stufe: 2,
  },
  {
    id: 16,
    titel: 'Die Lichterkette',
    text: 'Der Weihnachtsbaum war schuld daran, dass man Herrn Pohl erst im Juli fand.',
    loesung:
      'Herr Pohl lebte allein, und die Nachbarn sahen jeden Abend die Lichterkette am Fenster blinken. Das hielten sie für ein Lebenszeichen. Die Kette hing an einer Zeitschaltuhr – Herr Pohl war schon kurz nach Neujahr friedlich eingeschlafen.',
    stufe: 1,
  },
  {
    id: 17,
    titel: 'Der Riesenkürbis',
    text: 'Der preisgekrönte Kürbis des Jahres brachte seinen Züchter ins Gefängnis.',
    loesung:
      'Herr Zeller gewann jedes Jahr, aber dieses Jahr wuchs sein Kürbis doppelt so groß wie je zuvor. Die Jury wunderte sich – ebenso darüber, dass sein streitlustiger Gartennachbar seit dem Frühjahr angeblich auf Weltreise war. Beim Erntefest schlug ein Spürhund der Polizei genau am Kürbisbeet an.',
    stufe: 2,
  },
  {
    id: 18,
    titel: 'Antwort aus den Bergen',
    text: 'Der Bergsteiger rief um Hilfe, bekam eine Antwort und blieb sitzen, bis es zu spät war.',
    loesung:
      'Er saß verletzt in einer Felsrinne und rief: „Ist da jemand?" Von der Wand gegenüber schallte „… jemand!" zurück. Er hielt das Echo für die Stimme eines Retters, sparte seine Kräfte und wartete, statt sich zur Hütte hinunterzuschleppen.',
    stufe: 1,
  },
  {
    id: 19,
    titel: 'Ein Bewohner zu viel',
    text: 'Im Sarkophag lagen zwei Mumien, obwohl im Katalog nur eine stand.',
    loesung:
      'Ein Kunstdieb hatte sich nach Museumsschluss im Sarkophag versteckt, um nachts ungestört zu arbeiten. Der schwere Deckel ließ sich von innen nicht mehr öffnen, und das Museum schloss danach für eine lange Renovierung. Als Forscher Jahre später den Sarkophag durchleuchteten, lag ein zweiter Bewohner darin – mit Taschenlampe und Glasschneider.',
    stufe: 2,
  },
  {
    id: 20,
    titel: 'Zehn Kilo leichter',
    text: 'Weil Frau Brandt endlich zehn Kilo abgenommen hatte, kam sie von ihrem Tauchgang nicht zurück.',
    loesung:
      'Körperfett treibt im Wasser nach oben. Frau Brandt benutzte nach der Diät denselben Bleigurt wie vorher, der jetzt viel zu schwer für sie war. In der Tiefe zog er sie nach unten, und sie verbrauchte ihre Luft beim Versuch, gegen das Gewicht anzuschwimmen.',
    stufe: 3,
  },
  {
    id: 21,
    titel: 'Das Testament zum Nachtisch',
    text: 'Die Nachbarn aßen den Kuchen der Verstorbenen – und verspeisten damit ein Vermögen.',
    loesung:
      'Die alte Dame hatte keine Familie und wollte ihren Nachbarn alles vermachen. Sie schrieb ihr Testament mit Lebensmittelfarbe auf Esspapier und buk es als Überraschung in einen Kuchen für den Leichenschmaus. Der Kuchen war aufgegessen, bevor jemand die Buchstaben bemerkte, und ohne Testament ging alles an den Staat.',
    stufe: 2,
  },
  {
    id: 22,
    titel: 'Das beste Kostüm',
    text: 'Auf dem Maskenball bekam der stillste Gast den Preis für das beste Kostüm.',
    loesung:
      'Ein älterer Herr war im Laufe des Abends im Ohrensessel friedlich verstorben. Mit seiner Zombiemaske und der völlig reglosen Haltung hielt die Jury ihn für die überzeugendste Darstellung eines Untoten, die sie je gesehen hatte. Erst als er zur Preisverleihung nicht aufstand, schaute jemand genauer hin.',
    stufe: 1,
  },
  {
    id: 23,
    titel: 'Die Abkürzung',
    text: 'Herr Kurz gewann im Lotto und starb noch am selben Tag an seiner Sparsamkeit.',
    loesung:
      'Er wollte das Geld für ein Taxi zur Lottoannahmestelle nicht ausgeben und nahm zu Fuß die Abkürzung über den zugefrorenen Weiher. Das Eis war im Tauwetter dünn geworden. Der Gewinnschein wurde im Frühjahr gefunden, war aber nicht mehr lesbar.',
    stufe: 1,
  },
  {
    id: 24,
    titel: 'Der schiefe Sänger',
    text: 'Weil er so schief sang, rettete er allen Freunden das Leben.',
    loesung:
      'Beim Karaoke-Abend in der Berghütte sang er so furchtbar, dass ihn die anderen zum Holzholen nach draußen schickten. Drinnen zog der verstopfte Ofen giftiges Kohlenmonoxid in die Stube. Als er zurückkam, lagen alle benommen da – er, klar von der frischen Luft, riss die Fenster auf und rief Hilfe.',
    stufe: 2,
  },
  {
    id: 25,
    titel: 'Zerbrechlich',
    text: 'Beim Umzug ging nichts zu Bruch, aber Onkel Theo landete in Wien statt in Köln.',
    loesung:
      'Onkel Theo war seit zwei Jahren eine Urne, die im Regal stand. Beim Packen landete er in einem Karton mit der Aufschrift „Küche – zerbrechlich", der versehentlich auf den Laster eines anderen Umzugs geriet. Die Familie in Wien fand ihn zwischen den Kochtöpfen.',
    stufe: 1,
  },
  {
    id: 26,
    titel: 'Die schönste Rede',
    text: 'Der Trauerredner sprach über den falschen Toten, und die Familie bedankte sich überschwänglich.',
    loesung:
      'Er hatte die Unterlagen zweier Trauerfeiern vertauscht und lobte einen herzensguten, großzügigen Familienvater. Der Verstorbene war in Wahrheit ein berüchtigter Geizhals, den niemand gemocht hatte. Zum ersten Mal hörte die Familie etwas Nettes über ihn – und wollte es gar nicht anders.',
    stufe: 1,
  },
  {
    id: 27,
    titel: 'Der letzte Trick',
    text: 'Der Zauberer ließ seine Assistentin verschwinden, und seitdem ist sie wirklich weg.',
    loesung:
      'Die Assistentin hatte den Trick mit der Falltür selbst entworfen. Bei der Abschiedsvorstellung nutzte sie den Gang unter der Bühne, um mit der gesamten Tageskasse des Varietés zu verschwinden. Der Zauberer musste den Applaus allein entgegennehmen.',
    stufe: 1,
  },
  {
    id: 28,
    titel: 'Die diebische Zeugin',
    text: 'Der Ring, nach dem die Polizei zwei Jahre gesucht hatte, lag in einem Vogelnest.',
    loesung:
      'Der Ehering einer Verschwundenen war das wichtigste Beweisstück, doch der Verdächtige schwor, ihn nie gesehen zu haben. Eine Elster hatte ihn damals vom Balkontisch des Verdächtigen gestohlen. Als Baumpfleger das Nest im Baum vor seiner Wohnung entfernten, fanden sie den Ring mit der Gravur.',
    stufe: 2,
  },
  {
    id: 29,
    titel: 'Ausnahmsweise pünktlich',
    text: 'Weil der Zug ausnahmsweise pünktlich war, starb Herr Nagel.',
    loesung:
      'Herr Nagel wusste, dass der Regionalzug seit Jahren mindestens zehn Minuten Verspätung hatte. Deshalb nahm er jeden Morgen gemütlich die verbotene Abkürzung über die Gleise. An diesem Morgen war der Zug zum ersten Mal auf die Minute pünktlich.',
    stufe: 1,
  },
  {
    id: 30,
    titel: 'Süßes Gift',
    text: 'Der Imker starb an seinem eigenen Honig.',
    loesung:
      'Seine Bienen hatten im Frühjahr fast nur an den Rhododendren im Park gesammelt, deren Nektar ein Gift enthält. Der daraus entstandene Honig schmeckte ungewöhnlich herb. Der Imker aß als Erster und am meisten davon – er wollte keinen schlechten Honig verkaufen.',
    stufe: 2,
  },
  {
    id: 31,
    titel: 'Grüße aus den Bergen',
    text: 'Opa schrieb: „Hier ist es völlig ungefährlich." Die Familie las den Satz bei seiner Beerdigung vor.',
    loesung:
      'Opa hatte die Postkarte am ersten Tag seiner Kletterreise eingeworfen. Die Post brauchte drei Wochen, der Berg nur einen Tag. Weil der Satz so typisch für ihn war, wurde er zum Leitspruch der Trauerfeier.',
    stufe: 1,
  },
  {
    id: 32,
    titel: 'Der Gärtner war es',
    text: 'Der Gärtner war es wirklich – aber ganz anders, als alle dachten.',
    loesung:
      'Der reiche Hausherr stürzte nachts im Park und starb. Die Polizei suchte monatelang nach einem raffinierten Mörder mit Motiv. In Wahrheit war er über den Gartenschlauch gestolpert, den der schusselige Gärtner wie jeden Abend quer über den Weg liegen gelassen hatte.',
    stufe: 1,
  },
  {
    id: 33,
    titel: 'Der Weckruf',
    text: 'Weil sein Wecker klingelte, verlor der Schlafwandler sein Leben.',
    loesung:
      'Herr Reuter wanderte im Schlaf gern auf das Flachdach seines Hauses und balancierte dort herum, ohne je zu stürzen. In dieser Nacht klingelte sein neuer, sehr lauter Wecker, den er aus Versehen auf drei Uhr gestellt hatte. Er schreckte auf der Dachkante hoch.',
    stufe: 1,
  },
  {
    id: 34,
    titel: 'Die letzte Runde',
    text: 'Nach der letzten Runde blieb ein Fahrgast auf dem Karussell sitzen, bis der Jahrmarkt abgebaut wurde.',
    loesung:
      'Ein alter Herr fuhr seit sechzig Jahren an jedem Jahrmarktstag auf demselben Holzpferd. Während seiner Runde schlief er für immer ein, lächelnd und fest an die Stange geklammert. Weil er sich bei jeder Fahrt kaum bewegte, bemerkte der Schausteller es erst beim Abbau.',
    stufe: 1,
  },
  {
    id: 35,
    titel: 'Der Brautstrauß',
    text: 'Die Braut sah ihren Blumenstrauß und sagte am Altar Nein.',
    loesung:
      'Der Bräutigam hatte beim Blumenhändler gespart und die Blumen nachts vom Friedhof geholt. An einer Rose hing noch ein Stück Trauerschleife mit dem Namen ihrer Großmutter. Er hatte das Grab seiner zukünftigen Schwiegerfamilie geplündert.',
    stufe: 1,
  },
  {
    id: 36,
    titel: 'Ein Wunsch geht in Erfüllung',
    text: 'Herr Rieger wünschte sich bei einer Sternschnuppe Reichtum – reich wurde aber nur seine Frau.',
    loesung:
      'Die Sternschnuppe war ein kleiner Meteorit, der nicht vollständig verglühte und Herrn Rieger im Garten traf. Seine Witwe verkaufte den seltenen Stein an ein Museum für eine sechsstellige Summe. Sie sagt heute, er habe sich wenigstens einmal im Leben etwas Vernünftiges gewünscht.',
    stufe: 2,
  },
  {
    id: 37,
    titel: 'Der fleißige Zeuge',
    text: 'Der Staubsaugerroboter drehte seine Runden, und genau das überführte den Mörder.',
    loesung:
      'Der Ehemann behauptete, er sei um 18 Uhr heimgekommen und habe seine Frau leblos gefunden. Der Saugroboter speicherte jedoch mit Uhrzeit, wo er auf Hindernisse stieß: Seit 14:32 Uhr lag im Wohnzimmer etwas Großes im Weg. Um diese Zeit war der Mann nachweislich zu Hause.',
    stufe: 2,
  },
  {
    id: 38,
    titel: 'Vorsorge',
    text: 'Herr Arnold ließ seinen Grabstein zu Lebzeiten anfertigen – und verlor dadurch seine Rente.',
    loesung:
      'Der Steinmetz stellte den fertigen Stein mit Name und Geburtsjahr schon einmal auf der gekauften Grabstelle auf. Ein übereifriger Beamter der Rentenkasse sah ihn beim Besuch seiner Tante und meldete Herrn Arnold als verstorben. Es dauerte ein halbes Jahr, bis er beweisen konnte, dass er noch lebte.',
    stufe: 2,
  },
  {
    id: 39,
    titel: 'Die Zeitkapsel',
    text: 'Beim Öffnen einer Zeitkapsel wurde ein fünfzig Jahre alter Fall gelöst.',
    loesung:
      'Vor fünfzig Jahren legten die Dorfbewohner Briefe an die Zukunft in eine Kapsel. Einer schrieb darin, er habe den damaligen Bürgermeister die Kirchturmtreppe hinuntergestoßen – in der festen Annahme, bei der Öffnung längst tot zu sein. Er war achtundneunzig und saß bei der Feier in der ersten Reihe.',
    stufe: 2,
  },
  {
    id: 40,
    titel: 'Die sparsame Tür',
    text: 'Der Erfinder starb an seiner nützlichsten Erfindung.',
    loesung:
      'Er hatte eine Tür entwickelt, die sich zum Energiesparen selbst schließt und nur auf Knopfdruck öffnet. Er testete sie am Kühlraum seiner Werkstatt. Einen Griff an der Innenseite hielt er für überflüssig – bis in der Nacht der Strom ausfiel.',
    stufe: 2,
  },
  {
    id: 41,
    titel: 'Die Flut',
    text: 'Das Hochwasser spülte einen Sarg frei, und die Bank bekam ihr Geld zurück.',
    loesung:
      'Vor vierzig Jahren wurde nach einem Banküberfall einer der Täter angeblich krank und begraben. In Wahrheit war der Sarg voller Goldbarren, und die Bande wartete, bis Gras über die Sache gewachsen war. Das Hochwasser riss den alten Friedhofshang ab, bevor sie sich trauten, das Grab zu öffnen.',
    stufe: 2,
  },
  {
    id: 42,
    titel: 'Als Erster von Bord',
    text: 'Der Kapitän verließ als Erster sein Schiff, und niemand machte ihm einen Vorwurf.',
    loesung:
      'Es war die Seebestattung des Kapitäns selbst. Wie er es sich gewünscht hatte, wurde seine Urne zuerst dem Meer übergeben, noch vor dem Kranz. Seine alte Mannschaft salutierte an der Reling.',
    stufe: 1,
  },
  {
    id: 43,
    titel: 'Fieber am Gipfel',
    text: 'Die Wetterstation auf dem Gipfel meldete im Schneesturm plötzlich 38 Grad.',
    loesung:
      'Der einsame Wetterwart hatte hohes Fieber, und das einzige Thermometer der Station war der Außenfühler. Er holte ihn mit ins Bett, um seine Temperatur zu messen, und schlief erschöpft ein. Die Talstation vermutete einen Defekt und schickte einen Techniker – der fand einen schwer kranken Mann und brachte ihn ins Tal.',
    stufe: 3,
  },
  {
    id: 44,
    titel: 'Einmal quer durch die Stadt',
    text: 'Der Taxifahrer fuhr seinen Fahrgast die ganze Nacht durch die Stadt, ohne dass der sich je beschwerte.',
    loesung:
      'Der Fahrgast hatte beim Einsteigen gesagt: „Fahren Sie einfach, ich muss nachdenken." Kurz darauf starb er still auf der Rückbank. Der Fahrer hielt ihn für eingeschlafen und fuhr brav weiter, bis der Morgen graute. Die Rechnung ging an die Erben.',
    stufe: 1,
  },
  {
    id: 45,
    titel: 'Die falsche Truhe',
    text: 'Weil er seine Brille nicht fand, schläft Herr Frey seit einem Jahr in einem Sarg.',
    loesung:
      'Er wollte im Katalog eine hübsche Eichentruhe für sein Schlafzimmer bestellen und erwischte ohne Brille die Seite des Bestattungshauses. Als das Stück kam, war es für eine Rücksendung zu spät. Er fand es so bequem, dass er es seitdem als Bett benutzt.',
    stufe: 1,
  },
  {
    id: 46,
    titel: 'Glück von oben',
    text: 'Das Glückshufeisen über der Haustür wurde Herrn Dietz zum Verhängnis.',
    loesung:
      'Herr Dietz hatte das schwere Eisen selbst angebracht, mit einem einzigen, viel zu kurzen Nagel, weil er abergläubisch nichts an der Tür beschädigen wollte. Beim kräftigen Zuschlagen der Tür löste es sich und fiel ihm auf den Kopf.',
    stufe: 1,
  },
  {
    id: 47,
    titel: 'Ein Kunstwerk',
    text: 'Herr Pauli schlief am Strand ein und wachte als Kunstwerk auf.',
    loesung:
      'Direkt neben seinem Handtuch begann am Morgen ein Sandskulpturen-Wettbewerb. Ein Team bezog den schnarchenden Herrn Pauli kurzerhand als liegenden Riesen in seine Figur ein. Als er aufwachte, gratulierte ihm die Jury zum zweiten Platz.',
    stufe: 1,
  },
  {
    id: 48,
    titel: 'Die Puppe ruft',
    text: 'Die Puppe des Bauchredners rief um Hilfe, und fast alle lachten.',
    loesung:
      'Mitten in der Vorstellung bekam der Bauchredner einen allergischen Schock und konnte kaum noch atmen. Aus jahrzehntelanger Gewohnheit kam sein Hilferuf aus dem Mund der Puppe. Nur eine Ärztin in der ersten Reihe lachte nicht, sprang auf die Bühne und rettete ihn.',
    stufe: 2,
  },
  {
    id: 49,
    titel: 'Das Denkmal',
    text: 'Bei der Enthüllung seines Denkmals saß der Verstorbene in der ersten Reihe.',
    loesung:
      'Der „große Sohn der Stadt" hatte vor Jahren seinen Tod auf hoher See vorgetäuscht, um seinen Gläubigern zu entkommen. Die Eitelkeit war stärker: Er reiste mit falschem Bart zur Enthüllung an. Als die Blaskapelle sein Lieblingslied spielte, sang er als Einziger laut und textsicher mit.',
    stufe: 2,
  },
  {
    id: 50,
    titel: 'Die vierte Hochzeit',
    text: 'Die Witwe heiratete zum vierten Mal, und der Bestatter schickte Blumen mit einer Karte „Bis bald".',
    loesung:
      'Alle drei Ehemänner waren eines ganz natürlichen Todes gestorben – sie waren bei der Hochzeit jeweils über neunzig. Die Witwe hatte eine Schwäche für sehr alte Herren. Der Bestatter war längst Stammgast bei ihren Feiern und meinte es freundlich.',
    stufe: 1,
  },
  {
    id: 51,
    titel: 'Vierzig Jahre überfällig',
    text: 'Ein Buch kam vierzig Jahre zu spät in die Bibliothek zurück, und der Bibliothekar rief die Polizei.',
    loesung:
      'Laut Ausleihkarte hatte ein Herr Maier das Buch vor vierzig Jahren ausgeliehen, einen Tag vor seinem plötzlichen, ungeklärten Tod. Der Titel: „Seltene Pflanzengifte und ihre Wirkung". Zurückgebracht hatte es seine Witwe, die das Buch beim Entrümpeln gefunden hatte – und nicht damit rechnete, dass jemand die alte Karte las.',
    stufe: 3,
  },
  {
    id: 52,
    titel: 'Zwölf Füllungen',
    text: 'Der Zahnarzt sollte einen Toten anhand seiner Zähne erkennen – und stand danach selbst vor Gericht.',
    loesung:
      'Laut seiner Patientenakte hatte der Verstorbene zwölf Füllungen und zwei Kronen. Im Gebiss fand sich keine einzige. Der Zahnarzt hatte jahrelang Behandlungen abgerechnet, die es nie gegeben hatte.',
    stufe: 2,
  },
  {
    id: 53,
    titel: 'Eine Figur zu viel',
    text: 'Im Wachsfigurenkabinett bat eine Besucherin eine Figur um ein Autogramm – und die Figur rannte weg.',
    loesung:
      'Ein Einbrecher war bei der Kontrollrunde des Nachtwächters zwischen den Figuren in eine Pose erstarrt. Es klappte so gut, dass er sich bis zur Öffnung nicht mehr zu bewegen traute. Die Besucherin hielt ihn für einen berühmten Schauspieler.',
    stufe: 1,
  },
  {
    id: 54,
    titel: 'Die Vase vom Flohmarkt',
    text: 'Frau Lenz kaufte auf dem Flohmarkt eine Vase und bekam den Vorbesitzer gratis dazu.',
    loesung:
      'Die „Vase" war eine Urne, die bei einer Haushaltsauflösung versehentlich in die Trödelkiste gewandert war. Frau Lenz merkte es erst, als sie Tulpen hineinstellen wollte und der Deckel festgeschraubt war. Auf der Unterseite stand ein Name mit zwei Jahreszahlen.',
    stufe: 1,
  },
  {
    id: 55,
    titel: 'Sendung aus der Konserve',
    text: 'Die Hörer lauschten dem Radiomoderator noch eine Woche lang, obwohl er schon beerdigt war.',
    loesung:
      'Vor seinem Urlaub hatte er alle Sendungen einer Woche vorproduziert. Am ersten Urlaubstag starb er beim Tauchen. Der Sender spielte die Aufnahmen trotzdem ab, weil niemand wusste, wo er Bescheid geben sollte – inklusive des Witzes: „Wenn ich nächste Woche nicht zurück bin, hat mich ein Hai gefressen."',
    stufe: 2,
  },
  {
    id: 56,
    titel: 'Die Schwimmweste',
    text: 'Die Schwimmweste rettete dem Angler nicht das Leben, sondern kostete es ihn.',
    loesung:
      'Er war beim Eisangeln durch ein Loch im Eis gebrochen. Die Weste drückte ihn sofort nach oben – aber nicht ins Loch, sondern unter die geschlossene Eisdecke daneben. Ohne Weste hätte er zurück zur Öffnung tauchen können.',
    stufe: 3,
  },
  {
    id: 57,
    titel: 'Ein Gast zu viel',
    text: 'Auf dem Hochzeitsfoto war eine Frau zu sehen, die niemand eingeladen hatte – und der Bräutigam wurde kreidebleich.',
    loesung:
      'Die Frau im Hintergrund war die Ehefrau des Bräutigams – seine erste, von der er sich nie hatte scheiden lassen. Sie hatte die Hochzeitsanzeige in der Zeitung gelesen und wollte nur kurz gratulieren. Das Standesamt interessierte sich sehr für das Foto.',
    stufe: 1,
  },
  {
    id: 58,
    titel: 'Mit Senf',
    text: 'Weil ein Kunde Senf zur Wurst bestellte, platzte ein Alibi.',
    loesung:
      'Die Ehefrau sagte aus, ihr Mann habe um 14 Uhr wie jeden Tag an der Imbissbude gegessen, er müsse also danach verunglückt sein. Der Wurstverkäufer erinnerte sich zwar an den Mantel, aber der Mann hatte Senf verlangt. Sein Stammkunde hatte in zwanzig Jahren nie Senf gegessen – jemand hatte sich als er ausgegeben, um den Todeszeitpunkt zu verschieben.',
    stufe: 3,
  },
  {
    id: 59,
    titel: 'Die Kündigung',
    text: 'Herr Beck las seine eigene Todesanzeige und ging erleichtert frühstücken.',
    loesung:
      'Er kam aus seinem Vertrag mit dem Fitnessstudio nicht heraus – laut Kleingedrucktem endete er nur im Todesfall. Also gab er selbst eine Anzeige auf und schickte sie dem Studio. Am nächsten Tag kam die Kündigungsbestätigung mit herzlichem Beileid.',
    stufe: 1,
  },
  {
    id: 60,
    titel: 'Unter dem Apfelbaum',
    text: 'Ein Liebesbrief kam an, und die Empfängerin ließ sofort ihren Garten umgraben.',
    loesung:
      'Der Brief stammte von ihrem vor Jahren verstorbenen Mann, der ihn einem Notar zur goldenen Hochzeit anvertraut hatte. Darin stand: „Unter dem Apfelbaum liegt, was ich dir nie gesagt habe." Er hatte Banken misstraut und dort sein ganzes Erspartes vergraben.',
    stufe: 1,
  },
  {
    id: 61,
    titel: 'Stromausfall',
    text: 'Ein Eichhörnchen legte den ganzen Ort lahm und brachte einen Einbrecher hinter Gitter.',
    loesung:
      'Das Tier nagte im Umspannwerk an einem Kabel und löste einen Stromausfall aus. Die Bank verriegelte bei Stromausfall automatisch alle Türen. Der Einbrecher, der sich im Tresorraum befand, saß fest, bis die Polizei am Morgen aufschloss.',
    stufe: 2,
  },
  {
    id: 62,
    titel: 'Bescherung',
    text: 'Am Weihnachtsmorgen fand die Familie den Weihnachtsmann – im Kamin, und er war sehr unglücklich.',
    loesung:
      'Ein Einbrecher hatte sich als Weihnachtsmann verkleidet, damit ihn die Nachbarn auf dem Dach für einen Scherz hielten. Er blieb im engen Schornstein stecken. Sein Glück: Die Familie hatte in der Nacht kein Feuer gemacht.',
    stufe: 1,
  },
  {
    id: 63,
    titel: 'Der Hausbesuch',
    text: 'Die Ärztin kam zu spät zu ihrem Patienten, weil sie ihm vorher selbst das Leben gerettet hatte.',
    loesung:
      'Auf dem Weg zum Hausbesuch sah sie einen Mann im Park zusammenbrechen und belebte ihn wieder, bis der Rettungswagen kam. Es war ihr Patient, der ihr entgegengelaufen war, weil er es zu Hause nicht mehr aushielt. Als sie an seiner Wohnung klingelte, öffnete niemand – er lag da schon im Krankenhaus.',
    stufe: 3,
  },
  {
    id: 64,
    titel: 'Das Schweigen der Glocken',
    text: 'Die Kirchenglocken schwiegen an einem Sonntag, und dadurch wurde ein Verbrechen verhindert.',
    loesung:
      'Einbrecher hatten geplant, einen Tresor genau während des Mittagsläutens aufzubohren, damit der Lärm untergeht. Der Glöckner lag an diesem Sonntag mit Grippe im Bett. Ohne Glocken war das Bohren im ganzen Viertel zu hören, und ein Nachbar rief die Polizei.',
    stufe: 2,
  },
];
