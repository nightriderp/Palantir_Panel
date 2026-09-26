'use client';

import {
  ARCADE_BOT_LEVELS,
  ARCADE_BOT_LEVEL_LABELS,
  type ArcadeBotLevel,
  type ArcadeGameDefinition,
} from '@palantir/contracts';
import { type SeatController } from '@palantir/arcade';
import { useState } from 'react';
import {
  Button,
  Icon,
  Panel,
  SelectField,
  TextField,
  cn,
  type IconName,
} from '@/components/shared';
import { seatColor } from './seatColors';
import { type TurnBoardDefinition } from './types';

/**
 * Einstellungen vor einer rundenbasierten Partie.
 *
 * Erst die Spielweise (allein, gegen den Computer, zu mehreren am Gerät,
 * online), dann Sitze und Spieleinstellungen. Menschen und Computer dürfen am
 * Gerät gemischt sitzen – drei Freunde gegen einen schweren Bot ist ein
 * gutes Catan.
 */

export type LocalMode = 'solo' | 'bots' | 'local';
export type SetupMode = LocalMode | 'online';

export interface LocalSeatConfig {
  controller: SeatController;
  name: string;
}

export interface LocalMatchConfig {
  mode: LocalMode;
  seats: LocalSeatConfig[];
  options: unknown;
}

const NAME_MAX = 24;

interface SeatDraft {
  kind: 'human' | 'bot';
  name: string;
  level: ArcadeBotLevel;
}

export function botName(level: ArcadeBotLevel): string {
  return `Computer (${ARCADE_BOT_LEVEL_LABELS[level]})`;
}

/** Welche Spielweisen das Spiel anbietet – Bots nur, wenn die Regeln einen Computergegner haben. */
export function availableModes(
  game: ArcadeGameDefinition,
  board: TurnBoardDefinition,
): SetupMode[] {
  const modes: SetupMode[] = [];
  if (game.modes.solo) modes.push('solo');
  if (game.modes.bots && board.rules.bot) modes.push('bots');
  if (game.modes.local) modes.push('local');
  if (game.modes.online) modes.push('online');
  return modes;
}

const MODE_META: Record<SetupMode, { label: string; hint: string; icon: IconName }> = {
  solo: { label: 'Allein', hint: 'Nur du – auf Punkte oder zum Üben.', icon: 'user' },
  bots: {
    label: 'Gegen Computer',
    hint: 'Du gegen Computergegner in drei Stärken.',
    icon: 'gamepad',
  },
  local: {
    label: 'Am selben Gerät',
    hint: 'Mehrere Menschen reichen das Gerät weiter.',
    icon: 'users',
  },
  online: {
    label: 'Online',
    hint: 'Raum eröffnen oder beitreten – jeder am eigenen Gerät.',
    icon: 'server',
  },
};

function seatBounds(mode: LocalMode, board: TurnBoardDefinition): { min: number; max: number } {
  const { minPlayers, maxPlayers } = board.rules;
  if (mode === 'solo') return { min: Math.max(1, minPlayers), max: Math.max(1, minPlayers) };
  const min = Math.max(2, minPlayers);
  return { min, max: Math.max(min, maxPlayers) };
}

function defaultDraft(mode: LocalMode, index: number, meIndex: number, myName: string): SeatDraft {
  if (mode === 'bots' && index !== meIndex) return { kind: 'bot', name: '', level: 'mittel' };
  return {
    kind: 'human',
    name: index === 0 || index === meIndex ? myName : `Spieler ${index + 1}`,
    level: 'mittel',
  };
}

export interface TurnSetupProps {
  game: ArcadeGameDefinition;
  board: TurnBoardDefinition;
  myName: string;
  onStartLocal(config: LocalMatchConfig): void;
  onOnline(): void;
  /** Zuletzt gespielte Einstellungen – „Nochmal" aus dem Ergebnis kommt ohne Umweg zurück. */
  initial?: LocalMatchConfig | null;
}

export function TurnSetup({
  game,
  board,
  myName,
  onStartLocal,
  onOnline,
  initial = null,
}: TurnSetupProps) {
  const modes = availableModes(game, board);
  const firstLocal = (modes.find((mode) => mode !== 'online') ?? null) as LocalMode | null;
  const [mode, setMode] = useState<LocalMode | null>(initial?.mode ?? firstLocal);
  const [meIndex, setMeIndex] = useState(() =>
    initial?.mode === 'bots'
      ? Math.max(
          0,
          initial.seats.findIndex((s) => s.controller.type === 'human'),
        )
      : 0,
  );
  const [drafts, setDrafts] = useState<SeatDraft[]>(() =>
    initial
      ? initial.seats.map((seat) => ({
          kind: seat.controller.type,
          name: seat.controller.type === 'human' ? seat.name : '',
          level: seat.controller.type === 'bot' ? seat.controller.level : 'mittel',
        }))
      : [],
  );
  const [options, setOptions] = useState<unknown>(
    () => initial?.options ?? board.rules.defaultOptions,
  );
  const [fehler, setFehler] = useState<string | null>(null);

  const bounds = mode ? seatBounds(mode, board) : { min: 1, max: 1 };
  const count = Math.min(bounds.max, Math.max(bounds.min, drafts.length || bounds.min));
  const seats: SeatDraft[] = mode
    ? Array.from(
        { length: count },
        (_, index) => drafts[index] ?? defaultDraft(mode, index, meIndex, myName),
      )
    : [];

  const modusWaehlen = (next: SetupMode) => {
    if (next === 'online') {
      onOnline();
      return;
    }
    setMode(next);
    setFehler(null);
    const b = seatBounds(next, board);
    const n = next === 'solo' ? b.min : Math.min(b.max, Math.max(b.min, 2));
    setMeIndex(0);
    setDrafts(Array.from({ length: n }, (_, index) => defaultDraft(next, index, 0, myName)));
  };

  const anzahl = (n: number) => {
    if (!mode) return;
    setDrafts(
      Array.from(
        { length: n },
        (_, index) => seats[index] ?? defaultDraft(mode, index, meIndex, myName),
      ),
    );
  };

  const aendern = (index: number, patch: Partial<SeatDraft>) => {
    setDrafts(seats.map((seat, i) => (i === index ? { ...seat, ...patch } : seat)));
  };

  const platzWaehlen = (index: number) => {
    if (!mode) return;
    setMeIndex(index);
    setDrafts(
      seats.map((seat, i) =>
        i === index ? { ...seat, kind: 'human', name: myName } : { ...seat, kind: 'bot' },
      ),
    );
  };

  const starten = () => {
    if (!mode) return;
    const parsed: unknown = board.rules.parseOptions(options);
    if (parsed === null) {
      setFehler('Diese Einstellungen passen nicht zum Spiel.');
      return;
    }
    const config: LocalMatchConfig = {
      mode,
      options: parsed,
      seats: seats.map((seat, index) =>
        seat.kind === 'bot' && board.rules.bot
          ? { controller: { type: 'bot', level: seat.level }, name: botName(seat.level) }
          : { controller: { type: 'human' }, name: seat.name.trim() || `Spieler ${index + 1}` },
      ),
    };
    if (!config.seats.some((seat) => seat.controller.type === 'human')) {
      setFehler('Mindestens ein Mensch muss mitspielen.');
      return;
    }
    onStartLocal(config);
  };

  const OptionsForm = board.OptionsForm;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {modes.map((key) => {
          const meta = MODE_META[key];
          const gewaehlt = key === mode;
          return (
            <button
              key={key}
              type="button"
              onClick={() => modusWaehlen(key)}
              aria-pressed={key === 'online' ? undefined : gewaehlt}
              className={cn(
                'flex flex-col items-start gap-1 rounded-xl border-2 p-3 text-left transition',
                'hover:-translate-y-0.5 motion-reduce:hover:translate-y-0',
                gewaehlt ? 'bg-fill-strong' : 'border-line bg-fill hover:border-line-strong',
              )}
              style={gewaehlt ? { borderColor: game.accent } : undefined}
            >
              <span className="flex items-center gap-2 text-base font-semibold text-ink">
                <Icon name={meta.icon} size={16} style={{ color: game.accent }} />
                {meta.label}
              </span>
              <span className="text-xs text-ink-muted">{meta.hint}</span>
            </button>
          );
        })}
      </div>

      {mode ? (
        <Panel variant="outline" className="flex flex-col gap-4">
          {bounds.max > bounds.min ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-muted">Anzahl Sitze</span>
              {Array.from({ length: bounds.max - bounds.min + 1 }, (_, i) => bounds.min + i).map(
                (n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => anzahl(n)}
                    aria-pressed={n === count}
                    className={cn(
                      'h-9 min-w-9 rounded-lg border px-2 font-mono text-sm',
                      n === count
                        ? 'border-brand-line bg-brand-soft text-brand'
                        : 'border-line bg-fill text-ink-muted hover:text-ink',
                    )}
                  >
                    {n}
                  </button>
                ),
              )}
            </div>
          ) : null}

          {mode !== 'solo' ? (
            <ul className="flex flex-col gap-2">
              {seats.map((seat, index) => (
                <li
                  key={index}
                  className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-fill p-2.5"
                >
                  <span
                    aria-hidden
                    className="mb-2 h-4 w-4 shrink-0 rounded-full"
                    style={{ background: seatColor(index) }}
                  />
                  <span className="mb-2 w-14 shrink-0 text-sm text-ink-muted">
                    Sitz {index + 1}
                  </span>
                  {mode === 'bots' ? (
                    index === meIndex ? (
                      <span className="mb-2 flex-1 text-sm font-semibold text-ink">
                        {myName} (du)
                      </span>
                    ) : (
                      <>
                        <SelectField
                          className="min-w-32 flex-1"
                          label="Stärke"
                          value={seat.level}
                          onChange={(value) => aendern(index, { level: value as ArcadeBotLevel })}
                          options={ARCADE_BOT_LEVELS.map((level) => ({
                            value: level,
                            label: botName(level),
                          }))}
                        />
                        <Button variant="ghost" size="sm" onClick={() => platzWaehlen(index)}>
                          Hier sitzen
                        </Button>
                      </>
                    )
                  ) : (
                    <>
                      {board.rules.bot ? (
                        <SelectField
                          className="w-36"
                          label="Wer"
                          value={seat.kind}
                          onChange={(value) => aendern(index, { kind: value as 'human' | 'bot' })}
                          options={[
                            { value: 'human', label: 'Mensch' },
                            { value: 'bot', label: 'Computer' },
                          ]}
                        />
                      ) : null}
                      {seat.kind === 'human' || !board.rules.bot ? (
                        <TextField
                          className="min-w-32 flex-1"
                          label="Name"
                          value={seat.name}
                          placeholder={`Spieler ${index + 1}`}
                          onChange={(value) => aendern(index, { name: value.slice(0, NAME_MAX) })}
                        />
                      ) : (
                        <SelectField
                          className="min-w-32 flex-1"
                          label="Stärke"
                          value={seat.level}
                          onChange={(value) => aendern(index, { level: value as ArcadeBotLevel })}
                          options={ARCADE_BOT_LEVELS.map((level) => ({
                            value: level,
                            label: ARCADE_BOT_LEVEL_LABELS[level],
                          }))}
                        />
                      )}
                    </>
                  )}
                </li>
              ))}
            </ul>
          ) : null}

          {OptionsForm ? (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold text-ink">Einstellungen</span>
              <OptionsForm value={options} onChange={setOptions} seatCount={count} />
            </div>
          ) : null}

          {fehler ? <p className="text-sm text-danger">{fehler}</p> : null}

          <div className="flex flex-wrap gap-2">
            <Button variant="primary" iconLeft="play" onClick={starten}>
              Partie starten
            </Button>
          </div>
        </Panel>
      ) : null}
    </div>
  );
}
