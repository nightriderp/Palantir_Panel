'use client';

import { useEffect, useRef, useState } from 'react';
import { Button, cn } from '@/components/shared';
import { type TurnBoardProps } from '../../types';
import { Gallows } from './Gallows';

/**
 * Brett für Galgenmännchen.
 *
 * Die Wortgeberin tippt ihr Wort hier ein; am selben Gerät legt der Wirt davor
 * und danach den Vorhang, damit niemand mitliest. Geraten wird über die
 * Bildschirmtastatur oder die echte Tastatur, sobald kein Eingabefeld den
 * Fokus hat.
 */

interface RoundResult {
  setter: number;
  word: string;
  solved: boolean;
  solver: number | null;
}

interface GalgenView {
  mode: 'solo' | 'multi';
  players: number;
  round: number;
  rounds: number;
  setter: number;
  phase: 'wort' | 'raten';
  turn: number;
  pattern: (string | null)[];
  hint: string;
  category: string;
  guessed: string[];
  wrongLetters: string[];
  wrong: number;
  maxWrong: number;
  scores: number[];
  word: string | null;
  results: RoundResult[];
  lastGuess: { seat: number; guess: string; correct: boolean } | null;
  over: boolean;
}

type GalgenMove =
  | { type: 'setzeWort'; wort: string; hinweis: string }
  | { type: 'buchstabe'; b: string }
  | { type: 'loesung'; wort: string };

const KEY_ROWS = ['QWERTZUIOPÜ', 'ASDFGHJKLÖÄ', 'YXCVBNMß'];
const LETTERS = new Set([...KEY_ROWS.join('')]);

function upperGerman(text: string): string {
  let out = '';
  for (const ch of text) out += ch === 'ß' ? 'ß' : ch.toUpperCase();
  return out;
}

/** Vorab-Prüfung wie in der Regel, damit die Wortgeberin gleich sieht, was fehlt. */
function wordProblem(raw: string): string | null {
  const w = upperGerman(raw.trim().replace(/\s+/g, ' '));
  if (w.length === 0) return 'Bitte ein Wort eingeben.';
  let letters = 0;
  for (const ch of w) {
    if (LETTERS.has(ch)) letters += 1;
    else if (ch !== ' ' && ch !== '-')
      return `„${ch}" ist nicht erlaubt – nur Buchstaben, Bindestrich und Leerzeichen.`;
  }
  if (letters < 3) return 'Mindestens 3 Buchstaben.';
  if (letters > 24) return 'Höchstens 24 Buchstaben.';
  return null;
}

export function Board({
  view,
  mySeat,
  seats,
  canAct,
  onMove,
  sfx,
  finished,
}: TurnBoardProps<GalgenView, GalgenMove>) {
  const [word, setWord] = useState('');
  const [hint, setHint] = useState('');
  const [solution, setSolution] = useState('');
  const active = canAct && !finished;
  const guessing = active && view.phase === 'raten';
  const setting = active && view.phase === 'wort' && mySeat === view.setter;
  const nameOf = (seat: number) => seats[seat]?.name ?? `Sitz ${seat + 1}`;

  // Klänge aus Zustandswechseln – so klingt es auch, wenn andere raten.
  const prev = useRef({
    wrong: view.wrong,
    guessed: view.guessed.length,
    results: view.results.length,
    over: view.over,
  });
  useEffect(() => {
    const p = prev.current;
    if (view.over && !p.over) {
      const solo = view.mode === 'solo';
      const won = solo
        ? view.results[0]?.solved === true
        : mySeat !== null && view.scores[mySeat] === Math.max(...view.scores);
      sfx(won ? 'win' : 'lose');
    } else if (view.results.length > p.results) {
      sfx(view.results[view.results.length - 1]?.solved ? 'score' : 'lose');
    } else if (view.wrong > p.wrong) {
      sfx('hit');
    } else if (view.guessed.length > p.guessed) {
      sfx('coin');
    }
    prev.current = {
      wrong: view.wrong,
      guessed: view.guessed.length,
      results: view.results.length,
      over: view.over,
    };
  }, [view, mySeat, sfx]);

  // Echte Tastatur: Buchstaben raten, solange kein Textfeld aktiv ist.
  function guess(b: string) {
    if (!guessing) return;
    if (view.guessed.includes(b) || view.wrongLetters.includes(b)) return;
    onMove({ type: 'buchstabe', b });
  }
  const guessRef = useRef<(b: string) => void>(() => undefined);
  useEffect(() => {
    guessRef.current = guess;
  });
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1) return;
      const b = upperGerman(e.key);
      if (LETTERS.has(b)) guessRef.current(b);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const lastRound = view.results[view.results.length - 1];
  const problem = word ? wordProblem(word) : null;
  const lost = view.mode === 'solo' && view.over && view.results[0]?.solved === false;
  const won = view.mode === 'solo' && view.over && view.results[0]?.solved === true;

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-3 px-1 pb-3">
      {/* Kopf: Runde, Hinweis */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
        {view.mode === 'multi' ? (
          <span>
            Runde <b className="text-ink">{Math.min(view.round + 1, view.rounds)}</b> von{' '}
            {view.rounds} · Wort von{' '}
            <b style={{ color: seats[view.setter]?.color }}>{nameOf(view.setter)}</b>
          </span>
        ) : (
          <span>
            Kategorie: <b className="text-ink">{view.category}</b>
          </span>
        )}
        <span>
          Fehler{' '}
          <b className={cn(view.wrong >= view.maxWrong - 2 ? 'text-danger' : 'text-ink')}>
            {view.wrong}/{view.maxWrong}
          </b>
        </span>
      </div>

      <div
        className="grid gap-3 rounded-tile border border-line-strong p-3 sm:grid-cols-[200px_1fr] sm:items-center"
        style={{
          background: 'radial-gradient(ellipse at 20% 0%, rgba(232,121,249,0.18), transparent 60%)',
        }}
      >
        <div className="flex justify-center">
          <Gallows wrong={view.phase === 'wort' ? 0 : view.wrong} lost={lost} won={won} />
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          {view.phase === 'wort' && !view.over ? (
            setting ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (wordProblem(word)) return;
                  onMove({ type: 'setzeWort', wort: word, hinweis: hint });
                  sfx('place');
                  setWord('');
                  setHint('');
                }}
              >
                <label className="text-sm text-ink-muted" htmlFor="galgen-wort">
                  Denk dir ein Wort aus (3–24 Buchstaben):
                </label>
                <input
                  id="galgen-wort"
                  type="password"
                  autoComplete="off"
                  maxLength={30}
                  value={word}
                  onChange={(e) => setWord(e.target.value)}
                  className="min-h-[44px] rounded-tile border border-line-strong bg-surface-deep px-3 text-lg uppercase tracking-widest text-ink"
                  placeholder="Geheimes Wort"
                />
                <input
                  type="text"
                  autoComplete="off"
                  maxLength={60}
                  value={hint}
                  onChange={(e) => setHint(e.target.value)}
                  className="min-h-[44px] rounded-tile border border-line-strong bg-surface-deep px-3 text-md text-ink"
                  placeholder="Hinweis (freiwillig)"
                />
                {problem && <p className="text-sm text-danger">{problem}</p>}
                <Button type="submit" variant="primary" disabled={!word || problem !== null}>
                  Wort festlegen
                </Button>
                <p className="text-xs text-ink-faint">
                  Das Feld ist verdeckt, damit niemand über die Schulter schaut.
                </p>
              </form>
            ) : (
              <p className="py-6 text-center text-md text-ink-muted">
                <b style={{ color: seats[view.setter]?.color }}>{nameOf(view.setter)}</b> denkt sich
                ein Wort aus …
              </p>
            )
          ) : (
            <>
              <WordPattern pattern={view.pattern} lastGuess={view.lastGuess} />
              {view.hint && (
                <p className="text-center text-sm text-ink-muted">
                  Hinweis: <span className="text-ink">{view.hint}</span>
                </p>
              )}
              {view.word && !view.over && (
                <p className="text-center text-xs text-ink-faint">
                  Dein Wort:{' '}
                  <span className="font-semibold tracking-wider text-ink-muted">{view.word}</span>
                </p>
              )}
              {view.over && view.word && (
                <p className="text-center text-md text-ink">
                  Das Wort war <b className="tracking-wider">{view.word}</b>.
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {view.phase === 'raten' && !view.over && (
        <>
          {view.mode === 'multi' && (
            <p className="text-center text-sm text-ink-muted">
              {mySeat === view.turn ? (
                <b className="text-ink">Du bist dran.</b>
              ) : (
                <>
                  <b style={{ color: seats[view.turn]?.color }}>{nameOf(view.turn)}</b> rät gerade.
                </>
              )}
            </p>
          )}
          <div className="flex flex-col items-center gap-1.5" aria-label="Buchstaben">
            {KEY_ROWS.map((row) => (
              <div key={row} className="flex w-full justify-center gap-1">
                {[...row].map((b) => {
                  const hit = view.guessed.includes(b);
                  const miss = view.wrongLetters.includes(b);
                  const used = hit || miss;
                  const isLast = view.lastGuess?.guess === b;
                  return (
                    <button
                      key={b}
                      type="button"
                      disabled={!guessing || used}
                      onClick={() => guess(b)}
                      className={cn(
                        'h-11 min-w-0 max-w-[44px] flex-1 rounded-[7px] border text-md font-bold transition-all duration-200',
                        hit && 'border-emerald-400/60 bg-emerald-500/25 text-emerald-200',
                        miss && 'border-rose-400/40 bg-rose-500/15 text-rose-300/70 line-through',
                        !used && 'border-line-strong bg-fill text-ink',
                        !used &&
                          guessing &&
                          'hover:-translate-y-0.5 hover:border-fuchsia-300 hover:bg-fuchsia-500/20',
                        !guessing && !used && 'opacity-60',
                        isLast && 'ring-2 ring-fuchsia-300',
                      )}
                    >
                      {b}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>

          {guessing && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const w = solution.trim();
                if (!w) return;
                onMove({ type: 'loesung', wort: w });
                setSolution('');
              }}
            >
              <input
                type="text"
                autoComplete="off"
                maxLength={60}
                value={solution}
                onChange={(e) => setSolution(e.target.value)}
                placeholder="Ganzes Wort raten …"
                className="min-h-[44px] min-w-0 flex-1 rounded-tile border border-line-strong bg-surface-deep px-3 text-md text-ink"
              />
              <Button type="submit" variant="secondary" disabled={!solution.trim()}>
                Lösen
              </Button>
            </form>
          )}
        </>
      )}

      {view.mode === 'multi' && (
        <div className="rounded-tile border border-line-strong bg-surface-deep/60 p-2">
          <table className="w-full text-sm">
            <tbody>
              {view.scores.map((score, seat) => (
                <tr
                  key={seat}
                  className={cn(
                    'transition-colors',
                    !view.over &&
                      view.phase === 'raten' &&
                      seat === view.turn &&
                      'bg-fuchsia-500/10',
                  )}
                >
                  <td className="py-1 pl-2">
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
                      style={{ background: seats[seat]?.color }}
                    />
                    {nameOf(seat)}
                    {!view.over && seat === view.setter && (
                      <span className="ml-2 text-xs text-ink-faint">(Wortgeber)</span>
                    )}
                  </td>
                  <td className="py-1 pr-2 text-right font-bold text-ink">{score}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {view.results.length > 0 && (
            <ul className="mt-2 space-y-0.5 border-t border-line-strong pt-2 text-xs text-ink-muted">
              {view.results.map((r, i) => (
                <li key={i}>
                  Runde {i + 1}: <b className="tracking-wider text-ink">{r.word}</b> –{' '}
                  {r.solved && r.solver !== null
                    ? `gelöst von ${nameOf(r.solver)}`
                    : `${nameOf(r.setter)} bleibt ungeschlagen`}
                </li>
              ))}
            </ul>
          )}
          {lastRound && !view.over && view.phase === 'wort' && (
            <p className="mt-1 text-xs text-ink-faint">Letztes Wort: {lastRound.word}</p>
          )}
        </div>
      )}
    </div>
  );
}

function WordPattern({
  pattern,
  lastGuess,
}: {
  pattern: (string | null)[];
  lastGuess: GalgenView['lastGuess'];
}) {
  // Wörter getrennt umbrechen lassen, damit „Straßen Bahn" auf schmalen Bildschirmen nicht mitten im Wort bricht.
  const words: { ch: string | null; i: number }[][] = [[]];
  pattern.forEach((ch, i) => {
    if (ch === ' ') words.push([]);
    else words[words.length - 1]?.push({ ch, i });
  });
  const long = pattern.length > 12;
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-2">
      {words.map((w, wi) => (
        <div key={wi} className="flex gap-1">
          {w.map(({ ch, i }) => (
            <span
              key={i}
              className={cn(
                'flex items-end justify-center border-b-2 font-black transition-all duration-300',
                long
                  ? 'h-8 w-5 text-xl sm:h-9 sm:w-7 sm:text-2xl'
                  : 'h-10 w-7 text-3xl sm:w-9 sm:text-4xl',
                ch === null
                  ? 'border-fuchsia-300/60 text-transparent'
                  : 'border-fuchsia-300 text-ink',
                ch !== null && lastGuess?.correct && lastGuess.guess === ch && 'text-fuchsia-200',
                ch === '-' && 'border-transparent',
              )}
            >
              {ch ?? '·'}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}
