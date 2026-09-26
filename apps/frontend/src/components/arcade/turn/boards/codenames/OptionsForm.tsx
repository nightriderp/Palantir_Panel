'use client';

import { cn } from '@/components/shared';
import { CN_KATEGORIEN, type CnOptions, type CnSitz, autoTeams } from './shared';

function lies(value: unknown): CnOptions {
  const v = (value ?? {}) as Partial<CnOptions>;
  return {
    teams: Array.isArray(v.teams) ? v.teams : null,
    kategorie: CN_KATEGORIEN.some((k) => k.id === v.kategorie)
      ? (v.kategorie as CnOptions['kategorie'])
      : 'alle',
  };
}

function fehler(teams: CnSitz[]): string | null {
  if (teams.length < 4) {
    const chefs = teams.filter((s) => s.rolle === 'chef').length;
    if (chefs !== 1) return 'Im Zusammenspiel braucht es genau einen Chef.';
    return null;
  }
  for (const team of ['rot', 'blau'] as const) {
    const m = teams.filter((s) => s.team === team);
    const name = team === 'rot' ? 'Rot' : 'Blau';
    if (m.filter((s) => s.rolle === 'chef').length !== 1)
      return `Team ${name} braucht genau einen Chef.`;
    if (m.filter((s) => s.rolle === 'agent').length < 1)
      return `Team ${name} braucht mindestens einen Agenten.`;
  }
  return null;
}

export function OptionsForm({
  value,
  onChange,
  seatCount,
}: {
  value: unknown;
  onChange(value: CnOptions): void;
  seatCount: number;
}) {
  const opts = lies(value);
  const koop = seatCount < 4;
  const eigene = opts.teams !== null && opts.teams.length === seatCount;
  const teams = eigene && opts.teams ? opts.teams : autoTeams(seatCount);
  const problem = eigene ? fehler(teams) : null;

  const setzeSitz = (i: number, patch: Partial<CnSitz>) => {
    const next = teams.map((s, j) => (j === i ? { ...s, ...patch } : s));
    onChange({ ...opts, teams: next });
  };

  return (
    <div className="space-y-4 text-sm">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Begriffe
        </p>
        <div className="flex flex-wrap gap-1.5">
          {CN_KATEGORIEN.map((k) => (
            <button
              key={k.id}
              type="button"
              onClick={() => onChange({ ...opts, kategorie: k.id })}
              className={cn(
                'min-h-9 rounded-full border px-3 text-xs font-semibold transition-colors',
                opts.kategorie === k.id
                  ? 'border-blue-400 bg-blue-500/20 text-blue-200'
                  : 'border-line-strong bg-fill text-ink-muted',
              )}
            >
              {k.name}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            {koop ? 'Rollen (Zusammenspiel gegen die Uhr)' : 'Teams und Rollen'}
          </p>
          <button
            type="button"
            onClick={() => onChange({ ...opts, teams: eigene ? null : autoTeams(seatCount) })}
            className="min-h-9 rounded-full border border-line-strong bg-fill px-3 text-xs font-semibold text-ink"
          >
            {eigene ? 'Automatisch' : 'Selbst festlegen'}
          </button>
        </div>
        {!eigene && (
          <p className="mb-2 text-xs text-ink-faint">
            {koop
              ? 'Spieler 1 ist Chef, alle anderen raten.'
              : 'Abwechselnd Rot und Blau, der Erste jedes Teams ist Chef.'}
          </p>
        )}
        <ul className="space-y-1.5">
          {teams.map((s, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-20 shrink-0 text-ink-muted">Spieler {i + 1}</span>
              {!koop && (
                <div className="flex overflow-hidden rounded-full border border-line-strong">
                  {(['rot', 'blau'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      disabled={!eigene}
                      onClick={() => setzeSitz(i, { team: t })}
                      className={cn(
                        'min-h-9 px-3 text-xs font-semibold transition-colors disabled:cursor-default',
                        s.team === t
                          ? t === 'rot'
                            ? 'bg-red-500 text-white'
                            : 'bg-blue-500 text-white'
                          : 'text-ink-muted',
                      )}
                    >
                      {t === 'rot' ? 'Rot' : 'Blau'}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex overflow-hidden rounded-full border border-line-strong">
                {(['chef', 'agent'] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={!eigene}
                    onClick={() => setzeSitz(i, { rolle: r })}
                    className={cn(
                      'min-h-9 px-3 text-xs font-semibold transition-colors disabled:cursor-default',
                      s.rolle === r ? 'bg-amber-400 text-zinc-950' : 'text-ink-muted',
                    )}
                  >
                    {r === 'chef' ? 'Chef' : 'Agent'}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
        {problem && <p className="mt-2 text-xs text-red-400">{problem}</p>}
      </div>
    </div>
  );
}
