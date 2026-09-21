/**
 * Das Drehbuch des Motion-Films – die zweite der drei Fassungen.
 *
 *     node motion/film.mjs                 # alle Abschnitte
 *     node motion/film.mjs 21-koennen      # nur diesen
 *
 * Hier wird **nichts aufgenommen**: Der Film besteht aus den Standbildern in
 * `motion/bilder/`, inszeniert auf der Bühne des {@link Kino}. Die echte
 * Bildschirmaufnahme ist die andere Fassung (`aufnahme/aufnehmen.mjs`); die
 * dritte mischt beide.
 *
 * **Warum vier Abschnitte und nicht ein Stück.** Jeder Abschnitt wird ein
 * eigener Clip in `aufnahmen/`. Der Schnitt kann sie dadurch einzeln
 * verwenden – die Mischfassung nimmt zum Beispiel nur den Auftakt und den
 * Abbinder und setzt dazwischen echtes Panel-Material.
 *
 * **Der Takt.** Geschnitten wird auf die Musik: 172 Schläge je Minute, also
 * ein Viervierteltakt alle 1,395 Sekunden. Jeder Schlag im Bild – Blitz, Stoß,
 * Textwechsel – sitzt auf einem Taktanfang, nicht irgendwo dazwischen. Deshalb
 * stehen hier fast keine krummen Millisekundenwerte, sondern Vielfache von
 * {@link TAKT}.
 */

import ffmpeg from 'ffmpeg-static';
import { Kino, linear } from './kino.mjs';

/** Ein Viervierteltakt bei 172 bpm – siehe `schnitt/musik.mjs`. */
const TAKT = (60_000 / 172) * 4;
/** `takte(2)` = zwei Takte in Millisekunden. */
const takte = (n) => Math.round(TAKT * n);

// ---------------------------------------------------------------------------
// Die Streuung im Hintergrund
// ---------------------------------------------------------------------------

/**
 * Die Kacheln, die den ganzen Film über hinten schweben.
 *
 * Sie stehen bewusst **unscharf und halb durchsichtig** da: Sie sind Textur,
 * nicht Inhalt. Was gerade gemeint ist, kommt nach vorn (siehe
 * {@link vorholen}) – alles andere bleibt Hintergrund. Ohne diesen Abstand
 * sieht der Film aus wie eine Bildschirmschoner-Collage, in der nichts wichtig
 * ist, weil alles gleich laut ist.
 *
 * Die Reihenfolge ist die Kachelnummer und wird unten über {@link K}
 * angesprochen – nicht über den Bildnamen, weil dasselbe Bild zweimal
 * vorkommen darf.
 */
const HINTERGRUND = [
  {
    bild: 'uebersicht',
    x: 340,
    y: 300,
    breite: 700,
    drehung: -3,
    unschaerfe: 2.5,
    deckkraft: 0.62,
  },
  { bild: 'konsole', x: 1620, y: 260, breite: 620, drehung: 3, unschaerfe: 3, deckkraft: 0.55 },
  {
    bild: 'assistent',
    x: 1660,
    y: 840,
    breite: 700,
    drehung: -2,
    unschaerfe: 3.5,
    deckkraft: 0.48,
  },
  { bild: 'erfolge', x: 280, y: 870, breite: 640, drehung: 2.5, unschaerfe: 3, deckkraft: 0.52 },
  {
    bild: 'handy-uebersicht',
    x: 960,
    y: 190,
    breite: 200,
    drehung: 0,
    unschaerfe: 2,
    deckkraft: 0.42,
  },
  { bild: 'sicherungen', x: 960, y: 1000, breite: 780, drehung: 0, unschaerfe: 4, deckkraft: 0.38 },
];

/** Namen für die Kachelplätze – `kachel(3)` sagt sonst niemandem etwas. */
const K = { links: 0, rechts: 1, rechtsUnten: 2, linksUnten: 3, handy: 4, unten: 5 };

/**
 * Der siebte Platz: die Kachel, die gerade dran ist.
 *
 * Sie liegt **über** der Streuung und wird für jeden Beat neu belegt. Ein
 * eigener Platz statt „eine der sechs nach vorn holen": So bleibt die
 * Streuung unangetastet stehen, und der Wechsel von Beat zu Beat ist ein
 * Schnitt, kein Umräumen.
 */
const HELD = 6;

// ---------------------------------------------------------------------------
// Die Beats des Hauptteils
// ---------------------------------------------------------------------------

/**
 * Was das Panel kann – ein Beat je Sache.
 *
 * `kopf` steht groß, `zeile` klein darunter. Der Ton ist der abgemachte:
 * frech im Zwischentext, nüchtern in der Sache. Kein Beat behauptet etwas,
 * das die Aufnahmefassung nicht auch wirklich zeigt.
 *
 * `breite` ist die Breite der Heldenkachel; `y` ihre Mitte. Beides hängt am
 * Seitenverhältnis des Bildes: Die breiten Streifen (`messwerte`) vertragen
 * 1500 Punkte, ein volles Fenster nur rund 820.
 */
const BEATS = [
  {
    bild: 'assistent',
    breite: 900,
    y: 700,
    titelY: 250,
    kopf: 'Server anlegen.',
    zeile: 'Vier Schritte. Kein Ticket, keine Wartezeit.',
  },
  {
    bild: 'serverkarte',
    breite: 700,
    y: 690,
    titelY: 250,
    kopf: 'Starten. Stoppen.',
    zeile: 'Ein Klick – den Rest macht der Homeserver.',
  },
  {
    /*
     * Das höchste Bild der Reihe (Verhältnis 0,79): Bei 1000 Punkten Breite
     * liefe es unten aus dem Bild und läge oben auf der Überschrift. 820 bei
     * tieferer Mitte lässt beiden Platz.
     */
    bild: 'konsole',
    breite: 820,
    y: 715,
    titelY: 200,
    kopf: 'Konsole.',
    zeile: 'Im Browser. SSH bleibt heute zu.',
  },
  {
    bild: 'messwerte',
    breite: 1500,
    y: 660,
    titelY: 300,
    kopf: 'Alles gemessen.',
    zeile: 'CPU, Speicher, Ping, Spieler – live vom eigenen Blech.',
    // Ein flacher Streifen: Die Unterzeile sitzt dichter darunter.
    zeileY: 780,
  },
  {
    bild: 'sicherungen',
    breite: 900,
    y: 700,
    titelY: 250,
    kopf: 'Sicherungen.',
    zeile: 'Auf Knopfdruck oder nach Plan. Auch um drei Uhr nachts.',
  },
  {
    bild: 'handy-uebersicht',
    breite: 310,
    y: 705,
    titelY: 190,
    kopf: 'Auch vom Sofa.',
    zeile: 'Dasselbe Panel, nur schmaler.',
  },
  {
    bild: 'nachrichten',
    breite: 900,
    y: 700,
    titelY: 250,
    kopf: 'Die Runde redet mit.',
    zeile: 'Nachrichten, Ankündigungen, Benachrichtigungen – im Panel.',
  },
  {
    bild: 'arcade',
    breite: 900,
    y: 700,
    titelY: 250,
    kopf: 'Arcade.',
    zeile: 'Weil Warten auf den Serverstart auch Zeit ist.',
  },
  {
    bild: 'erfolge',
    breite: 900,
    y: 700,
    titelY: 250,
    kopf: 'Erfolge.',
    zeile: 'Ja, fürs Hosten. Nein, uns ist das nicht peinlich.',
  },
];

/** Die drei Sätze des hellen Teils – was es hier eben *nicht* gibt. */
const OHNE = ['Kein Abo.', 'Keine Slot-Preise.', 'Keine fremde Firma.'];

// ---------------------------------------------------------------------------
// Bausteine
// ---------------------------------------------------------------------------

/** Die Streuung setzen und den leeren Heldenplatz dahinter anlegen. */
function buehneStellen(k, { held = 'uebersicht' } = {}) {
  k.kachelnSetzen([
    ...HINTERGRUND,
    // Platz {@link HELD}: vorerst unsichtbar, gleich belegt.
    { bild: held, x: 960, y: 700, breite: 900, drehung: 0, deckkraft: 0, ebene: 8, driftWeite: 4 },
  ]);
}

/**
 * Einen Beat spielen: Kachel herein, Kopf, Zeile, Schlag, weiter.
 *
 * Die Kachel kommt **von unten und leicht zu groß** herein und setzt sich –
 * das liest sich als „hier, schau", während ein Einblenden auf der Stelle
 * nach Diashow aussieht.
 */
async function beat(k, b, { dauer = takte(2) } = {}) {
  const ziel = { x: 960, y: b.y, breite: b.breite };
  k.kachel(HELD, {
    bild: k.bild(b.bild),
    x: ziel.x,
    y: ziel.y + 60,
    breite: ziel.breite * 1.06,
    deckkraft: 0,
    ebene: 8,
    glanz: 0.25,
  });

  k.fahrtStarten(520, (t) => {
    k.kachel(HELD, {
      y: ziel.y + 60 * (1 - t),
      breite: ziel.breite * (1.06 - 0.06 * t),
      deckkraft: t,
    });
  });

  await k.titelEin(b.kopf, { dauer: 260, groesse: b.groesse ?? 104, y: b.titelY });
  await k.zeileEin(b.zeile, { dauer: 240, y: b.zeileY ?? b.titelY + 150 });
  await k.halten(Math.max(0, dauer - 500 - 300));
  await k.schlag({ staerke: 0.05, hoehe: 0.7 });
  k.zustand.titel = null;
  k.zustand.zeile = null;
}

// ---------------------------------------------------------------------------
// Die Abschnitte
// ---------------------------------------------------------------------------

const ABSCHNITTE = [
  // -------------------------------------------------------------------------
  {
    name: '20-auftakt',
    async lauf(k) {
      buehneStellen(k);
      // Ganz hinten anfangen: Die Streuung liegt zunächst weiter weg und
      // rückt über den ganzen Auftakt heran. Das ist die einzige lange
      // Bewegung des Films – danach wird nur noch geschnitten.
      for (let i = 0; i < HINTERGRUND.length; i += 1) {
        const h = HINTERGRUND[i];
        k.kachel(i, { breite: h.breite * 0.82, unschaerfe: h.unschaerfe + 3, deckkraft: 0 });
        k.fahrtStarten(
          takte(6),
          (t) => {
            k.kachel(i, {
              breite: h.breite * (0.82 + 0.18 * t),
              unschaerfe: h.unschaerfe + 3 * (1 - t),
              deckkraft: h.deckkraft * Math.min(1, t * 2.2),
            });
          },
          linear,
        );
      }

      await k.aufblenden(400);
      await k.tippen('Ein Gameserver.', { proZeichen: 46, y: 440 });
      await k.halten(takte(1));

      // Ab hier harte Wechsel auf den Takt – kein Auf- und Abblenden mehr.
      for (const satz of ['Auf deinem Rechner.', 'Nach deinen Regeln.']) {
        await k.schlag({ staerke: 0.06 });
        k.zustand.titel = null;
        await k.titelEin(satz, { dauer: 200, y: 440 });
        await k.halten(takte(1.5));
      }

      await k.schlag({ staerke: 0.08, hoehe: 0.95 });
      await k.titelAus(200);
      // Als Titel, nicht als Unterzeile: Der Satz steht hier allein im Bild,
      // und die Unterzeile ist für Text unter einer Überschrift gemacht – für
      // sich genommen sieht sie aus, als fehle etwas darüber.
      await k.titelEin('Palantir – das Panel für die eigene Maschine.', {
        dauer: 300,
        groesse: 62,
        y: 500,
      });
      await k.halten(takte(1.5));
      await k.titelAus(260);
      await k.abblenden(300);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '21-koennen',
    async lauf(k) {
      buehneStellen(k, { held: BEATS[0].bild });
      await k.aufblenden(260);
      for (const b of BEATS) await beat(k, b);
      await k.abblenden(300);
    },
  },

  // -------------------------------------------------------------------------
  {
    /*
     * Der helle Teil.
     *
     * Ein Wechsel der Polarität mitten im Film ist der stärkste Schnitt, den
     * dieses Werkzeug hat – deshalb steht er an der einen Stelle, an der es um
     * etwas anderes geht als um Funktionen: was es hier *nicht* gibt.
     */
    name: '22-ohne',
    async lauf(k) {
      buehneStellen(k);
      // Im Hellen stören die dunklen Kacheln; sie treten zurück.
      for (let i = 0; i < HINTERGRUND.length; i += 1) {
        k.kachel(i, { deckkraft: HINTERGRUND[i].deckkraft * 0.45, unschaerfe: 8 });
      }
      k.zustand.vignette = 0.12;

      await k.aufblenden(260);
      await k.schlag({ staerke: 0.07, hoehe: 1 });
      await k.grundWechseln(1, 160);

      for (const satz of OHNE) {
        await k.titelEin(satz, { dauer: 180, y: 440, dunkel: true });
        await k.halten(takte(1) - 180);
        await k.schlag({ staerke: 0.05, farbe: '#ffffff', hoehe: 0.9 });
        k.zustand.titel = null;
      }

      // Auch hier als Titel: Der Satz steht allein – siehe Auftakt.
      await k.titelEin('Einmal aufsetzen. Dann gehört sie euch.', {
        dauer: 240,
        groesse: 62,
        y: 500,
        dunkel: true,
      });
      await k.halten(takte(1.5));
      await k.titelAus(200);

      // Und zurück ins Dunkle – auf denselben Schlag.
      await k.schlag({ staerke: 0.08, hoehe: 1 });
      await k.grundWechseln(0, 160);
      k.zustand.vignette = 0.25;
      await k.halten(takte(0.5));
      await k.abblenden(300);
    },
  },

  // -------------------------------------------------------------------------
  {
    name: '23-marke',
    async lauf(k) {
      buehneStellen(k);
      await k.aufblenden(300);

      // Die Streuung fällt nach hinten weg, damit die Marke allein steht.
      k.fahrtStarten(takte(2), (t) => {
        for (let i = 0; i < HINTERGRUND.length; i += 1) {
          const h = HINTERGRUND[i];
          k.kachel(i, {
            breite: h.breite * (1 - 0.12 * t),
            unschaerfe: h.unschaerfe + 10 * t,
            deckkraft: h.deckkraft * (1 - t),
          });
        }
      });
      await k.halten(takte(1));
      await k.schlag({ staerke: 0.07, hoehe: 0.9 });

      await k.logoZeigen({
        zeile: 'Selbst gehostet. Für die eigene Runde.',
        dauer: 520,
        halten: takte(2),
      });
      await k.zeileEin('github.com/nightriderp/Palantir_Panel', { y: 880 });
      await k.halten(takte(1.5));
      await k.abblenden(700);
    },
  },
];

// ---------------------------------------------------------------------------
// Lauf
// ---------------------------------------------------------------------------

async function main() {
  const gewuenscht = process.argv.slice(2);
  const liste =
    gewuenscht.length === 0 ? ABSCHNITTE : ABSCHNITTE.filter((a) => gewuenscht.includes(a.name));
  if (liste.length === 0) {
    console.error(`Unbekannt. Bekannt sind:\n  ${ABSCHNITTE.map((a) => a.name).join('\n  ')}`);
    process.exit(2);
  }

  const k = await Kino.oeffnen({ ffmpeg });
  try {
    for (const abschnitt of liste) {
      await k.szene(abschnitt.name);
      await abschnitt.lauf(k);
      await k.schnitt();
    }
  } finally {
    await k.schliessen();
  }

  console.log('\n\nFertige Abschnitte:');
  for (const clip of k.geschrieben) {
    console.log(`  ${clip.name}  ${(clip.bilder / 30).toFixed(1)} s`);
  }
}

main().catch((fehler) => {
  console.error('\nMotion-Film abgebrochen:', fehler.message);
  process.exit(1);
});
