'use client';

import {
  ARCADE_GAME_CATALOG,
  ARCADE_SCORE_MAX,
  type ArcadeSubmitResultDto,
} from '@palantir/contracts';
import { encodeArcadeReplay, replayToBase64 } from '@palantir/arcade';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';
import { Badge, Button, Icon, Spinner, formatNumber, useMediaQuery } from '@/components/shared';
import { errorText, isAborted } from '@/lib/api/client';
import { requestArcadeSeed, submitArcadeRun } from '@/lib/arcade/api';
import { useArcadeAudio } from '@/lib/arcade/audio/ArcadeAudioProvider';
import { type SfxName } from '@/lib/arcade/audio/types';
import { isGameKey } from './keys';
import { RealtimeSession } from './session';
import { TouchPad } from './TouchPad';
import { type AnyRealtimeRenderer } from './types';

/**
 * Wirt der Echtzeit-Spiele.
 *
 * Holt einen Startwert vom Backend, lässt die Logik im festen Takt laufen
 * (`RealtimeSession`), zeichnet über die Zeichenschicht des Spiels und reicht
 * am Ende das Eingabeband ein. Das Backend spielt es nach und wertet nur, was
 * es selbst errechnet – was der Browser anzeigt, ist nur ein Vorschlag.
 *
 * Ohne Startwert (Backend weg, nicht angemeldet) wird trotzdem gespielt, nur
 * eben ohne Wertung – und das steht sichtbar da, statt dass am Ende still
 * nichts passiert.
 */

type Phase = 'loading' | 'ready' | 'running' | 'paused' | 'over';

type SubmitState =
  | { status: 'idle' }
  | { status: 'unranked'; reason: string }
  | { status: 'sending' }
  | { status: 'ok'; result: ArcadeSubmitResultDto }
  | { status: 'error'; message: string };

interface SeedInfo {
  seedId: string | null;
  seed: number;
  note: string | null;
}

/** Wie lange ein Finger liegen muss, bis aus dem Tippen ein Rechtsklick wird (Minesweeper-Fahne). */
const LONG_PRESS_MS = 450;
/** Längster Schritt eines Bildes – ein Tab, der eine Minute hing, spult nicht vor. */
const MAX_FRAME_MS = 250;

export interface RealtimeHostProps {
  renderer: AnyRealtimeRenderer;
  /** Nach einer gewerteten Einsendung – Bestenliste neu laden. */
  onSubmitted?(result: ArcadeSubmitResultDto): void;
}

function zufallsStart(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

function istEingabefeld(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

export function RealtimeHost({ renderer, onSubmitted }: RealtimeHostProps) {
  const gameId = renderer.id;
  const accent = ARCADE_GAME_CATALOG[gameId].accent;
  const { sfx } = useArcadeAudio();
  const coarse = useMediaQuery('(pointer: coarse)');

  const [phase, setPhase] = useState<Phase>('loading');
  const [round, setRound] = useState(0);
  const [score, setScore] = useState(0);
  const [seedInfo, setSeedInfo] = useState<SeedInfo | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<RealtimeSession<unknown> | null>(null);
  const phaseRef = useRef<Phase>('loading');
  const seedRef = useRef<SeedInfo | null>(null);
  const snapshotRef = useRef<unknown>(null);
  const scaleRef = useRef(1);
  const longPressRef = useRef<{ timer: ReturnType<typeof setTimeout> | null; fired: boolean }>({
    timer: null,
    fired: false,
  });

  const changePhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  }, []);

  const onSubmittedRef = useRef(onSubmitted);
  useEffect(() => {
    onSubmittedRef.current = onSubmitted;
  });

  // --- Startwert holen und Partie anlegen ------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    const anlegen = (info: SeedInfo) => {
      if (controller.signal.aborted) return;
      const session = new RealtimeSession(renderer.logic, info.seed);
      sessionRef.current = session;
      seedRef.current = info;
      snapshotRef.current = renderer.snapshot ? renderer.snapshot(session.state) : null;
      setSeedInfo(info);
      setScore(session.score);
      changePhase('ready');
    };

    /*
     * Immer fragen, auch ohne Anmeldung – das Backend entscheidet, und seine
     * Absage steht dann als Grund an der Partie. Bewusst **nicht** an einer
     * Anmelde-Angabe der Ansicht festgemacht: Die kommt mit der Bestenliste
     * nach, und ein Wechsel mitten im Spiel legte sonst eine neue Partie an
     * (Audit-Fundstelle frontend-lib-03).
     */
    void requestArcadeSeed(gameId, controller.signal).then((result) => {
      if (result.success) {
        anlegen({ seedId: result.data.seedId, seed: result.data.seed, note: null });
      } else if (!isAborted(result)) {
        anlegen({ seedId: null, seed: zufallsStart(), note: `Ohne Wertung: ${errorText(result)}` });
      }
    });
    return () => controller.abort();
  }, [renderer, gameId, round, changePhase]);

  // --- Ende: Band einreichen ---------------------------------------------------
  const beenden = useCallback(() => {
    const session = sessionRef.current;
    const info = seedRef.current;
    if (!session || phaseRef.current === 'over') return;
    changePhase('over');
    const endstand = session.score;
    setScore(endstand);

    if (!info?.seedId) {
      sfx('lose');
      setSubmit({ status: 'unranked', reason: info?.note ?? 'Ohne Wertung.' });
      return;
    }
    setSubmit({ status: 'sending' });
    let replay: string;
    try {
      replay = replayToBase64(encodeArcadeReplay(session.finish()));
    } catch {
      setSubmit({ status: 'error', message: 'Das Band dieser Partie ließ sich nicht verpacken.' });
      return;
    }
    void submitArcadeRun({
      gameId,
      seedId: info.seedId,
      replay,
      claimedScore: Math.min(ARCADE_SCORE_MAX, Math.max(0, Math.floor(endstand))),
    }).then((result) => {
      if (!result.success) {
        sfx('lose');
        setSubmit({ status: 'error', message: errorText(result) });
        return;
      }
      sfx(result.data.isNewPersonalBest ? 'win' : 'score');
      setSubmit({ status: 'ok', result: result.data });
      onSubmittedRef.current?.(result.data);
    });
  }, [changePhase, gameId, sfx]);

  // --- Takt und Zeichnen -------------------------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    const frame = frameRef.current;
    if (!canvas || !frame) return;
    const ctx = canvas.getContext('2d');
    const { width, height } = renderer.view;

    const groesse = () => {
      const rect = frame.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const cssWidth = rect.width > 0 ? rect.width : width;
      canvas.width = Math.max(1, Math.round(cssWidth * dpr));
      canvas.height = Math.max(1, Math.round((cssWidth * height * dpr) / width));
      scaleRef.current = canvas.width / width;
    };
    groesse();
    const beobachter = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(groesse);
    beobachter?.observe(frame);

    const raf =
      typeof window.requestAnimationFrame === 'function'
        ? window.requestAnimationFrame.bind(window)
        : (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 16);
    const caf =
      typeof window.cancelAnimationFrame === 'function'
        ? window.cancelAnimationFrame.bind(window)
        : (id: number) => window.clearTimeout(id);

    let last: number | null = null;
    let id = 0;
    let gezeigterStand = Number.NaN;

    const bild = (now: number) => {
      const dt = last === null ? 0 : Math.min(MAX_FRAME_MS, now - last);
      last = now;
      const session = sessionRef.current;
      if (session && phaseRef.current === 'running') {
        const schritte = session.advance(dt);
        if (schritte > 0) {
          if (renderer.snapshot && renderer.sounds) {
            const next = renderer.snapshot(session.state);
            const namen = new Set<SfxName>(renderer.sounds(snapshotRef.current, next));
            snapshotRef.current = next;
            for (const name of namen) sfx(name);
          }
          const stand = session.score;
          if (stand !== gezeigterStand) {
            gezeigterStand = stand;
            setScore(stand);
          }
          if (session.over) beenden();
        }
      }
      if (ctx && session) {
        const scale = scaleRef.current;
        ctx.setTransform(scale, 0, 0, scale, 0, 0);
        ctx.clearRect(0, 0, width, height);
        try {
          renderer.render(ctx, session.state, now);
        } catch {
          // Ein Zeichenfehler soll das Spiel nicht einfrieren – der nächste Schritt zeichnet neu.
        }
      }
      id = raf(bild);
    };
    id = raf(bild);

    return () => {
      caf(id);
      beobachter?.disconnect();
    };
  }, [renderer, sfx, beenden]);

  // --- Eingaben ---------------------------------------------------------------
  const starten = useCallback(() => {
    if (phaseRef.current !== 'ready') return;
    setSubmit({ status: 'idle' });
    changePhase('running');
    sfx('click');
  }, [changePhase, sfx]);

  const pause = useCallback(
    (an: boolean) => {
      if (an && phaseRef.current === 'running') changePhase('paused');
      else if (!an && phaseRef.current === 'paused') changePhase('running');
    },
    [changePhase],
  );

  const taste = useCallback(
    (key: string, art: 'press' | 'release') => {
      const session = sessionRef.current;
      if (!session) return false;
      if (phaseRef.current === 'ready' && art === 'press') {
        // Nur Spieltasten starten – Tab, F5 & Co. sollen tun, was sie immer tun.
        if (!isGameKey(key) && renderer.keyInput(key, 'press', session.state) === null)
          return false;
        starten();
        return true;
      }
      if (phaseRef.current !== 'running') return false;
      const input = renderer.keyInput(key, art, session.state);
      if (input === null) return false;
      session.enqueue(input);
      return true;
    },
    [renderer, starten],
  );

  const nochmal = useCallback(() => {
    sessionRef.current = null;
    seedRef.current = null;
    setSubmit({ status: 'idle' });
    setScore(0);
    changePhase('loading');
    setRound((wert) => wert + 1);
  }, [changePhase]);

  useEffect(() => {
    const unten = (event: KeyboardEvent) => {
      if (istEingabefeld(event.target) || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'p' || event.key === 'P' || event.key === 'Escape') {
        if (phaseRef.current === 'running' || phaseRef.current === 'paused') {
          event.preventDefault();
          pause(phaseRef.current === 'running');
        }
        return;
      }
      if (phaseRef.current === 'over' && event.key === 'Enter') {
        event.preventDefault();
        nochmal();
        return;
      }
      const spieltaste = isGameKey(event.key);
      if (event.repeat) {
        // Gehaltene Tasten wiederholen – das Spiel bekommt nur das erste Drücken.
        if (spieltaste && phaseRef.current !== 'over') event.preventDefault();
        return;
      }
      const genommen = taste(event.key, 'press');
      if (genommen || (spieltaste && phaseRef.current !== 'over')) event.preventDefault();
    };
    const oben = (event: KeyboardEvent) => {
      if (istEingabefeld(event.target)) return;
      if (taste(event.key, 'release')) event.preventDefault();
    };
    const sichtbarkeit = () => {
      if (document.visibilityState === 'hidden') pause(true);
    };
    window.addEventListener('keydown', unten);
    window.addEventListener('keyup', oben);
    document.addEventListener('visibilitychange', sichtbarkeit);
    return () => {
      window.removeEventListener('keydown', unten);
      window.removeEventListener('keyup', oben);
      document.removeEventListener('visibilitychange', sichtbarkeit);
    };
  }, [taste, pause, nochmal]);

  const zeiger = (event: ReactPointerEvent<HTMLCanvasElement>, button: 0 | 2) => {
    const session = sessionRef.current;
    if (!session || !renderer.pointerInput || phaseRef.current !== 'running') return;
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * renderer.view.width;
    const y = ((event.clientY - rect.top) / rect.height) * renderer.view.height;
    session.enqueue(renderer.pointerInput({ x, y, button }, session.state));
  };

  const zeigerRunter = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (phaseRef.current === 'ready') {
      starten();
      return;
    }
    if (event.pointerType === 'mouse') {
      zeiger(event, event.button === 2 ? 2 : 0);
      return;
    }
    if (renderer.touch !== 'pointer') {
      // Tippen als Aktion (Flappy): sofort, ohne auf ein langes Drücken zu warten.
      zeiger(event, 0);
      return;
    }
    // Finger/Stift in Feldspielen: Langes Drücken ist der Rechtsklick (Fahne).
    const lang = longPressRef.current;
    if (lang.timer !== null) clearTimeout(lang.timer);
    lang.fired = false;
    const kopie = {
      clientX: event.clientX,
      clientY: event.clientY,
      currentTarget: event.currentTarget,
    };
    lang.timer = setTimeout(() => {
      lang.timer = null;
      lang.fired = true;
      zeiger(kopie as unknown as ReactPointerEvent<HTMLCanvasElement>, 2);
      if (typeof navigator.vibrate === 'function') navigator.vibrate(15);
    }, LONG_PRESS_MS);
  };

  const zeigerHoch = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === 'mouse' || renderer.touch !== 'pointer') return;
    const lang = longPressRef.current;
    if (lang.timer !== null) {
      clearTimeout(lang.timer);
      lang.timer = null;
      if (!lang.fired) zeiger(event, 0);
    }
  };

  const zeigerAbbruch = () => {
    const lang = longPressRef.current;
    if (lang.timer !== null) clearTimeout(lang.timer);
    lang.timer = null;
  };

  useEffect(() => () => zeigerAbbruch(), []);

  const { width, height } = renderer.view;
  const ranked = seedInfo?.seedId != null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-baseline gap-2">
          <span className="text-sm text-ink-muted">Punkte</span>
          <span className="font-mono text-2xl font-bold tabular-nums" style={{ color: accent }}>
            {formatNumber(score)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {seedInfo ? (
            ranked ? (
              <Badge tone="success" withDot>
                Gewertet
              </Badge>
            ) : (
              <Badge tone="warning" title={seedInfo.note ?? undefined}>
                Ohne Wertung
              </Badge>
            )
          ) : null}
          {phase === 'running' || phase === 'paused' ? (
            <Button
              variant="secondary"
              size="sm"
              iconLeft={phase === 'running' ? 'stop' : 'play'}
              onClick={() => pause(phase === 'running')}
            >
              {phase === 'running' ? 'Pause' : 'Weiter'}
            </Button>
          ) : null}
        </div>
      </div>

      <div
        ref={frameRef}
        className="relative mx-auto w-full overflow-hidden rounded-2xl border-2 bg-surface-deep shadow-lg"
        style={{
          aspectRatio: `${width} / ${height}`,
          width: `min(100%, calc(72vh * ${width} / ${height}))`,
          borderColor: `${accent}55`,
          boxShadow: `0 0 40px -12px ${accent}66`,
        }}
      >
        <canvas
          ref={canvasRef}
          className="block h-full w-full touch-none select-none"
          aria-label={`Spielfeld ${ARCADE_GAME_CATALOG[gameId].name}`}
          role="img"
          onPointerDown={zeigerRunter}
          onPointerUp={zeigerHoch}
          onPointerCancel={zeigerAbbruch}
          onPointerLeave={zeigerAbbruch}
          onContextMenu={(event) => event.preventDefault()}
        />

        {phase === 'loading' ? (
          <Overlay art="voll">
            <div className="flex items-center gap-2 text-ink-muted">
              <Spinner /> Partie wird vorbereitet …
            </div>
          </Overlay>
        ) : phase === 'paused' ? (
          <Overlay art="voll">
            <div className="text-2xl font-bold text-white">Pause</div>
            <Button variant="primary" iconLeft="play" onClick={() => pause(false)}>
              Weiter
            </Button>
          </Overlay>
        ) : phase === 'ready' ? (
          // Dezent unten: Viele Zeichenschichten malen ihren eigenen Startbildschirm.
          <Overlay art="leiste">
            <Button variant="primary" size="sm" iconLeft="play" onClick={starten}>
              Los geht&apos;s
            </Button>
            <span className="text-xs text-white/80">
              {coarse ? 'oder aufs Feld tippen' : 'oder Spieltaste drücken · P pausiert'}
            </span>
            {seedInfo?.note ? (
              <span className="w-full text-xs text-warning">{seedInfo.note}</span>
            ) : null}
          </Overlay>
        ) : null}
      </div>

      {phase === 'over' ? (
        <Ergebnis score={score} submit={submit} accent={accent} onAgain={nochmal} />
      ) : null}

      {coarse ? (
        <TouchPad
          scheme={renderer.touch}
          accent={accent}
          onPress={(key) => taste(key, 'press')}
          onRelease={(key) => taste(key, 'release')}
        />
      ) : null}
    </div>
  );
}

function Overlay({ children, art }: { children: ReactNode; art: 'voll' | 'leiste' }) {
  if (art === 'leiste') {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-gradient-to-t from-black/70 to-transparent px-3 pb-3 pt-8 text-center motion-safe:animate-fade-up [&>*]:pointer-events-auto">
        {children}
      </div>
    );
  }
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/60 p-4 text-center backdrop-blur-[2px] motion-safe:animate-fade-up">
      {children}
    </div>
  );
}

function Ergebnis({
  score,
  submit,
  accent,
  onAgain,
}: {
  score: number;
  submit: SubmitState;
  accent: string;
  onAgain(): void;
}) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 bg-card-gradient p-3 motion-safe:animate-fade-up"
      style={{ borderColor: `${accent}66` }}
      role="status"
    >
      <div className="flex flex-col">
        <span className="text-xs uppercase tracking-widest text-ink-muted">Endstand</span>
        <span className="font-mono text-3xl font-bold tabular-nums" style={{ color: accent }}>
          {formatNumber(score)}
        </span>
      </div>
      <div className="min-w-0 flex-1">
        {submit.status === 'sending' ? (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Spinner /> Wird nachgerechnet …
          </div>
        ) : submit.status === 'ok' ? (
          <div className="flex flex-col gap-1">
            {submit.result.isNewPersonalBest ? (
              <div className="flex items-center gap-1.5 text-lg font-bold text-warning motion-safe:animate-materialize">
                <Icon name="medal" size={20} /> Neuer Bestwert!
              </div>
            ) : null}
            <div className="text-sm text-ink-muted">
              Gewertet: {formatNumber(submit.result.score.score)} Punkte
              {submit.result.personal.rank !== null
                ? ` · Platz ${submit.result.personal.rank}`
                : ''}
            </div>
          </div>
        ) : submit.status === 'error' ? (
          <p className="text-sm text-danger">{submit.message}</p>
        ) : submit.status === 'unranked' ? (
          <p className="text-sm text-warning">{submit.reason}</p>
        ) : null}
      </div>
      <Button
        variant="primary"
        iconLeft="restart"
        onClick={onAgain}
        disabled={submit.status === 'sending'}
      >
        Nochmal
      </Button>
    </div>
  );
}
