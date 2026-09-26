import { ARCADE_INPUT_ACTION, REALTIME_GAMES } from '@palantir/arcade';
import { type SfxName } from '@/lib/arcade/audio/types';
import { defaultKeyInput } from '../keys';
import { type RealtimeRenderer } from '../types';

/**
 * Zeichenschicht für Flappy Bird.
 *
 * Der Vogel ist eine eigene Figur: ein runder Honigspatz mit Scheitelfeder,
 * kein Nachbau. Vier Ebenen ziehen unterschiedlich schnell vorbei (Wolken,
 * ferne Berge, Hügel mit Bäumen, Boden) – das ergibt die Parallaxe. Die
 * Himmelsfarbe wandert mit der Strecke langsam in den Abend.
 *
 * Spiegelung der gezeichneten Felder – siehe Kommentar in `steinbrecher.ts`.
 */

interface State {
  tick: number;
  phase: 'ready' | 'play' | 'dead' | 'over';
  score: number;
  y: number;
  vy: number;
  pipes: { x: number; gapY: number; gap: number }[];
  dist: number;
  flaps: number;
}

interface Snap {
  flaps: number;
  score: number;
  phase: State['phase'];
}

const logic = REALTIME_GAMES['flappy'];
if (!logic) throw new Error('flappy fehlt');

const W = 288;
const H = 512;
const GROUND_Y = 432;
const BIRD_X = 72;
const BIRD_R = 11;
const PIPE_W = 52;

const MEDALS = [
  { min: 40, name: 'Platin', color: '#e0f2fe', rim: '#7dd3fc' },
  { min: 30, name: 'Gold', color: '#fde047', rim: '#ca8a04' },
  { min: 20, name: 'Silber', color: '#e5e7eb', rim: '#9ca3af' },
  { min: 10, name: 'Bronze', color: '#fdba74', rim: '#c2410c' },
];

function mix(a: [number, number, number], b: [number, number, number], t: number): string {
  const c = a.map((v, i) => Math.round(v + ((b[i] ?? v) - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Wiederholt eine Ebene waagerecht; `offset` ist die Verschiebung dieser Ebene. */
function tiled(width: number, offset: number, draw: (x: number) => void): void {
  const start = -(((offset % width) + width) % width);
  for (let x = start; x < W + width; x += width) draw(x);
}

function drawSky(ctx: CanvasRenderingContext2D, dist: number, time: number): void {
  // Nach etwa 30 Röhren ist es Abend, dann wieder Tag – eine sanfte Welle.
  const t = (1 - Math.cos(dist / 2600)) / 2;
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
  sky.addColorStop(0, mix([56, 189, 248], [76, 29, 149], t));
  sky.addColorStop(0.7, mix([186, 230, 253], [251, 146, 60], t));
  sky.addColorStop(1, mix([254, 243, 199], [253, 186, 116], t));
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, GROUND_Y);
  // Sonne
  ctx.fillStyle = mix([254, 240, 138], [253, 164, 175], t);
  ctx.shadowColor = '#fde68a';
  ctx.shadowBlur = 30;
  ctx.beginPath();
  ctx.arc(220, 90 + t * 150, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;
  // Wolken, sehr langsam
  ctx.fillStyle = 'rgba(255,255,255,0.8)';
  tiled(220, dist * 0.1 + time * 0.004, (x) => {
    for (const [dx, dy, r] of [
      [20, 70, 16],
      [40, 62, 20],
      [62, 70, 15],
      [140, 130, 12],
      [156, 124, 16],
      [174, 131, 11],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x + dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawHills(ctx: CanvasRenderingContext2D, dist: number): void {
  // Ferne Berge
  ctx.fillStyle = 'rgba(99,102,241,0.35)';
  tiled(240, dist * 0.2, (x) => {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y);
    ctx.lineTo(x + 60, GROUND_Y - 110);
    ctx.lineTo(x + 100, GROUND_Y - 70);
    ctx.lineTo(x + 150, GROUND_Y - 140);
    ctx.lineTo(x + 240, GROUND_Y);
    ctx.closePath();
    ctx.fill();
  });
  // Nahe Hügel mit runden Bäumchen
  tiled(180, dist * 0.45, (x) => {
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.ellipse(x + 60, GROUND_Y, 90, 44, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = '#16a34a';
    for (const [dx, h] of [
      [30, 48],
      [110, 36],
      [150, 54],
    ] as const) {
      ctx.fillStyle = '#854d0e';
      ctx.fillRect(x + dx - 2, GROUND_Y - h + 12, 4, h - 12);
      ctx.fillStyle = '#15803d';
      ctx.beginPath();
      ctx.arc(x + dx, GROUND_Y - h + 8, 12, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

function drawPipe(ctx: CanvasRenderingContext2D, x: number, top: number, bottom: number): void {
  const body = ctx.createLinearGradient(x, 0, x + PIPE_W, 0);
  body.addColorStop(0, '#15803d');
  body.addColorStop(0.35, '#86efac');
  body.addColorStop(1, '#14532d');
  ctx.fillStyle = body;
  ctx.fillRect(x + 3, 0, PIPE_W - 6, top);
  ctx.fillRect(x + 3, bottom, PIPE_W - 6, GROUND_Y - bottom);
  // Ringe als Muster, damit die Röhren nicht glatt wirken
  ctx.fillStyle = 'rgba(20,83,45,0.35)';
  for (let y = top - 40; y > -20; y -= 36) ctx.fillRect(x + 3, y, PIPE_W - 6, 4);
  for (let y = bottom + 40; y < GROUND_Y; y += 36) ctx.fillRect(x + 3, y, PIPE_W - 6, 4);
  // Kappen
  ctx.fillStyle = body;
  roundRect(ctx, x - 2, top - 22, PIPE_W + 4, 22, 4);
  ctx.fill();
  roundRect(ctx, x - 2, bottom, PIPE_W + 4, 22, 4);
  ctx.fill();
  ctx.strokeStyle = '#052e16';
  ctx.lineWidth = 2;
  roundRect(ctx, x - 2, top - 22, PIPE_W + 4, 22, 4);
  ctx.stroke();
  roundRect(ctx, x - 2, bottom, PIPE_W + 4, 22, 4);
  ctx.stroke();
}

function drawGround(ctx: CanvasRenderingContext2D, dist: number): void {
  const g = ctx.createLinearGradient(0, GROUND_Y, 0, H);
  g.addColorStop(0, '#fcd34d');
  g.addColorStop(1, '#b45309');
  ctx.fillStyle = g;
  ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
  ctx.fillStyle = '#65a30d';
  ctx.fillRect(0, GROUND_Y, W, 10);
  ctx.fillStyle = '#84cc16';
  tiled(24, dist, (x) => {
    ctx.beginPath();
    ctx.moveTo(x, GROUND_Y + 10);
    ctx.lineTo(x + 12, GROUND_Y + 10);
    ctx.lineTo(x + 6, GROUND_Y + 2);
    ctx.closePath();
    ctx.fill();
  });
  ctx.fillStyle = 'rgba(146,64,14,0.35)';
  tiled(32, dist, (x) => ctx.fillRect(x, GROUND_Y + 26, 14, 4));
}

function drawBird(ctx: CanvasRenderingContext2D, state: State, time: number): void {
  const bob = state.phase === 'ready' ? Math.sin(time / 180) * 6 : 0;
  const y = state.y + bob;
  const tilt = state.phase === 'ready' ? 0 : Math.max(-0.5, Math.min(1.3, state.vy / 7));
  const flapping = state.phase === 'ready' || state.vy < 1;
  const wing = flapping ? Math.sin(time / 45) : 0.3;
  ctx.save();
  ctx.translate(BIRD_X, y);
  ctx.rotate(tilt);
  // Schwanzfedern
  ctx.fillStyle = '#ea580c';
  ctx.beginPath();
  ctx.moveTo(-9, -2);
  ctx.lineTo(-17, -6);
  ctx.lineTo(-16, 2);
  ctx.lineTo(-9, 4);
  ctx.closePath();
  ctx.fill();
  // Körper
  const body = ctx.createRadialGradient(-3, -4, 2, 0, 0, BIRD_R + 2);
  body.addColorStop(0, '#fef08a');
  body.addColorStop(1, '#f59e0b');
  ctx.fillStyle = body;
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, BIRD_R + 1, BIRD_R, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Bauch
  ctx.fillStyle = '#fffbeb';
  ctx.beginPath();
  ctx.ellipse(1, 5, 7, 4, 0, 0, Math.PI * 2);
  ctx.fill();
  // Scheitelfeder
  ctx.strokeStyle = '#ea580c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-1, -BIRD_R + 1);
  ctx.quadraticCurveTo(2, -BIRD_R - 8, 6, -BIRD_R - 5);
  ctx.stroke();
  // Flügel
  ctx.fillStyle = '#fbbf24';
  ctx.strokeStyle = '#78350f';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.ellipse(-4, 1 + wing * 4, 7, 4 - Math.abs(wing) * 1.5, -0.3 + wing * 0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // Auge: groß, mit Glanzpunkt; nach dem Aufprall als Kreuz
  if (state.phase === 'dead' || state.phase === 'over') {
    ctx.strokeStyle = '#1f2937';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(2, -6);
    ctx.lineTo(8, 0);
    ctx.moveTo(8, -6);
    ctx.lineTo(2, 0);
    ctx.stroke();
  } else {
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(5, -3, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111827';
    ctx.beginPath();
    ctx.arc(6.5, -3, 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(7, -5, 1.2, 1.2);
  }
  // Schnabel
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(17, 2);
  ctx.lineTo(9, 5);
  ctx.closePath();
  ctx.fill();
  // Wangenröte
  ctx.fillStyle = 'rgba(244,114,182,0.55)';
  ctx.beginPath();
  ctx.arc(1, 2, 2.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function outlinedText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
): void {
  ctx.font = `900 ${size}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(3, size / 6);
  ctx.strokeStyle = '#422006';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

function drawGameOver(ctx: CanvasRenderingContext2D, state: State, time: number): void {
  ctx.fillStyle = 'rgba(15,23,42,0.35)';
  ctx.fillRect(0, 0, W, H);
  outlinedText(ctx, 'Game Over', W / 2, 130, 36, '#fbbf24');
  const x = 34;
  const y = 170;
  const w = W - 68;
  const h = 130;
  ctx.fillStyle = '#fef3c7';
  ctx.strokeStyle = '#92400e';
  ctx.lineWidth = 3;
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#92400e';
  ctx.font = '700 12px system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('Medaille', x + 16, y + 20);
  ctx.textAlign = 'right';
  ctx.fillText('Punkte', x + w - 16, y + 20);
  outlinedText(ctx, String(state.score), x + w - 44, y + 62, 30, '#ffffff');

  const medal = MEDALS.find((m) => state.score >= m.min);
  const mx = x + 50;
  const my = y + 72;
  if (medal) {
    const g = ctx.createRadialGradient(mx - 6, my - 6, 2, mx, my, 24);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.4, medal.color);
    g.addColorStop(1, medal.rim);
    ctx.fillStyle = g;
    ctx.shadowColor = medal.color;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.arc(mx, my, 22, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    // Stern in der Mitte, dazu ein wandernder Glanz
    ctx.fillStyle = medal.rim;
    ctx.beginPath();
    for (let k = 0; k < 10; k += 1) {
      const r = k % 2 === 0 ? 11 : 5;
      const a = (k / 10) * Math.PI * 2 - Math.PI / 2;
      ctx.lineTo(mx + Math.cos(a) * r, my + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.fill();
    const sparkle = (time / 400) % (Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(mx + Math.cos(sparkle) * 16 - 1, my + Math.sin(sparkle) * 16 - 1, 3, 3);
    ctx.fillStyle = '#92400e';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(medal.name, mx, y + h - 12);
  } else {
    ctx.strokeStyle = 'rgba(146,64,14,0.4)';
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.arc(mx, my, 22, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#92400e';
    ctx.font = '600 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ab 10', mx, y + h - 12);
  }
}

export const renderer: RealtimeRenderer<State> = {
  id: 'flappy',
  logic,
  view: { width: W, height: H },
  touch: 'tap',
  instructions:
    'Leertaste, Pfeil hoch oder Tippen lässt den Vogel flattern. Flieg durch die Lücken zwischen den Röhren – jede passierte Röhre zählt einen Punkt.',

  keyInput(key, phase) {
    return defaultKeyInput(key, phase);
  },

  pointerInput() {
    return ARCADE_INPUT_ACTION;
  },

  render(ctx, state, time) {
    drawSky(ctx, state.dist, time);
    drawHills(ctx, state.dist);
    for (const pipe of state.pipes) {
      drawPipe(ctx, pipe.x, pipe.gapY - pipe.gap / 2, pipe.gapY + pipe.gap / 2);
    }
    drawGround(ctx, state.dist);
    drawBird(ctx, state, time);

    if (state.phase === 'ready') {
      outlinedText(ctx, 'Flappy Bird', W / 2, 120, 34, '#fbbf24');
      if (Math.floor(time / 500) % 2 === 0) {
        outlinedText(ctx, 'Tippen oder Leertaste', W / 2, 330, 16, '#ffffff');
      }
    } else if (state.phase === 'over') {
      drawGameOver(ctx, state, time);
    } else {
      outlinedText(ctx, String(state.score), W / 2, 56, 40, '#ffffff');
    }
  },

  snapshot(state): Snap {
    return { flaps: state.flaps, score: state.score, phase: state.phase };
  },

  sounds(prev, next) {
    const a = prev as Snap;
    const b = next as Snap;
    const out: SfxName[] = [];
    if (b.flaps > a.flaps) out.push('flap');
    if (b.score > a.score) out.push('score');
    if ((b.phase === 'dead' || b.phase === 'over') && a.phase === 'play') out.push('hit');
    if (b.phase === 'over' && a.phase !== 'over') out.push('lose');
    return out;
  },
};
