'use client';

import { type GameServerDto, type ServerConsoleLine } from '@palantir/contracts';
import { consoleCommandSchema } from '@palantir/validation';
import { useEffect, useRef, useState } from 'react';
import { Button, Panel, cn, formatTime, useToast } from '@/components/shared';
import { type LiveConnectionState } from '@/lib/live/LiveChannelProvider';

/**
 * Reiter „Konsole" der Detailansicht (Lastenheft §3.3).
 *
 * Live-Ausgabe und Befehlseingabe – beides über den Live-Kanal
 * (Pflichtenheft §5.3), nicht über wiederholtes Nachladen. Die Eingabe
 * erscheint nur, wenn `permissions.canUseConsole` gesetzt ist; die verbindliche
 * Prüfung macht trotzdem das Backend.
 */

/** Häufige Befehle als Schnellzugriff, wie im Mockup. */
const QUICK_COMMANDS = ['list', 'save-all', 'stop'] as const;

const SOURCE_CLASSES: Record<ServerConsoleLine['source'], string> = {
  stdout: 'text-ink-muted',
  stderr: 'text-danger',
  input: 'text-brand',
  system: 'text-ink-faint italic',
};

export interface ConsoleTabProps {
  server: GameServerDto;
  lines: readonly ServerConsoleLine[];
  connection: LiveConnectionState;
  onSend: (command: string) => boolean;
  onClear: () => void;
}

export function ConsoleTab({ server, lines, connection, onSend, onClear }: ConsoleTabProps) {
  const toast = useToast();
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const outputRef = useRef<HTMLDivElement>(null);

  // Ans Ende springen, solange der Nutzer nicht selbst nach oben gescrollt hat.
  useEffect(() => {
    if (!autoScroll) return;
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [lines, autoScroll]);

  function send(command: string) {
    const parsed = consoleCommandSchema.safeParse(command);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Dieser Befehl ist nicht erlaubt.');
      return;
    }

    if (!onSend(parsed.data)) {
      toast.error('Keine Live-Verbindung – der Befehl wurde nicht gesendet.');
      return;
    }
    setError(null);
    setDraft('');
  }

  const running = server.status === 'running';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">Live-Konsole</h3>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-ink-faint">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
            />
            Automatisch mitscrollen
          </label>
          <Button size="sm" onClick={onClear}>
            Leeren
          </Button>
        </div>
      </div>

      {connection !== 'open' ? (
        <p className="rounded border border-warning-line bg-warning-soft px-2.5 py-2 text-sm text-warning">
          {connection === 'connecting'
            ? 'Die Live-Verbindung wird aufgebaut – neue Zeilen erscheinen gleich.'
            : 'Die Live-Verbindung ist unterbrochen. Es wird automatisch erneut versucht.'}
        </p>
      ) : null}

      <Panel variant="plain" padding="none">
        <div
          ref={outputRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            setAutoScroll(atBottom);
          }}
          className="h-[45vh] min-h-[220px] overflow-y-auto p-3 font-mono text-xs"
          role="log"
          aria-label="Konsolenausgabe"
          aria-live="polite"
        >
          {lines.length === 0 ? (
            <p className="py-8 text-center text-ink-faint">
              {running
                ? 'Noch keine Ausgabe erfasst.'
                : 'Der Server läuft nicht – es kommt gerade keine Ausgabe.'}
            </p>
          ) : (
            lines.map((line) => (
              <div
                key={line.id}
                className={cn('whitespace-pre-wrap break-words', SOURCE_CLASSES[line.source])}
              >
                <span className="mr-2 text-ink-disabled">{formatTime(line.timestamp)}</span>
                {line.source === 'input' ? '> ' : ''}
                {line.text}
              </div>
            ))
          )}
        </div>
      </Panel>

      {server.permissions.canUseConsole ? (
        <>
          <div className="flex flex-wrap gap-2">
            {QUICK_COMMANDS.map((command) => (
              <Button key={command} size="sm" disabled={!running} onClick={() => send(command)}>
                {command}
              </Button>
            ))}
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              send(draft);
            }}
            className="flex items-center gap-2 rounded-md border border-line-strong bg-fill px-3 py-2"
          >
            <span aria-hidden className="font-mono text-sm text-ink-faint">
              &gt;
            </span>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={running ? 'Befehl eingeben …' : 'Der Server läuft nicht.'}
              aria-label="Konsolenbefehl"
              disabled={!running}
              autoComplete="off"
              className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none"
            />
            <Button type="submit" size="sm" variant="primary" disabled={!running}>
              Senden
            </Button>
          </form>

          {error ? (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          ) : null}
        </>
      ) : (
        <p className="text-sm text-ink-faint">
          Du darfst die Ausgabe lesen, aber keine Befehle senden.
        </p>
      )}
    </div>
  );
}
