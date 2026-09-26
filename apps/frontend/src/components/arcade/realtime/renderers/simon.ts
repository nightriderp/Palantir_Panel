import {
  ARCADE_INPUT_CUSTOM,
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
 * Zeichenschicht für Simon: vier Ringsegmente als Raute (oben, rechts, unten,
 * links), damit Pfeiltasten und Tippen dieselbe Anordnung haben.
 *
 * Eingaben gibt es nur in der Eingabephase. Die Regel würde Tipps während des
 * Vorspielens ohnehin verwerfen; sie gar nicht erst aufzuzeichnen hält das
 * Band klein.
 */

interface State {
  phase: 'show' | 'input' | 'over';
  seq: number[];
  t: number;
  idx: number;
  rounds: number;
  lit: number;
  flashes: number;
  presses: number;
  pressed: number;
  expected: number;
  reason: '' | 'falsch' | 'zeit';
}

const logic = REALTIME_GAMES['simon'] as RealtimeGame<State> | undefined;
if (!logic) throw new Error('simon fehlt');

const W = 360;
const H = 420;
const CX = W / 2;
const CY = 236;
const R_OUT = 158;
const R_IN = 62;
const GAP = 0.06;
const INPUT_TIMEOUT_TICKS = 100;

const PADS = [
  { base: '#15803d', lit: '#4ade80', glow: '#22c55e' },
  { base: '#b91c1c', lit: '#f87171', glow: '#ef4444' },
  { base: '#1d4ed8', lit: '#60a5fa', glow: '#3b82f6' },
  { base: '#a16207', lit: '#fde047', glow: '#eab308' },
] as const;

/** Mittelwinkel je Feld: oben, rechts, unten, links. */
const CENTER_ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];

let seenPresses = -1;
let pressAt = -1e9;
let seenFlashes = -1;
let flashAt = -1e9;

function padPath(ctx: CanvasRenderingContext2D, pad: number, grow: number): void {
  const mid = CENTER_ANGLE[pad] as number;
  const a0 = mid - Math.PI / 4 + GAP;
  const a1 = mid + Math.PI / 4 - GAP;
  ctx.beginPath();
  ctx.arc(CX, CY, R_OUT + grow, a0, a1);
  ctx.arc(CX, CY, R_IN, a1, a0, true);
  ctx.closePath();
}

export const renderer: RealtimeRenderer<State> = {
  id: 'simon',
  logic,
  view: { width: W, height: H },
  touch: 'pointer',
  instructions:
    'Schau dir die Folge an und spiel sie nach: Tippen aufs Farbfeld oder Pfeiltasten (oben, rechts, unten, links). Je Tipp hast du fünf Sekunden.',
  keyInput(key, phase, state) {
    if (state.phase !== 'input') return null;
    const input = defaultKeyInput(key, phase);
    if (
      input === ARCADE_INPUT_UP ||
      input === ARCADE_INPUT_RIGHT ||
      input === ARCADE_INPUT_DOWN ||
      input === ARCADE_INPUT_LEFT
    ) {
      return input;
    }
    return null;
  },
  pointerInput(pointer, state) {
    if (state.phase !== 'input' || pointer.button !== 0) return null;
    const dx = pointer.x - CX;
    const dy = pointer.y - CY;
    const r = Math.hypot(dx, dy);
    if (r < R_IN - 8 || r > R_OUT + 24) return null;
    // Winkel in Viertel um die Achsen: oben 0, rechts 1, unten 2, links 3.
    const angle = Math.atan2(dy, dx);
    const quarter = Math.round(angle / (Math.PI / 2));
    const pad = (((quarter + 1) % 4) + 4) % 4;
    return ARCADE_INPUT_CUSTOM + pad;
  },
  render(ctx, state, time) {
    if (state.presses !== seenPresses) {
      if (seenPresses !== -1) pressAt = time;
      seenPresses = state.presses;
    }
    if (state.flashes !== seenFlashes) {
      if (seenFlashes !== -1) flashAt = time;
      seenFlashes = state.flashes;
    }

    const bg = ctx.createRadialGradient(CX, CY, 20, CX, CY, 320);
    bg.addColorStop(0, '#2a0f24');
    bg.addColorStop(1, '#0a0710');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Sanft kreisende Lichtpunkte im Hintergrund
    for (let k = 0; k < 18; k += 1) {
      const a = time / 4000 + (k * Math.PI * 2) / 18;
      const rr = 175 + Math.sin(time / 900 + k) * 8;
      ctx.fillStyle = `rgba(244,114,182,${0.15 + 0.1 * Math.sin(time / 500 + k)})`;
      ctx.beginPath();
      ctx.arc(CX + Math.cos(a) * rr, CY + Math.sin(a) * rr, 2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Kopfzeile
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f9a8d4';
    ctx.font = '600 13px system-ui, sans-serif';
    const status =
      state.phase === 'show'
        ? 'Gut aufpassen …'
        : state.phase === 'input'
          ? `Du bist dran – ${state.idx} von ${state.seq.length}`
          : state.reason === 'zeit'
            ? 'Zu langsam!'
            : 'Daneben!';
    ctx.fillText(status, CX, 30);
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(`Runde ${state.rounds + 1}`, CX, 56);

    // Felder
    for (let pad = 0; pad < 4; pad += 1) {
      const colors = PADS[pad] as (typeof PADS)[number];
      const isLit = state.lit === pad;
      const since = Math.min(time - pressAt, time - flashAt);
      const pop = isLit ? Math.max(0, 1 - since / 160) * 6 : 0;
      ctx.save();
      if (isLit) {
        ctx.shadowColor = colors.glow;
        ctx.shadowBlur = 36;
      }
      const mid = CENTER_ANGLE[pad] as number;
      const gx = CX + Math.cos(mid) * (R_OUT + R_IN) * 0.5;
      const gy = CY + Math.sin(mid) * (R_OUT + R_IN) * 0.5;
      const grad = ctx.createRadialGradient(gx, gy, 6, gx, gy, 110);
      grad.addColorStop(0, isLit ? '#ffffff' : colors.base);
      grad.addColorStop(0.35, isLit ? colors.lit : colors.base);
      grad.addColorStop(1, isLit ? colors.glow : '#0f0a14');
      ctx.fillStyle = grad;
      padPath(ctx, pad, pop);
      ctx.fill();
      ctx.restore();
      ctx.strokeStyle = isLit ? '#ffffff' : 'rgba(255,255,255,0.12)';
      ctx.lineWidth = isLit ? 2.5 : 1.5;
      padPath(ctx, pad, pop);
      ctx.stroke();

      // Zeigt beim Scheitern, welches Feld richtig gewesen wäre.
      if (state.phase === 'over' && state.expected === pad && Math.floor(time / 300) % 2 === 0) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.setLineDash([8, 6]);
        padPath(ctx, pad, 4);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Klangwelle beim Tipp
    const ringAge = (time - Math.max(pressAt, flashAt)) / 450;
    if (ringAge < 1 && state.lit >= 0) {
      ctx.save();
      ctx.globalAlpha = 1 - ringAge;
      ctx.strokeStyle = (PADS[state.lit] as (typeof PADS)[number]).lit;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(CX, CY, R_OUT + 6 + ringAge * 30, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Mitte: Zeitring in der Eingabephase
    const hub = ctx.createRadialGradient(CX - 12, CY - 12, 4, CX, CY, R_IN);
    hub.addColorStop(0, '#3b1733');
    hub.addColorStop(1, '#12070f');
    ctx.fillStyle = hub;
    ctx.beginPath();
    ctx.arc(CX, CY, R_IN - 8, 0, Math.PI * 2);
    ctx.fill();
    if (state.phase === 'input') {
      const left = Math.max(0, 1 - state.t / INPUT_TIMEOUT_TICKS);
      ctx.strokeStyle = left < 0.3 ? '#f87171' : '#f472b6';
      ctx.lineWidth = 5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(CX, CY, R_IN - 16, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
      ctx.stroke();
      ctx.lineCap = 'butt';
    }
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 30px system-ui, sans-serif';
    ctx.fillText(String(state.rounds * 10), CX, CY - 2);
    ctx.fillStyle = 'rgba(249,168,212,0.8)';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.fillText('PUNKTE', CX, CY + 20);
  },
  snapshot: (state) => ({
    flashes: state.flashes,
    presses: state.presses,
    rounds: state.rounds,
    over: state.phase === 'over',
  }),
  sounds(prev, next) {
    const a = prev as { flashes: number; presses: number; rounds: number; over: boolean };
    const b = next as { flashes: number; presses: number; rounds: number; over: boolean };
    const out: SfxName[] = [];
    if (b.over && !a.over) {
      out.push('lose');
      return out;
    }
    if (b.flashes > a.flashes) out.push('tick');
    if (b.presses > a.presses) out.push('click');
    if (b.rounds > a.rounds) out.push('score');
    return out;
  },
};
