import ffmpeg from 'ffmpeg-static';
import { Kino } from './kino.mjs';

const k = await Kino.oeffnen({ ffmpeg });
await k.szene('motion-probe');

// Die Streuung im Hintergrund – wie im Beispielvideo: verschiedene Größen,
// teils unscharf, alle leicht driftend.
k.kachelnSetzen([
  {
    bild: 'serverkarte',
    x: 330,
    y: 250,
    breite: 430,
    drehung: -3,
    unschaerfe: 2.5,
    deckkraft: 0.5,
    ebene: 1,
  },
  {
    bild: 'konsole',
    x: 1560,
    y: 300,
    breite: 520,
    drehung: 2.5,
    unschaerfe: 3.5,
    deckkraft: 0.42,
    ebene: 1,
  },
  {
    bild: 'messwerte',
    x: 980,
    y: 120,
    breite: 760,
    drehung: 0,
    unschaerfe: 1.5,
    deckkraft: 0.55,
    ebene: 2,
  },
  {
    bild: 'handy-uebersicht',
    x: 250,
    y: 830,
    breite: 210,
    drehung: 4,
    unschaerfe: 2,
    deckkraft: 0.45,
    ebene: 1,
  },
  {
    bild: 'erfolge',
    x: 1520,
    y: 880,
    breite: 600,
    drehung: -2,
    unschaerfe: 4,
    deckkraft: 0.38,
    ebene: 1,
  },
  {
    bild: 'spielerkarte',
    x: 900,
    y: 960,
    breite: 700,
    drehung: 1.5,
    unschaerfe: 1,
    deckkraft: 0.5,
    ebene: 2,
  },
]);

await k.aufblenden(600);
await k.tippen('Server für die Runde.', { halten: 700 });
await k.titelAus();

// Eine Kachel kommt nach vorn und wird gescannt.
k.fahrtStarten(1400, (t) => {
  k.kachel(0, {
    x: 330 + (960 - 330) * t,
    y: 250 + (520 - 250) * t,
    breite: 430 + (620 - 430) * t,
    drehung: -3 + 3 * t,
    unschaerfe: 2.5 * (1 - t),
    deckkraft: 0.5 + 0.5 * t,
    glanz: t,
    ebene: 5,
  });
});
await k.halten(1500);
await k.scanEin({ x: 960, y: 520, breite: 660, hoehe: 580 });
await k.halten(900);
await k.scanAus();
await k.abblenden(600);
await k.schnitt();
await k.schliessen();
console.log('\nfertig');
