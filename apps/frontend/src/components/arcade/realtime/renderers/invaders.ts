import { REALTIME_GAMES } from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { defaultKeyInput } from '../keys';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für Space Invaders.
 *
 * Die drei Angreifer sind eigene Pixelfiguren (Qualle, Zyklopenkrabbe,
 * Pilzkopf), je zwei Bilder im Takt des Marsches. Spiegelung der gezeichneten
 * Felder – siehe Kommentar in `steinbrecher.ts`.
 */

interface Shot {
  x: number;
  y: number;
  kind: number;
}

interface State {
  tick: number;
  over: boolean;
  score: number;
  lives: number;
  wave: number;
  aliens: number[];
  formX: number;
  formY: number;
  frame: number;
  playerX: number;
  shot: Shot | null;
  enemyShots: Shot[];
  bunkers: number[][];
  ufo: { x: number; dir: number } | null;
  dying: number;
  waveBreak: number;
  explosions: { x: number; y: number; ttl: number; kind: number; points: number }[];
  shotsFired: number;
  kills: number;
  marches: number;
  ufoHits: number;
  bunkerHits: number;
}

interface Snap {
  shots: number;
  kills: number;
  marches: number;
  ufoHits: number;
  lives: number;
  wave: number;
  ufo: boolean;
  over: boolean;
}

const logic = REALTIME_GAMES['invaders'];
if (!logic) throw new Error('invaders fehlt');

const W = 360;
const H = 420;
const COLS = 11;
const CELL_W = 26;
const CELL_H = 22;
const ROW_TYPE = [0, 1, 1, 2, 2];
const PLAYER_Y = 378;
const PLAYER_W = 26;
const GROUND_Y = 402;
const BUNKER_COLS = 22;
const BUNKER_ROWS = 16;
const BUNKER_Y = 316;
const UFO_Y = 40;

/** Eigene Pixelfiguren, je zwei Bilder. `#` = Pixel. */
const SPRITES: readonly (readonly (readonly string[])[])[] = [
  // Qualle
  [
    [
      '..####..',
      '.######.',
      '###..###',
      '###..###',
      '########',
      '.#.##.#.',
      '#..#..#.',
      '.#..#..#',
    ],
    [
      '..####..',
      '.######.',
      '###..###',
      '###..###',
      '########',
      '.#.##.#.',
      '.#..#..#',
      '#..#..#.',
    ],
  ],
  // Zyklopenkrabbe
  [
    [
      '##.......##',
      '#.#.....#.#',
      '..#######..',
      '.###...###.',
      '####.#.####',
      '#.#######.#',
      '..#.....#..',
      '.##.....##.',
    ],
    [
      '...........',
      '##.......##',
      '#.#######.#',
      '.###...###.',
      '####.#.####',
      '..#######..',
      '.#.......#.',
      '#.........#',
    ],
  ],
  // Pilzkopf
  [
    [
      '....####....',
      '..########..',
      '.##########.',
      '##..####..##',
      '############',
      '...##..##...',
      '..##....##..',
      '...#....#...',
    ],
    [
      '....####....',
      '..########..',
      '.##########.',
      '##..####..##',
      '############',
      '...##..##...',
      '..#..##..#..',
      '.#........#.',
    ],
  ],
];
const SPRITE_COLORS = [
  ['#f0abfc', '#c026d3'],
  ['#67e8f9', '#0891b2'],
  ['#bef264', '#4d7c0f'],
];

/** Sterne: feste Pseudozufallsfolge, damit der Himmel nicht flackert. */
const STARS = Array.from({ length: 60 }, (_, i) => ({
  x: (i * 97) % W,
  y: (i * 53 + ((i * i) % 31)) % (GROUND_Y - 10),
  s: 0.6 + ((i * 7) % 5) / 5,
  p: i * 0.7,
}));

function drawSprite(
  ctx: CanvasRenderingContext2D,
  rows: readonly string[],
  x: number,
  y: number,
  top: string,
  bottom: string,
): void {
  const g = ctx.createLinearGradient(0, y, 0, y + rows.length * 2);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  ctx.fillStyle = g;
  rows.forEach((row, r) => {
    for (let c = 0; c < row.length; c += 1) {
      if (row[c] === '#') ctx.fillRect(x + c * 2, y + r * 2, 2, 2);
    }
  });
}

function drawCannon(ctx: CanvasRenderingContext2D, x: number, time: number): void {
  const y = PLAYER_Y;
  ctx.shadowColor = '#34d399';
  ctx.shadowBlur = 12;
  const g = ctx.createLinearGradient(0, y, 0, y + 14);
  g.addColorStop(0, '#a7f3d0');
  g.addColorStop(1, '#059669');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - PLAYER_W / 2, y + 14);
  ctx.lineTo(x - PLAYER_W / 2, y + 8);
  ctx.lineTo(x - 6, y + 5);
  ctx.lineTo(x - 2, y);
  ctx.lineTo(x + 2, y);
  ctx.lineTo(x + 6, y + 5);
  ctx.lineTo(x + PLAYER_W / 2, y + 8);
  ctx.lineTo(x + PLAYER_W / 2, y + 14);
  ctx.closePath();
  ctx.fill();
  ctx.shadowBlur = 0;
  // Cockpit-Licht
  ctx.fillStyle = `rgba(254,240,138,${0.6 + 0.4 * Math.sin(time / 200)})`;
  ctx.fillRect(x - 1.5, y + 6, 3, 3);
}

function drawUfo(ctx: CanvasRenderingContext2D, x: number, time: number): void {
  ctx.shadowColor = '#f472b6';
  ctx.shadowBlur = 14;
  ctx.fillStyle = '#a5f3fc';
  ctx.beginPath();
  ctx.ellipse(x, UFO_Y + 3, 7, 6, 0, Math.PI, 0);
  ctx.fill();
  const g = ctx.createLinearGradient(0, UFO_Y + 2, 0, UFO_Y + 12);
  g.addColorStop(0, '#f9a8d4');
  g.addColorStop(1, '#be185d');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.ellipse(x, UFO_Y + 7, 14, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  for (let i = -2; i <= 2; i += 1) {
    const on = (Math.floor(time / 120) + i) % 2 === 0;
    ctx.fillStyle = on ? '#fef08a' : '#831843';
    ctx.fillRect(x + i * 5 - 1, UFO_Y + 6, 2, 2);
  }
}

function drawExplosion(ctx: CanvasRenderingContext2D, e: State['explosions'][number]): void {
  const colors = ['#fde68a', '#34d399', '#f472b6', '#fca5a5'];
  const color = colors[e.kind] ?? '#fde68a';
  const t = e.kind === 1 ? e.ttl / 40 : e.kind === 2 ? e.ttl / 60 : e.ttl / 16;
  const radius = (1 - t) * (e.kind === 1 ? 22 : 12) + 3;
  ctx.strokeStyle = color;
  ctx.globalAlpha = Math.max(0, Math.min(1, t + 0.2));
  ctx.lineWidth = 2;
  for (let k = 0; k < 8; k += 1) {
    const a = (k / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(e.x + Math.cos(a) * radius * 0.4, e.y + Math.sin(a) * radius * 0.4);
    ctx.lineTo(e.x + Math.cos(a) * radius, e.y + Math.sin(a) * radius);
    ctx.stroke();
  }
  if (e.kind === 2 && e.points > 0) {
    ctx.font = 'bold 13px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fbcfe8';
    ctx.fillText(String(e.points), e.x, e.y - 12);
  }
  ctx.globalAlpha = 1;
}

function centerText(
  ctx: CanvasRenderingContext2D,
  text: string,
  y: number,
  size: number,
  color: string,
): void {
  ctx.font = `800 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(2,6,12,0.85)';
  ctx.strokeText(text, W / 2, y);
  ctx.fillStyle = color;
  ctx.fillText(text, W / 2, y);
}

export const renderer: RealtimeRenderer<State> = {
  id: 'invaders',
  logic,
  view: { width: W, height: H },
  touch: 'horizontal',
  instructions:
    'Pfeil links/rechts (oder A/D) bewegt die Kanone, Leertaste schießt – immer nur ein Schuss gleichzeitig. Die Bunker schützen, gehen aber kaputt. Triff das UFO für Bonuspunkte.',

  keyInput(key, phase) {
    return defaultKeyInput(key, phase, true);
  },

  render(ctx, state, time) {
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#020617');
    bg.addColorStop(0.7, '#04221b');
    bg.addColorStop(1, '#063b2c');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    for (const star of STARS) {
      ctx.fillStyle = `rgba(209,250,229,${0.35 + 0.35 * Math.sin(time / 600 + star.p)})`;
      ctx.fillRect(star.x, star.y, star.s, star.s);
    }

    // Planetenrand am Boden
    ctx.fillStyle = '#065f46';
    ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    ctx.shadowColor = '#34d399';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#34d399';
    ctx.fillRect(0, GROUND_Y, W, 2);
    ctx.shadowBlur = 0;

    // Bunker
    state.bunkers.forEach((cells, b) => {
      const left = Math.round((W * (b + 1)) / 5) - (BUNKER_COLS * 2) / 2;
      const g = ctx.createLinearGradient(0, BUNKER_Y, 0, BUNKER_Y + BUNKER_ROWS * 2);
      g.addColorStop(0, '#6ee7b7');
      g.addColorStop(1, '#047857');
      ctx.fillStyle = g;
      for (let r = 0; r < BUNKER_ROWS; r += 1) {
        for (let c = 0; c < BUNKER_COLS; c += 1) {
          if (cells[r * BUNKER_COLS + c] === 1) ctx.fillRect(left + c * 2, BUNKER_Y + r * 2, 2, 2);
        }
      }
    });

    // Angreifer
    state.aliens.forEach((alive, i) => {
      if (alive !== 1) return;
      const row = Math.floor(i / COLS);
      const col = i % COLS;
      const type = ROW_TYPE[row] ?? 0;
      const frames = SPRITES[type];
      const rows = frames?.[state.frame] ?? frames?.[0];
      const colors = SPRITE_COLORS[type] ?? ['#fff', '#aaa'];
      if (!rows) return;
      const w = (rows[0]?.length ?? 8) * 2;
      const x = state.formX + col * CELL_W + CELL_W / 2 - w / 2;
      const y = state.formY + row * CELL_H;
      ctx.shadowColor = colors[1] ?? '#fff';
      ctx.shadowBlur = 6;
      drawSprite(ctx, rows, x, y, colors[0] ?? '#fff', colors[1] ?? '#aaa');
      ctx.shadowBlur = 0;
    });

    if (state.ufo) drawUfo(ctx, state.ufo.x, time);

    // Schüsse
    if (state.shot) {
      ctx.shadowColor = '#a7f3d0';
      ctx.shadowBlur = 8;
      ctx.fillStyle = '#ecfdf5';
      ctx.fillRect(state.shot.x - 1, state.shot.y, 2, 8);
      ctx.shadowBlur = 0;
    }
    for (const shot of state.enemyShots) {
      ctx.strokeStyle = shot.kind === 0 ? '#fda4af' : '#fde047';
      ctx.lineWidth = 2;
      ctx.beginPath();
      const wobble = Math.floor(shot.y / 4) % 2 === 0 ? 2 : -2;
      if (shot.kind === 0) {
        ctx.moveTo(shot.x, shot.y);
        ctx.lineTo(shot.x + wobble, shot.y + 3);
        ctx.lineTo(shot.x - wobble, shot.y + 6);
        ctx.lineTo(shot.x, shot.y + 8);
      } else {
        ctx.moveTo(shot.x, shot.y);
        ctx.lineTo(shot.x, shot.y + 8);
        ctx.moveTo(shot.x - 2, shot.y + 3 + wobble / 2);
        ctx.lineTo(shot.x + 2, shot.y + 3 + wobble / 2);
      }
      ctx.stroke();
    }

    if (state.dying === 0 && !state.over) drawCannon(ctx, state.playerX, time);
    else if (state.dying > 0 && Math.floor(time / 100) % 2 === 0) {
      ctx.globalAlpha = 0.5;
      drawCannon(ctx, state.playerX, time);
      ctx.globalAlpha = 1;
    }

    for (const e of state.explosions) drawExplosion(ctx, e);

    // Kopfzeile
    ctx.font = 'bold 14px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#a7f3d0';
    ctx.fillText(String(state.score).padStart(5, '0'), 10, 14);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#6ee7b7';
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.fillText(`Welle ${state.wave}`, W / 2, 14);
    for (let i = 0; i < Math.min(state.lives, 6); i += 1) {
      ctx.save();
      ctx.translate(W - 20 - i * 22, 14 - PLAYER_Y - 7);
      drawCannon(ctx, 0, 0);
      ctx.restore();
    }

    if (state.waveBreak > 0) {
      centerText(ctx, 'Welle geschafft!', 200, 26, '#34d399');
      centerText(ctx, `Welle ${state.wave + 1} rückt an …`, 234, 14, '#d1fae5');
    }
    if (state.over) {
      ctx.fillStyle = 'rgba(2,6,12,0.6)';
      ctx.fillRect(0, 0, W, H);
      centerText(ctx, 'Game Over', H / 2 - 20, 34, '#34d399');
      centerText(ctx, `${state.score} Punkte · Welle ${state.wave}`, H / 2 + 20, 15, '#d1fae5');
    }
  },

  snapshot(state): Snap {
    return {
      shots: state.shotsFired,
      kills: state.kills,
      marches: state.marches,
      ufoHits: state.ufoHits,
      lives: state.lives,
      wave: state.wave,
      ufo: state.ufo !== null,
      over: state.over,
    };
  },

  sounds(prev, next) {
    const a = prev as Snap;
    const b = next as Snap;
    if (b.over && !a.over) return ['lose'];
    const out: SfxName[] = [];
    if (b.lives < a.lives) out.push('explode');
    if (b.lives > a.lives) out.push('powerup');
    if (b.wave > a.wave) out.push('win');
    if (b.ufoHits > a.ufoHits) out.push('coin');
    else if (b.kills > a.kills) out.push('hit');
    if (b.shots > a.shots) out.push('shoot');
    // Der Marschtakt ist gegen Ende sehr schnell – nur jeder zweite Schritt klingt.
    if (b.marches > a.marches && b.marches % 2 === 0) out.push('tick');
    if (b.ufo && !a.ufo) out.push('turn');
    return out;
  },
};
