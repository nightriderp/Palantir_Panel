'use client';

import { type ArcadeGameDefinition, type ArcadeSubmitResultDto } from '@palantir/contracts';
import {
  applyRawMove,
  createMatch,
  nextBotSeat,
  stepBot,
  type RecordedMove,
  type TurnMatch,
} from '@palantir/arcade';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Modal, Panel, Spinner, formatNumber, useToast } from '@/components/shared';
import { errorText, isAborted } from '@/lib/api/client';
import { requestArcadeSeed, submitArcadeRun } from '@/lib/arcade/api';
import { useArcadeAudio } from '@/lib/arcade/audio/ArcadeAudioProvider';
import {
  RANKING_REASON_TEXT,
  activeHumanSeats,
  botDelayMs,
  chooseViewSeat,
  humanSeats,
  needsCurtain,
  rankingDecision,
} from './hostLogic';
import { BoardFrame, MatchLog, OutcomeSummary, SeatList } from './parts';
import { seatColor } from './seatColors';
import { type LocalMatchConfig } from './TurnSetup';
import { type TurnBoardDefinition, type TurnSeatInfo } from './types';

/**
 * Wirt für Partien im Browser: allein, gegen den Computer, am selben Gerät.
 *
 * Die Regeln laufen hier; Bots ziehen mit kurzer Verzögerung, damit man ihre
 * Züge mitbekommt. Spielt genau ein Mensch (allein oder gegen Bots), holt der
 * Wirt vorher einen Startwert vom Backend und zeichnet die Menschenzüge auf –
 * am Ende rechnet das Backend die Partie mit denselben Regeln nach, bevor ein
 * Sieg in die Bestenliste darf.
 */

type SubmitState =
  | { status: 'idle' }
  | { status: 'skipped'; reason: string }
  | { status: 'sending' }
  | { status: 'ok'; result: ArcadeSubmitResultDto }
  | { status: 'error'; message: string };

export interface LocalTurnHostProps {
  game: ArcadeGameDefinition;
  board: TurnBoardDefinition;
  config: LocalMatchConfig;
  onAgain(): void;
  onExit(): void;
  onSubmitted?(result: ArcadeSubmitResultDto): void;
}

/** JSON-Kopie – so bekommt das Backend genau das, was hier angewandt wurde. */
function jsonKopie(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value ?? null)) as unknown;
}

function zufallsStart(): number {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

export function LocalTurnHost({
  game,
  board,
  config,
  onAgain,
  onExit,
  onSubmitted,
}: LocalTurnHostProps) {
  const { rules, Board } = board;
  const { sfx } = useArcadeAudio();
  const toast = useToast();
  const controllers = useMemo(() => config.seats.map((seat) => seat.controller), [config.seats]);
  const menschen = useMemo(() => humanSeats(controllers), [controllers]);
  const onSubmittedRef = useRef(onSubmitted);
  useEffect(() => {
    onSubmittedRef.current = onSubmitted;
  });

  const [match, setMatch] = useState<TurnMatch | null>(null);
  const [seedId, setSeedId] = useState<string | null>(null);
  const [seedNote, setSeedNote] = useState<string | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [moves, setMoves] = useState<RecordedMove[]>([]);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [revealedSeat, setRevealedSeat] = useState<number | null>(null);
  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });
  const [ergebnisOffen, setErgebnisOffen] = useState(true);

  // --- Partie anlegen ---------------------------------------------------------
  useEffect(() => {
    const controller = new AbortController();
    const anlegen = (seed: number, id: string | null, note: string | null) => {
      if (controller.signal.aborted) return;
      try {
        setMatch(createMatch(rules, seed, config.options, controllers) as TurnMatch);
        setSeedId(id);
        setSeedNote(note);
      } catch (error) {
        setFehler(error instanceof Error ? error.message : 'Die Partie ließ sich nicht anlegen.');
      }
    };
    // Nur mit genau einem Menschen gibt es etwas zu werten. Gefragt wird ohne
    // Blick auf die Anmeldung – das Backend entscheidet (siehe RealtimeHost).
    const wertbar = controllers.filter((c) => c.type === 'human').length === 1;
    if (wertbar) {
      void requestArcadeSeed(game.id, controller.signal).then((result) => {
        if (result.success) anlegen(result.data.seed, result.data.seedId, null);
        else if (!isAborted(result))
          anlegen(zufallsStart(), null, `Ohne Wertung: ${errorText(result)}`);
      });
    } else {
      void Promise.resolve().then(() => anlegen(zufallsStart(), null, null));
    }
    return () => controller.abort();
  }, [rules, config.options, controllers, game.id]);

  // --- Ende der Partie ---------------------------------------------------------
  const abschliessen = useCallback(
    (fertig: TurnMatch, alleZuege: RecordedMove[]) => {
      const outcome = rules.outcome(fertig.state);
      if (!outcome) return;
      setErgebnisOffen(true);
      const einzig = menschen.length === 1 ? menschen[0] : undefined;
      if (einzig === undefined) sfx('win');
      else sfx(outcome.winners.includes(einzig) ? 'win' : 'lose');

      const entscheidung = rankingDecision({
        seats: controllers,
        metric: game.metric,
        outcome,
        hasSeed: seedId !== null,
      });
      if (!entscheidung.submit) {
        setSubmit({ status: 'skipped', reason: RANKING_REASON_TEXT[entscheidung.reason] });
        return;
      }
      setSubmit({ status: 'sending' });
      const punkte = outcome.scores?.[entscheidung.humanSeat];
      void submitArcadeRun({
        gameId: game.id,
        seedId: seedId as string,
        match: { options: config.options, seats: controllers, moves: alleZuege },
        claimedScore:
          game.metric === 'score' && typeof punkte === 'number'
            ? Math.max(0, Math.floor(punkte))
            : undefined,
      }).then((result) => {
        if (!result.success) {
          setSubmit({ status: 'error', message: errorText(result) });
          return;
        }
        setSubmit({ status: 'ok', result: result.data });
        onSubmittedRef.current?.(result.data);
      });
    },
    [rules, menschen, sfx, controllers, game.metric, game.id, seedId, config.options],
  );

  // --- Bots ------------------------------------------------------------------
  const botSeat = match ? nextBotSeat(rules, match) : null;
  useEffect(() => {
    if (!match || nextBotSeat(rules, match) === null) return;
    const timer = setTimeout(() => {
      try {
        const next = stepBot(rules, match);
        if (!next) return;
        setMatch(next);
        if (rules.outcome(next.state)) abschliessen(next, moves);
      } catch (error) {
        setFehler(
          error instanceof Error ? error.message : 'Der Computergegner hat sich verrechnet.',
        );
      }
    }, botDelayMs(Math.random()));
    return () => clearTimeout(timer);
  }, [match, rules, moves, abschliessen]);

  // --- Sicht ------------------------------------------------------------------
  const activeSeats = useMemo(() => (match ? rules.activeSeats(match.state) : []), [match, rules]);
  const outcome = match ? rules.outcome(match.state) : null;
  const finished = outcome !== null;
  const lastHumanSeat = moves.length > 0 ? (moves[moves.length - 1]?.seat ?? null) : null;
  const viewSeat = chooseViewSeat({ seats: controllers, activeSeats, lastHumanSeat, selectedSeat });
  const aktiveMenschen = activeHumanSeats(controllers, activeSeats);
  const vorhang = needsCurtain({
    hiddenInformation: rules.hiddenInformation,
    seats: controllers,
    revealedSeat,
    viewSeat,
    finished,
  });
  // Ohne useMemo: Der React-Compiler merkt sich das selbst, und eine eigene
  // Merkliste über `viewSeat` konnte er nicht übernehmen.
  const view: unknown = match ? rules.view(match.state, viewSeat) : null;
  const log = match ? rules.log(match.state) : [];

  const seats: TurnSeatInfo[] = config.seats.map((seat, index) => ({
    index,
    name: seat.name,
    kind: seat.controller.type,
    color: seatColor(index),
    isMe: index === viewSeat,
  }));

  // Klang, wenn ein Mensch an die Reihe kommt (nach Bots oder Weitergabe).
  const amZug = aktiveMenschen.join(',');
  useEffect(() => {
    if (amZug !== '' && (match?.moveCount ?? 0) > 0 && !finished) sfx('turn');
    // Nur beim Wechsel der Menschen am Zug – nicht bei jedem Zug desselben.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amZug]);

  const canAct =
    match !== null && viewSeat !== null && activeSeats.includes(viewSeat) && !finished && !vorhang;

  const onMove = (move: unknown) => {
    if (!match || viewSeat === null || !canAct) return;
    const raw = jsonKopie(move);
    const result = applyRawMove(rules, match, viewSeat, raw);
    if (!result.ok) {
      sfx('error');
      toast.warning(result.error);
      return;
    }
    const alle = [...moves, { seat: viewSeat, move: raw }];
    setMoves(alle);
    // Wer gezogen hat, bleibt in seiner Sicht, solange er dran ist.
    setSelectedSeat(viewSeat);
    setRevealedSeat(viewSeat);
    setMatch(result.state as TurnMatch);
    if (rules.outcome((result.state as TurnMatch).state))
      abschliessen(result.state as TurnMatch, alle);
  };

  if (fehler) {
    return (
      <Panel variant="outline" className="flex flex-col items-start gap-3">
        <p className="text-base text-danger">{fehler}</p>
        <div className="flex gap-2">
          <Button variant="secondary" iconLeft="restart" onClick={onAgain}>
            Neue Partie
          </Button>
          <Button variant="ghost" onClick={onExit}>
            Zurück
          </Button>
        </div>
      </Panel>
    );
  }

  if (!match) {
    return (
      <div className="flex items-center gap-2 p-6 text-ink-muted">
        <Spinner /> Partie wird vorbereitet …
      </div>
    );
  }

  const zeigeName = viewSeat !== null ? (seats[viewSeat]?.name ?? '') : '';

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="flex min-w-0 flex-col gap-3">
        {aktiveMenschen.length > 1 && !finished ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sicht wählen">
            <span className="text-sm text-ink-muted">Gleichzeitig am Zug:</span>
            {aktiveMenschen.map((seat) => (
              <Button
                key={seat}
                size="sm"
                variant={seat === viewSeat ? 'primary' : 'secondary'}
                onClick={() => setSelectedSeat(seat)}
              >
                {seats[seat]?.name}
              </Button>
            ))}
          </div>
        ) : null}

        {seedNote ? <p className="text-sm text-warning">{seedNote}</p> : null}

        <BoardFrame accent={game.accent}>
          {vorhang ? (
            <button
              type="button"
              className="flex min-h-[320px] w-full flex-col items-center justify-center gap-3 bg-surface-deep p-6 text-center"
              onClick={() => {
                setRevealedSeat(viewSeat);
                sfx('click');
              }}
            >
              <span
                className="h-14 w-14 rounded-full motion-safe:animate-pulse-dot"
                style={{ background: viewSeat !== null ? seatColor(viewSeat) : undefined }}
                aria-hidden
              />
              <span className="text-xl font-bold text-ink">Gib das Gerät an {zeigeName}</span>
              <span className="text-sm text-ink-muted">Tippen zum Aufdecken</span>
            </button>
          ) : (
            <Board
              view={view}
              mySeat={viewSeat}
              seats={seats}
              activeSeats={activeSeats}
              canAct={canAct}
              onMove={onMove}
              sfx={sfx}
              finished={finished}
            />
          )}
        </BoardFrame>

        {finished && !ergebnisOffen ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" iconLeft="restart" onClick={onAgain}>
              Nochmal
            </Button>
            <Button variant="secondary" onClick={() => setErgebnisOffen(true)}>
              Ergebnis
            </Button>
            <Button variant="ghost" iconLeft="arrowLeft" onClick={onExit}>
              Zurück
            </Button>
          </div>
        ) : null}
      </div>

      <aside className="flex flex-col gap-4">
        <Panel className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">Am Tisch</h3>
          <SeatList
            seats={seats}
            activeSeats={finished ? [] : activeSeats}
            winners={outcome?.winners ?? []}
            scores={outcome?.scores}
            extras={botSeat !== null ? { [botSeat]: { thinking: true } } : {}}
          />
        </Panel>
        <Panel className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-ink">Spielverlauf</h3>
          <MatchLog entries={log} seats={seats} />
        </Panel>
        {!finished ? (
          <Button variant="ghost" iconLeft="arrowLeft" onClick={onExit}>
            Partie verlassen
          </Button>
        ) : null}
      </aside>

      {outcome ? (
        <Modal
          open={ergebnisOffen}
          onClose={() => setErgebnisOffen(false)}
          title="Partie vorbei"
          footer={
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={() => setErgebnisOffen(false)}>
                Brett ansehen
              </Button>
              <Button variant="secondary" iconLeft="arrowLeft" onClick={onExit}>
                Zurück
              </Button>
              <Button variant="primary" iconLeft="restart" onClick={onAgain}>
                Nochmal
              </Button>
            </div>
          }
        >
          <div className="flex flex-col gap-4">
            <OutcomeSummary
              winners={outcome.winners}
              summary={outcome.summary}
              scores={outcome.scores}
              seats={seats}
            />
            <Wertung submit={submit} metric={game.metric} />
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Wertung({
  submit,
  metric,
}: {
  submit: SubmitState;
  metric: ArcadeGameDefinition['metric'];
}) {
  if (submit.status === 'idle') return null;
  if (submit.status === 'sending') {
    return (
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Spinner /> Partie wird nachgerechnet …
      </p>
    );
  }
  if (submit.status === 'skipped') return <p className="text-sm text-ink-muted">{submit.reason}</p>;
  if (submit.status === 'error') return <p className="text-sm text-danger">{submit.message}</p>;
  const { result } = submit;
  return (
    <div className="rounded-xl border border-success-line bg-success-soft p-3 text-sm text-success">
      {result.isNewPersonalBest && metric === 'score' ? (
        <strong className="block">Neuer Bestwert!</strong>
      ) : null}
      {metric === 'wins'
        ? `Sieg gewertet – ${formatNumber(result.personal.bestScore)} ${result.personal.bestScore === 1 ? 'Sieg' : 'Siege'} insgesamt`
        : `Gewertet: ${formatNumber(result.score.score)} Punkte`}
      {result.personal.rank !== null ? ` · Platz ${result.personal.rank}` : ''}
    </div>
  );
}
