import {
  ARCADE_INPUT_DOWN,
  ARCADE_INPUT_LEFT,
  ARCADE_INPUT_RIGHT,
  ARCADE_INPUT_UP,
  REALTIME_GAMES,
  type RealtimeGame,
} from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { defaultKeyInput } from '../keys';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für 2048.
 *
 * Die Regel legt im Zustand ab, welche Kachel im letzten Zug wohin geglitten
 * ist. Die Animation merkt sich nur, **wann** sie den Zugzähler zuletzt
 * wechseln sah – alles andere liest sie aus dem Zustand. So bleibt die
 * Zeichenschicht dumm und kann nichts anders rechnen als das Backend.
 */

/** Spiegel der Zustandsform aus `@palantir/arcade` (das Paket exportiert nur die Regel). */
interface State {
  grid: number[];
  score: number;
  over: boolean;
  moves: number;
  best: number;
  slides: number[];
  merged: number[];
  spawned: number;
}

const logic = REALTIME_GAMES['zahlen2048'] as RealtimeGame<State> | undefined;
if (!logic) throw new Error('zahlen2048 fehlt');

const W = 360;
const H = 440;
const BOARD = 336;
const BX = (W - BOARD) / 2;
const BY = 88;
const GAP = 10;
const CELL = (BOARD - GAP * 5) / 4;
const SLIDE_MS = 110;
const POP_MS = 170;

/** Eigene Farbreihe: warm von Sand über Bernstein bis Glut, oben kühl-violett für die ganz großen Zahlen. */
const TILE_COLORS: Record<number, [string, string, string]> = {
  2: ['#fef3c7', '#fde68a', '#78350f'],
  4: ['#fde68a', '#fcd34d', '#78350f'],
  8: ['#fdba74', '#fb923c', '#ffffff'],
  16: ['#fb923c', '#f97316', '#ffffff'],
  32: ['#f87171', '#ef4444', '#ffffff'],
  64: ['#ef4444', '#dc2626', '#ffffff'],
  128: ['#fcd34d', '#f59e0b', '#ffffff'],
  256: ['#fbbf24', '#d97706', '#ffffff'],
  512: ['#facc15', '#ca8a04', '#ffffff'],
  1024: ['#a3e635', '#65a30d', '#ffffff'],
  2048: ['#34d399', '#059669', '#ffffff'],
};

function tileColors(value: number): [string, string, string] {
  return TILE_COLORS[value] ?? ['#c084fc', '#7c3aed', '#ffffff'];
}

function cellPos(index: number): { x: number; y: number } {
  const col = index % 4;
  const row = Math.floor(index / 4);
  return { x: BX + GAP + col * (CELL + GAP), y: BY + GAP + row * (CELL + GAP) };
}

let seenMoves = -1;
let seenAt = 0;

function drawTile(
  ctx: CanvasRenderingContext2D,
  value: number,
  x: number,
  y: number,
  scale: number,
  time: number,
): void {
  const [light, dark, ink] = tileColors(value);
  const size = CELL * scale;
  const ox = x + (CELL - size) / 2;
  const oy = y + (CELL - size) / 2;
  ctx.save();
  if (value >= 128) {
    ctx.shadowColor = dark;
    ctx.shadowBlur = 14 + Math.sin(time / 300) * 4;
  }
  const grad = ctx.createLinearGradient(ox, oy, ox, oy + size);
  grad.addColorStop(0, light);
  grad.addColorStop(1, dark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.roundRect(ox, oy, size, size, 10 * scale);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Glanzkante oben
  ctx.fillStyle = 'rgba(255,255,255,0.22)';
  ctx.beginPath();
  ctx.roundRect(ox + 4 * scale, oy + 3 * scale, size - 8 * scale, size * 0.28, 8 * scale);
  ctx.fill();
  const digits = String(value).length;
  const fontSize = (digits <= 2 ? 34 : digits === 3 ? 28 : digits === 4 ? 22 : 18) * scale;
  ctx.fillStyle = ink;
  ctx.font = `800 ${fontSize}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(value), ox + size / 2, oy + size / 2 + 1);
  ctx.restore();
}

function drawSparks(ctx: CanvasRenderingContext2D, index: number, q: number, color: string): void {
  const { x, y } = cellPos(index);
  const cx = x + CELL / 2;
  const cy = y + CELL / 2;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - q);
  ctx.fillStyle = color;
  for (let k = 0; k < 8; k += 1) {
    const a = (Math.PI * 2 * k) / 8 + index;
    const r = CELL * 0.45 + q * 26;
    ctx.beginPath();
    ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 3 * (1 - q) + 1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

export const renderer: RealtimeRenderer<State> = {
  id: 'zahlen2048',
  logic,
  view: { width: W, height: H },
  touch: 'dpad',
  instructions:
    'Pfeiltasten oder WASD schieben alle Kacheln. Gleiche Zahlen verschmelzen. Kein Zug mehr möglich – Spielende.',
  keyInput(key, phase) {
    const input = defaultKeyInput(key, phase);
    if (
      input === ARCADE_INPUT_UP ||
      input === ARCADE_INPUT_DOWN ||
      input === ARCADE_INPUT_LEFT ||
      input === ARCADE_INPUT_RIGHT
    ) {
      return input;
    }
    return null;
  },
  render(ctx, state, time) {
    if (state.moves !== seenMoves) {
      seenMoves = state.moves;
      seenAt = time;
    }
    const elapsed = time - seenAt;

    // Hintergrund
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#1c1206');
    bg.addColorStop(1, '#0b0b12');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    const halo = ctx.createRadialGradient(W / 2, BY + BOARD / 2, 40, W / 2, BY + BOARD / 2, 260);
    halo.addColorStop(0, 'rgba(245,158,11,0.18)');
    halo.addColorStop(1, 'rgba(245,158,11,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, W, H);

    // Kopfzeile
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fbbf24';
    ctx.font = '900 40px system-ui, sans-serif';
    ctx.fillText('2048', BX, 44);
    const box = (label: string, value: string, x: number) => {
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.beginPath();
      ctx.roundRect(x, 20, 92, 50, 10);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fcd34d';
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillText(label, x + 46, 34);
      ctx.fillStyle = '#ffffff';
      ctx.font = '800 20px system-ui, sans-serif';
      ctx.fillText(value, x + 46, 55);
    };
    box('PUNKTE', String(state.score), W - BX - 92 - 100);
    box('BESTE', String(state.best), W - BX - 92);

    // Brett
    ctx.fillStyle = '#2a1f14';
    ctx.beginPath();
    ctx.roundRect(BX, BY, BOARD, BOARD, 16);
    ctx.fill();
    ctx.strokeStyle = 'rgba(251,191,36,0.25)';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (let i = 0; i < 16; i += 1) {
      const { x, y } = cellPos(i);
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath();
      ctx.roundRect(x, y, CELL, CELL, 10);
      ctx.fill();
    }

    const sliding = state.slides.length > 0 && elapsed < SLIDE_MS;
    if (sliding) {
      const p = elapsed / SLIDE_MS;
      const ease = 1 - (1 - p) * (1 - p);
      for (let k = 0; k + 2 < state.slides.length; k += 3) {
        const from = cellPos(state.slides[k] as number);
        const to = cellPos(state.slides[k + 1] as number);
        const value = state.slides[k + 2] as number;
        drawTile(
          ctx,
          value,
          from.x + (to.x - from.x) * ease,
          from.y + (to.y - from.y) * ease,
          1,
          time,
        );
      }
    } else {
      const after = elapsed - (state.slides.length > 0 ? SLIDE_MS : 0);
      const q = Math.min(1, Math.max(0, after / POP_MS));
      for (let i = 0; i < 16; i += 1) {
        const value = state.grid[i] ?? 0;
        if (value === 0) continue;
        const { x, y } = cellPos(i);
        let scale = 1;
        if (i === state.spawned) scale = 0.3 + 0.7 * q;
        else if (state.merged.includes(i)) scale = 1 + 0.16 * Math.sin(Math.PI * q);
        drawTile(ctx, value, x, y, scale, time);
      }
      if (q < 1) {
        for (const i of state.merged) drawSparks(ctx, i, q, tileColors(state.grid[i] ?? 2)[0]);
      }
    }

    if (state.over) {
      ctx.fillStyle = 'rgba(11,11,18,0.72)';
      ctx.beginPath();
      ctx.roundRect(BX, BY, BOARD, BOARD, 16);
      ctx.fill();
      ctx.textAlign = 'center';
      ctx.fillStyle = '#fbbf24';
      ctx.font = '900 34px system-ui, sans-serif';
      ctx.fillText('Nichts geht mehr', W / 2, BY + BOARD / 2 - 18);
      ctx.fillStyle = '#ffffff';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText(
        `${state.score} Punkte · beste Kachel ${state.best}`,
        W / 2,
        BY + BOARD / 2 + 20,
      );
    }
  },
  snapshot: (state) => ({
    moves: state.moves,
    merged: state.merged.length,
    best: state.best,
    over: state.over,
  }),
  sounds(prev, next) {
    const a = prev as { moves: number; best: number; over: boolean };
    const b = next as { moves: number; merged: number; best: number; over: boolean };
    const out: SfxName[] = [];
    if (b.over && !a.over) {
      out.push('lose');
      return out;
    }
    if (b.moves === a.moves) return out;
    if (b.best > a.best && b.best >= 128) out.push(b.best >= 2048 ? 'win' : 'powerup');
    else if (b.merged > 0) out.push('score');
    else out.push('move');
    return out;
  },
};
