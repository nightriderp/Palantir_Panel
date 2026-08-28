'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/shared';
import { TouchControls } from './TouchControls';
import { type ArcadeGame, type GameControl, type GamePhase } from './types';

/**
 * Wirt für ein einzelnes Minispiel (Arbeitspaket F8).
 *
 * Kümmert sich um alles Nicht-Spiel-Spezifische: die Bild-für-Bild-Schleife, das
 * Zeichnen auf ein Canvas mit fester logischer Auflösung (per CSS auf die
 * Container-Breite skaliert), Tastatur- und Touch-Eingaben, das Pausieren beim
 * Verlassen des Tabs sowie Start-, Pause- und Neustart-Steuerung. Die Spiellogik
 * bleibt vollständig in der übergebenen {@link ArcadeGame}-Definition.
 *
 * `onGameOver` wird genau einmal je Partie mit dem Endpunktestand aufgerufen –
 * dort schickt die Ansicht den Score an die API (Lastenheft §3.9).
 */

export interface GameHostProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- der Zustandstyp ist je Spiel privat; GameHost behandelt ihn undurchsichtig.
  game: ArcadeGame<any>;
  onGameOver(score: number): void;
}

export function GameHost({ game, onGameOver }: GameHostProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef<unknown>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const pausedRef = useRef<boolean>(false);
  const phaseRef = useRef<GamePhase>('ready');
  const scoreRef = useRef<number>(0);

  const [phase, setPhase] = useState<GamePhase>('ready');
  const [paused, setPaused] = useState<boolean>(false);
  const [score, setScore] = useState<number>(0);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx || stateRef.current === null) return;
    game.render(ctx, stateRef.current, game.view);
  }, [game]);

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const loop = useCallback(
    (now: number) => {
      const state = stateRef.current;
      if (state === null) return;

      const dt = lastRef.current === 0 ? 16 : now - lastRef.current;
      lastRef.current = now;

      if (!pausedRef.current) {
        game.step(state, Math.min(dt, 100));
      }
      draw();

      const nextScore = game.score(state);
      if (nextScore !== scoreRef.current) {
        scoreRef.current = nextScore;
        setScore(nextScore);
      }

      const nextPhase = game.phase(state);
      if (nextPhase !== phaseRef.current) {
        phaseRef.current = nextPhase;
        setPhase(nextPhase);
        if (nextPhase === 'over') {
          onGameOver(nextScore);
        }
      }

      if (nextPhase === 'over') {
        stopLoop();
        return;
      }
      rafRef.current = requestAnimationFrame(loop);
    },
    [draw, game, onGameOver, stopLoop],
  );

  const startLoop = useCallback(() => {
    stopLoop();
    lastRef.current = 0;
    rafRef.current = requestAnimationFrame(loop);
  }, [loop, stopLoop]);

  const reset = useCallback(() => {
    stateRef.current = game.create();
    scoreRef.current = 0;
    phaseRef.current = 'ready';
    pausedRef.current = false;
    setScore(0);
    setPhase('ready');
    setPaused(false);
    startLoop();
  }, [game, startLoop]);

  // Neues Spiel bei Wechsel des Spiels; Schleife beim Verlassen anhalten.
  useEffect(() => {
    reset();
    return () => stopLoop();
  }, [reset, stopLoop]);

  // Beim Verlassen des Tabs automatisch pausieren (kein stilles Weiterspielen).
  useEffect(() => {
    function onVisibility(): void {
      if (document.hidden && phaseRef.current === 'running') {
        pausedRef.current = true;
        setPaused(true);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const sendControl = useCallback(
    (control: GameControl, controlPhase: 'press' | 'release') => {
      const state = stateRef.current;
      if (state === null || pausedRef.current || phaseRef.current === 'over') return;
      game.control(state, control, controlPhase);
    },
    [game],
  );

  // Tastatursteuerung: Pfeiltasten, Leertaste (Aktion), P (Pause).
  useEffect(() => {
    const KEY_TO_CONTROL: Record<string, GameControl> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      ' ': 'action',
    };

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'p' || event.key === 'P') {
        if (phaseRef.current === 'running' || pausedRef.current) {
          pausedRef.current = !pausedRef.current;
          setPaused(pausedRef.current);
        }
        return;
      }
      const control = KEY_TO_CONTROL[event.key];
      if (!control) return;
      event.preventDefault();
      if (event.repeat && (control === 'up' || control === 'action')) return;
      sendControl(control, 'press');
    }

    function onKeyUp(event: KeyboardEvent): void {
      const control = KEY_TO_CONTROL[event.key];
      if (!control) return;
      event.preventDefault();
      sendControl(control, 'release');
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [sendControl]);

  const togglePause = useCallback(() => {
    if (phaseRef.current === 'over') return;
    pausedRef.current = !pausedRef.current;
    setPaused(pausedRef.current);
  }, []);

  const aspect = game.view.width / game.view.height;

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        className="relative w-full overflow-hidden rounded-2xl border border-line-strong bg-surface-deep"
        style={{
          maxWidth: 'min(100%, 480px)',
          aspectRatio: `${game.view.width} / ${game.view.height}`,
        }}
      >
        <canvas
          ref={canvasRef}
          width={game.view.width}
          height={game.view.height}
          className="block h-full w-full touch-none"
          style={{ aspectRatio: `${aspect}` }}
        />

        {phase === 'ready' ? (
          <Overlay>
            <p className="text-lg font-semibold text-ink">Bereit?</p>
            <p className="max-w-xs text-center text-sm text-ink-muted">{game.instructions}</p>
            <p className="text-sm text-ink-soft">Taste drücken oder unten tippen, um zu starten.</p>
          </Overlay>
        ) : null}

        {paused && phase === 'running' ? (
          <Overlay>
            <p className="text-lg font-semibold text-ink">Pause</p>
            <Button variant="primary" onClick={togglePause}>
              Weiter
            </Button>
          </Overlay>
        ) : null}

        {phase === 'over' ? (
          <Overlay>
            <p className="text-lg font-semibold text-ink">Vorbei</p>
            <p className="font-mono text-2xl text-brand-bright">{score}</p>
            <Button variant="primary" onClick={reset}>
              Nochmal
            </Button>
          </Overlay>
        ) : null}
      </div>

      <div className="flex w-full items-center justify-between gap-3">
        <div className="font-mono text-sm text-ink-muted">
          Punkte <span className="text-base text-ink">{score}</span>
        </div>
        <div className="flex gap-2">
          {phase === 'running' ? (
            <Button variant="secondary" onClick={togglePause}>
              {paused ? 'Weiter' : 'Pause'}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={reset}>
            Neu
          </Button>
        </div>
      </div>

      <TouchControls
        scheme={game.touch}
        disabled={phase === 'over' || paused}
        onControl={sendControl}
      />
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas/75 p-4 backdrop-blur-sm">
      {children}
    </div>
  );
}
