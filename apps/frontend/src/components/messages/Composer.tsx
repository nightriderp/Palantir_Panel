'use client';

import { MESSAGE_MAX_LENGTH } from '@palantir/contracts';
import { useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Icon, IconButton, cn } from '@/components/shared';

/**
 * Eingabezeile für eine neue Nachricht (Arbeitspaket F5).
 *
 * Mobile-First (Lastenheft §4): ein Textfeld, das mit dem Inhalt wächst, und ein
 * klar erreichbarer Senden-Knopf. Auf dem Rechner sendet `Enter`, `Umschalt+Enter`
 * fügt eine Zeile ein; auf dem Smartphone bleibt der Senden-Knopf der Weg, damit
 * die Bildschirmtastatur ihren Zeilenumbruch behält.
 *
 * Dieselbe Längengrenze wie im Vertrag ({@link MESSAGE_MAX_LENGTH}) und im
 * Backend – der Zähler zeigt sie an, sobald es eng wird. Leere oder nur aus
 * Leerzeichen bestehende Nachrichten lassen sich nicht senden (wie das Zod-Schema
 * in `@palantir/validation`).
 */

export interface ComposerProps {
  /** Darf hier geschrieben werden? Kommt aus `conversation.permissions.canSendMessage`. */
  canSend: boolean;
  /** Läuft gerade ein Sendevorgang? Sperrt den Knopf, ohne die Eingabe zu leeren. */
  sending: boolean;
  onSend: (content: string) => void;
}

const WARN_THRESHOLD = MESSAGE_MAX_LENGTH - 100;

export function Composer({ canSend, sending, onSend }: ComposerProps) {
  const [draft, setDraft] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  if (!canSend) {
    return (
      <div className="border-t border-line px-4 py-3.5 text-xs text-ink-faint">
        In dieser Unterhaltung kannst du nicht schreiben.
      </div>
    );
  }

  const trimmed = draft.trim();
  const canSubmit = trimmed.length > 0 && trimmed.length <= MESSAGE_MAX_LENGTH && !sending;

  function submit() {
    if (!canSubmit) return;
    onSend(trimmed);
    setDraft('');
    areaRef.current?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submit();
    }
  }

  function insertEmoji() {
    setDraft((current) => `${current}🙂`);
    areaRef.current?.focus();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 border-t border-line px-3 py-3 sm:px-4"
    >
      <IconButton
        type="button"
        icon="smile"
        label="Emoji einfügen"
        variant="ghost"
        size="sm"
        onClick={insertEmoji}
      />

      <div className="flex flex-1 flex-col">
        <textarea
          ref={areaRef}
          value={draft}
          rows={1}
          maxLength={MESSAGE_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nachricht schreiben …"
          aria-label="Nachricht schreiben"
          className="max-h-32 w-full resize-none rounded-xl border border-line-strong bg-fill px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-disabled focus-visible:border-brand"
        />
        {draft.length >= WARN_THRESHOLD ? (
          <span
            className={cn(
              'mt-1 self-end text-2xs',
              draft.length >= MESSAGE_MAX_LENGTH ? 'text-danger' : 'text-ink-faint',
            )}
          >
            {draft.length} / {MESSAGE_MAX_LENGTH}
          </span>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        aria-label="Senden"
        title="Senden"
        className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-xl bg-brand-gradient text-white shadow-brand transition-[filter] hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="send" size={16} />
      </button>
    </form>
  );
}
