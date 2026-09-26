import { ARCADE_INPUT_CUSTOM, REALTIME_GAMES, type RealtimeGame } from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für Minesweeper.
 *
 * Gespielt wird nur durch Tippen: kurz = aufdecken, lang/rechts = Fahne. Auf
 * eine aufgedeckte Zahl getippt, deckt der Akkord die Nachbarn auf – das
 * erledigt die Regel, hier wird nur das Feld unter dem Finger bestimmt.
 */

interface State {
  phase: 'ready' | 'play' | 'won' | 'lost';
  mines: number[];
  counts: number[];
  cells: number[];
  ticks: number;
  opened: number;
  flags: number;
  exploded: number;
  actions: number;
}

const logic = REALTIME_GAMES['minesweeper'] as RealtimeGame<State> | undefined;
if (!logic) throw new Error('minesweeper fehlt');

const COLS = 10;
const ROWS = 14;
const MINES = 22;
const CELL = 34;
const BX = 10;
const BY = 64;
const W = BX * 2 + COLS * CELL;
const H = BY + ROWS * CELL + 12;

const HIDDEN = 0;
const OPEN = 1;
const FLAG = 2;

const NUMBER_COLORS = [
  '',
  '#60a5fa',
  '#4ade80',
  '#f87171',
  '#a78bfa',
  '#fb923c',
  '#22d3ee',
  '#f472b6',
  '#e2e8f0',
];

/** Wann welches Feld aufging – nur für das sanfte Einblenden, die Regel kennt das nicht. */
let openedAt: number[] = [];
let prevCells: number[] = [];
let endedAt = -1;
let prevPhase: State['phase'] = 'ready';

function trackOpenings(state: State, time: number): void {
  if (prevCells.length !== state.cells.length || (state.actions === 0 && state.phase === 'ready')) {
    prevCells = [...state.cells];
    openedAt = state.cells.map(() => -1e9);
  }
  for (let i = 0; i < state.cells.length; i += 1) {
    if (state.cells[i] === OPEN && prevCells[i] !== OPEN) openedAt[i] = time;
  }
  prevCells = [...state.cells];
  if (state.phase !== prevPhase) {
    if (state.phase === 'won' || state.phase === 'lost') endedAt = time;
    prevPhase = state.phase;
  }
}

function drawFlag(ctx: CanvasRenderingContext2D, x: number, y: number, time: number): void {
  const wave = Math.sin(time / 220 + x) * 1.5;
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(x + 15, y + 8, 2.5, 19);
  ctx.fillStyle = '#94a3b8';
  ctx.fillRect(x + 10, y + 26, 13, 3);
  ctx.fillStyle = '#ef4444';
  ctx.beginPath();
  ctx.moveTo(x + 17.5, y + 7);
  ctx.quadraticCurveTo(x + 23, y + 10 + wave, x + 28, y + 12);
  ctx.lineTo(x + 17.5, y + 18);
  ctx.closePath();
  ctx.fill();
}

function drawMine(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  time: number,
  hot: boolean,
): void {
  ctx.save();
  if (hot) {
    ctx.shadowColor = '#f97316';
    ctx.shadowBlur = 16 + Math.sin(time / 90) * 6;
  }
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 2.5;
  for (let k = 0; k < 4; k += 1) {
    const a = (Math.PI / 4) * k;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(a) * 11, cy - Math.sin(a) * 11);
    ctx.lineTo(cx + Math.cos(a) * 11, cy + Math.sin(a) * 11);
    ctx.stroke();
  }
  const g = ctx.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, 9);
  g.addColorStop(0, '#64748b');
  g.addColorStop(1, '#0f172a');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.beginPath();
  ctx.arc(cx - 3, cy - 3, 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Kleines Gesicht in der Kopfzeile – eigene Zeichnung, zeigt den Spielstand. */
function drawFace(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  phase: State['phase'],
  time: number,
): void {
  const g = ctx.createRadialGradient(cx - 5, cy - 6, 2, cx, cy, 20);
  g.addColorStop(0, '#fde68a');
  g.addColorStop(1, '#f59e0b');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 18, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#451a03';
  ctx.strokeStyle = '#451a03';
  ctx.lineWidth = 2.2;
  if (phase === 'lost') {
    for (const ex of [-6, 6]) {
      ctx.beginPath();
      ctx.moveTo(cx + ex - 3, cy - 7);
      ctx.lineTo(cx + ex + 3, cy - 1);
      ctx.moveTo(cx + ex + 3, cy - 7);
      ctx.lineTo(cx + ex - 3, cy - 1);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(cx, cy + 10, 5, Math.PI * 1.1, Math.PI * 1.9);
    ctx.stroke();
    return;
  }
  if (phase === 'won') {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(cx - 12, cy - 8, 24, 6);
    ctx.beginPath();
    ctx.arc(cx, cy + 3, 8, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
    return;
  }
  const blink = Math.floor(time / 2400) % 5 === 0 && time % 2400 < 140;
  for (const ex of [-6, 6]) {
    ctx.beginPath();
    if (blink) ctx.fillRect(cx + ex - 3, cy - 4, 6, 1.6);
    else ctx.arc(cx + ex, cy - 4, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy + 2, 8, 0.2 * Math.PI, 0.8 * Math.PI);
  ctx.stroke();
}

function digitBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  text: string,
  color: string,
  label: string,
): void {
  ctx.fillStyle = '#020617';
  ctx.beginPath();
  ctx.roundRect(x, 12, 92, 40, 8);
  ctx.fill();
  ctx.strokeStyle = 'rgba(148,163,184,0.3)';
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = 'rgba(148,163,184,0.7)';
  ctx.font = '600 9px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(label, x + 8, 22);
  ctx.fillStyle = color;
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.font = '700 22px ui-monospace, monospace';
  ctx.textAlign = 'right';
  ctx.fillText(text, x + 84, 40);
  ctx.shadowBlur = 0;
}

export const renderer: RealtimeRenderer<State> = {
  id: 'minesweeper',
  logic,
  view: { width: W, height: H },
  touch: 'pointer',
  instructions:
    'Tippen/Linksklick deckt auf, lang drücken/Rechtsklick setzt eine Fahne. Tipp auf eine Zahl mit passend vielen Fahnen deckt die Nachbarn auf.',
  keyInput: () => null,
  pointerInput(pointer, state) {
    if (state.phase === 'won' || state.phase === 'lost') return null;
    const col = Math.floor((pointer.x - BX) / CELL);
    const row = Math.floor((pointer.y - BY) / CELL);
    if (col < 0 || row < 0 || col >= COLS || row >= ROWS) return null;
    const cell = row * COLS + col;
    return ARCADE_INPUT_CUSTOM + cell * 2 + (pointer.button === 2 ? 1 : 0);
  },
  render(ctx, state, time) {
    trackOpenings(state, time);
    const over = state.phase === 'won' || state.phase === 'lost';

    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, '#111827');
    bg.addColorStop(1, '#0b1020');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Kopfzeile
    ctx.textBaseline = 'middle';
    digitBox(
      ctx,
      BX,
      String(Math.max(-99, MINES - state.flags)).padStart(3, '0'),
      '#f87171',
      'MINEN',
    );
    const seconds = Math.min(999, Math.floor(state.ticks / 10));
    digitBox(ctx, W - BX - 92, String(seconds).padStart(3, '0'), '#fbbf24', 'ZEIT');
    drawFace(ctx, W / 2, 32, state.phase, time);

    // Feld
    for (let i = 0; i < COLS * ROWS; i += 1) {
      const x = BX + (i % COLS) * CELL;
      const y = BY + Math.floor(i / COLS) * CELL;
      const cell = state.cells[i];
      const isMine = state.mines[i] === 1;
      if (cell === OPEN) {
        const age = time - (openedAt[i] ?? -1e9);
        const fade = Math.min(1, Math.max(0, age / 180));
        ctx.fillStyle = i === state.exploded ? '#7f1d1d' : '#1e293b';
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        if (fade < 1) {
          ctx.fillStyle = `rgba(148,163,184,${0.45 * (1 - fade)})`;
          ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
        }
        if (isMine) {
          drawMine(ctx, x + CELL / 2, y + CELL / 2, time, i === state.exploded);
        } else {
          const n = state.counts[i] ?? 0;
          if (n > 0) {
            ctx.fillStyle = NUMBER_COLORS[n] ?? '#fff';
            ctx.font = '800 19px system-ui, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(String(n), x + CELL / 2, y + CELL / 2 + 1);
          }
        }
        continue;
      }
      // Verdeckt oder Fahne: erhabene Kachel
      const g = ctx.createLinearGradient(x, y, x, y + CELL);
      g.addColorStop(0, '#64748b');
      g.addColorStop(1, '#475569');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(x + 1.5, y + 1.5, CELL - 3, CELL - 3, 5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x + 4, y + 3, CELL - 8, 3);
      if (cell === FLAG) {
        drawFlag(ctx, x, y, time);
        if (state.phase === 'lost' && !isMine) {
          ctx.strokeStyle = '#fbbf24';
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(x + 7, y + 7);
          ctx.lineTo(x + CELL - 7, y + CELL - 7);
          ctx.moveTo(x + CELL - 7, y + 7);
          ctx.lineTo(x + 7, y + CELL - 7);
          ctx.stroke();
        }
      } else if (cell === HIDDEN && state.phase === 'lost' && isMine) {
        const delay = ((i * 37) % 17) * 45;
        if (time - endedAt > delay) drawMine(ctx, x + CELL / 2, y + CELL / 2, time, false);
      }
    }

    // Druckwelle nach der Explosion
    if (state.phase === 'lost' && state.exploded >= 0) {
      const age = (time - endedAt) / 700;
      if (age < 1) {
        const cx = BX + (state.exploded % COLS) * CELL + CELL / 2;
        const cy = BY + Math.floor(state.exploded / COLS) * CELL + CELL / 2;
        ctx.save();
        ctx.globalAlpha = 1 - age;
        ctx.strokeStyle = '#fb923c';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, 10 + age * 160, 0, Math.PI * 2);
        ctx.stroke();
        for (let k = 0; k < 14; k += 1) {
          const a = (Math.PI * 2 * k) / 14;
          ctx.fillStyle = k % 2 === 0 ? '#fbbf24' : '#ef4444';
          ctx.beginPath();
          ctx.arc(
            cx + Math.cos(a) * age * 90,
            cy + Math.sin(a) * age * 90,
            4 * (1 - age) + 1,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.restore();
      }
    }

    if (state.phase === 'ready') {
      ctx.fillStyle = 'rgba(226,232,240,0.85)';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Tippe irgendwo – der erste Tipp ist sicher.', W / 2, H - 6);
    }

    if (over && time - endedAt > 600) {
      const won = state.phase === 'won';
      ctx.fillStyle = 'rgba(2,6,23,0.7)';
      ctx.beginPath();
      ctx.roundRect(BX + 20, BY + 170, W - 2 * BX - 40, 120, 16);
      ctx.fill();
      ctx.strokeStyle = won ? '#4ade80' : '#f87171';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.textAlign = 'center';
      ctx.fillStyle = won ? '#4ade80' : '#f87171';
      ctx.font = '900 28px system-ui, sans-serif';
      ctx.fillText(won ? 'Feld geräumt!' : 'Bumm!', W / 2, BY + 212);
      ctx.fillStyle = '#e2e8f0';
      ctx.font = '600 15px system-ui, sans-serif';
      ctx.fillText(
        won ? `${seconds} Sekunden · ${logic.score(state)} Punkte` : 'Diesmal leider keine Punkte.',
        W / 2,
        BY + 250,
      );
    }
  },
  snapshot: (state) => ({ phase: state.phase, flags: state.flags, opened: state.opened }),
  sounds(prev, next) {
    const a = prev as { phase: string; flags: number; opened: number };
    const b = next as { phase: string; flags: number; opened: number };
    const out: SfxName[] = [];
    if (b.phase === 'lost' && a.phase !== 'lost') out.push('explode');
    else if (b.phase === 'won' && a.phase !== 'won') out.push('win');
    else if (b.opened > a.opened) out.push(b.opened - a.opened > 4 ? 'line' : 'click');
    else if (b.flags !== a.flags) out.push('place');
    return out;
  },
};
