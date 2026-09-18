'use client';

import { type GameServerDto, type ServerConsoleLine } from '@palantir/contracts';
import { consoleCommandSchema } from '@palantir/validation';
import { memo, useEffect, useRef, useState } from 'react';
import { Button, cn, formatTime, useToast } from '@/components/shared';
import { type LiveConnectionState } from '@/lib/live/LiveChannelProvider';

/**
 * Reiter „Konsole" der Detailansicht (Lastenheft §3.3).
 *
 * Live-Ausgabe und Befehlseingabe – beides über den Live-Kanal
 * (Pflichtenheft §5.3), nicht über wiederholtes Nachladen. Die Eingabe
 * erscheint nur, wenn `permissions.canUseConsole` gesetzt ist; die verbindliche
 * Prüfung macht trotzdem das Backend.
 */

const SOURCE_CLASSES: Record<ServerConsoleLine['source'], string> = {
  stdout: 'text-ink-muted',
  stderr: 'text-danger',
  input: 'text-brand',
  system: 'text-ink-faint italic',
};

/**
 * Eine Zeile der Konsole – als eigene, gemerkte Komponente (Review 2026-09-16,
 * Befund 12.9). Der Puffer hält bis zu 500 Zeilen, und jede neue Zeile ließ
 * vorher alle 500 neu rendern. Eine bestehende Zeile ändert sich nie; `memo`
 * mit der Zeile als einziger Eigenschaft rendert sie genau einmal.
 */
const ConsoleLineRow = memo(function ConsoleLineRow({ line }: { line: ServerConsoleLine }) {
  return (
    <div className="flex gap-2.5">
      <span className="shrink-0 select-none text-ink-disabled">{formatTime(line.timestamp)}</span>
      <span className={cn('whitespace-pre-wrap break-words', SOURCE_CLASSES[line.source])}>
        {line.source === 'input' ? <span className="select-none font-bold">&gt; </span> : null}
        {line.text}
      </span>
    </div>
  );
});

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
  /*
   * Nimmt dieses Spiel überhaupt Befehle entgegen? Valheim liest weder seine
   * Standardeingabe noch spricht es RCON (`supportsConsole` im DTO).
   *
   * Die Ausgabe bleibt trotzdem stehen – sie ist bei so einem Server die
   * einzige Stelle, an der man beim Hochlaufen zusehen kann. Gesperrt wird nur
   * die Eingabe. Ein Feld, das Zeilen annimmt, die nirgends ankommen, wäre
   * schlimmer als ein graues.
   */
  const befehleMoeglich = server.supportsConsole !== false;
  const quickCommands = befehleMoeglich ? (server.consoleQuickCommands ?? []) : [];
  // Während des Hochlaufs ist die Konsole die interessanteste Stelle der
  // Seite – „läuft nicht" wäre dort schlicht falsch (Fundpunkt 184).
  const starting = server.status === 'starting';

  /*
   * Zustand der Konsole in der Titelzeile (Vorbild hafenmeister):
   * „LIVE" nur, wenn der Kanal offen ist **und** der Server läuft – ein grünes
   * LIVE über einem gestoppten Server behauptete sonst einen Datenstrom, den
   * es nicht gibt.
   */
  const live = connection === 'open' && running;
  const zustand = live
    ? { label: 'LIVE', tone: 'text-success', dot: 'bg-success' }
    : connection === 'connecting'
      ? { label: 'verbinde …', tone: 'text-warning', dot: 'bg-warning' }
      : { label: 'idle', tone: 'text-ink-faint', dot: 'bg-ink-faint' };

  return (
    <div className="flex flex-col gap-3">
      {connection !== 'open' ? (
        <p className="rounded border border-warning-line bg-warning-soft px-2.5 py-2 text-sm text-warning">
          {connection === 'connecting'
            ? 'Die Live-Verbindung wird aufgebaut – neue Zeilen erscheinen gleich.'
            : 'Die Live-Verbindung ist unterbrochen. Es wird automatisch erneut versucht.'}
        </p>
      ) : null}

      {/*
        Die Konsole als Terminalfenster statt als Kasten unter einer
        Überschrift: Ampelpunkte, Titelzeile „console — <Server>", rechts der
        Zustand des Kanals. Vorher standen Überschrift, Mitscroll-Kästchen und
        „Leeren" über einer Fläche, die genauso aussah wie jede andere Karte
        der Seite – die Konsole war die einzige Stelle mit Live-Ausgabe, sah
        aber nicht danach aus.
      */}
      <div className="flex flex-col overflow-hidden rounded-xl border border-line bg-surface-console">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-fill px-4">
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-terminal-close" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-terminal-minimize" />
          <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-terminal-zoom" />
          <span className="ml-2 truncate font-mono text-xs font-semibold text-ink-soft">
            console — {server.name}
          </span>

          <span className="ml-auto flex items-center gap-3">
            <label className="flex items-center gap-1.5 text-2xs text-ink-faint">
              <input
                type="checkbox"
                checked={autoScroll}
                onChange={(event) => setAutoScroll(event.target.checked)}
              />
              Mitscrollen
            </label>
            <Button size="sm" variant="ghost" onClick={onClear}>
              Leeren
            </Button>
            <span className={cn('flex items-center gap-1.5 text-2xs font-medium', zustand.tone)}>
              <span aria-hidden className={cn('h-1.5 w-1.5 rounded-full', zustand.dot)} />
              {zustand.label}
            </span>
          </span>
        </div>

        <div
          ref={outputRef}
          onScroll={(event) => {
            const element = event.currentTarget;
            const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 24;
            setAutoScroll(atBottom);
          }}
          className="h-[45vh] min-h-[220px] overflow-y-auto px-4 py-3.5 font-mono text-xs leading-[1.7]"
          role="log"
          aria-label="Konsolenausgabe"
          aria-live="polite"
        >
          {lines.length === 0 ? (
            <p className="py-8 text-center text-ink-faint">
              {running
                ? 'Noch keine Ausgabe erfasst.'
                : starting
                  ? 'Der Server startet – die Ausgabe erscheint gleich.'
                  : 'Der Server läuft nicht – es kommt gerade keine Ausgabe.'}
            </p>
          ) : (
            lines.map((line) => <ConsoleLineRow key={line.id} line={line} />)
          )}
        </div>

        {/*
          Schnellbefehle und Eingabezeile gehören in das Fenster, nicht
          darunter: Sie bedienen genau diese Ausgabe. Ausserhalb standen sie
          wie zwei weitere Bausteine der Seite.
        */}
        {server.permissions.canUseConsole ? (
          <>
            {/*
             * Schnellbefehle kommen aus der Spiele-Definition, nicht fest von
             * hier: Was bei Minecraft `list` heißt, heißt beim Prüfstand `help`.
             * Ohne Einträge gibt es nur das Feld.
             */}
            {quickCommands.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-line px-4 py-2.5">
                {quickCommands.map((quick) => (
                  <Button
                    key={quick.command}
                    size="sm"
                    disabled={!running}
                    title={quick.command}
                    onClick={() => send(quick.command)}
                  >
                    {quick.label}
                  </Button>
                ))}
              </div>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault();
                send(draft);
              }}
              className="flex items-center gap-2 border-t border-line px-4 py-2.5"
            >
              <span aria-hidden className="font-mono text-sm font-bold text-brand">
                &gt;
              </span>
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={
                  befehleMoeglich
                    ? running
                      ? 'Befehl eingeben …'
                      : 'Der Server läuft nicht.'
                    : `${server.gameTypeName} nimmt keine Befehle entgegen.`
                }
                aria-label="Konsolenbefehl"
                disabled={!running || !befehleMoeglich}
                autoComplete="off"
                className="min-w-0 flex-1 bg-transparent font-mono text-sm text-ink outline-none disabled:text-ink-disabled"
              />
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={!running || !befehleMoeglich}
              >
                Senden
              </Button>
            </form>
          </>
        ) : (
          <p className="border-t border-line px-4 py-2.5 text-sm text-ink-faint">
            Du darfst die Ausgabe lesen, aber keine Befehle senden.
          </p>
        )}
      </div>

      {server.permissions.canUseConsole && !befehleMoeglich ? (
        <p className="text-xs text-ink-faint">
          Dieses Spiel kennt keine Serverkonsole – weder über die Standardeingabe noch über RCON.
          Was hier steht, ist die Ausgabe des Servers; Befehle nimmt er keine entgegen.
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
