import { type AccountDto, type GlobalPermissions } from '@palantir/contracts';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/shared';
import { sichtbareSchritte } from './inhalt';
import { QUIZ_FRAGEN, seitenFragen } from './fragenkatalog';
import { FLUCHT_MAX, LESEZEIT_MIN_MS } from './spott';
import { TutorialView } from './TutorialView';

/**
 * Die Einweisung als Ganzes.
 *
 * Geprüft wird nicht der Witz, sondern seine Grenze: Man kommt durch. Jeder
 * Scherz dieser Ansicht – der ausweichende Knopf, die abgelehnte Lesezeit, der
 * Haken, der wieder aufgeht – darf den Nutzer aufhalten, aber nie einsperren.
 */

vi.mock('@/app/(dashboard)/SessionProvider', () => ({
  useSession: () => ({ user: konto(), loading: false, setUser: () => undefined }),
}));

function berechtigungen(): GlobalPermissions {
  return {
    canCreateServer: true,
    canViewAnyServer: true,
    canManageAnyBackup: false,
    canManageUsers: false,
    canManageRoles: false,
    canManageNotifications: false,
    canViewNodes: false,
    canManageNodes: false,
    canManageAddresses: false,
    canViewAuditLog: false,
    canModerateMessages: false,
    canManageGameTypes: false,
  };
}

function konto(): AccountDto {
  return {
    id: 'u-1',
    displayName: 'Kevin',
    username: 'kevin',
    isOwner: false,
    banned: false,
    awaitingApproval: false,
    twoFactorEnabled: false,
    roles: [],
    authMethods: [],
    createdAt: '2026-09-01T10:00:00.000Z',
    permissions: berechtigungen(),
  };
}

function einweisung(): void {
  render(
    <ToastProvider>
      <TutorialView />
    </ToastProvider>,
  );
}

function klick(name: string | RegExp): void {
  fireEvent.click(screen.getByRole('button', { name }));
}

/** Einen Schritt weiter – mit genug Lesezeit, damit die Ansicht ihn durchlässt. */
function schrittWeiter(): void {
  vi.advanceTimersByTime(LESEZEIT_MIN_MS + 1_000);
  klick(/^(Weiter|Zur Prüfung)$/);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Einweisung – Einstieg', () => {
  it('begrüßt mit dem Namen des Kontos', () => {
    einweisung();

    expect(screen.getByRole('heading', { name: 'Willkommen, Kevin.' })).toBeDefined();
  });

  it('zeigt nach dem Start den ersten Schritt samt Zähler', () => {
    einweisung();
    klick('Ich bin bereit');

    expect(screen.getByRole('heading', { name: 'Übersicht' })).toBeDefined();
    expect(screen.getByText(/Schritt 1 von/)).toBeDefined();
  });

  it('erklärt nur Bereiche, die dieses Konto sehen darf', () => {
    einweisung();
    klick('Ich bin bereit');

    const gesamt = sichtbareSchritte(konto()).length;
    expect(screen.getByText(`Schritt 1 von ${gesamt}`)).toBeDefined();
    expect(screen.queryByRole('heading', { name: 'Nodes' })).toBeNull();
  });
});

describe('Einweisung – die Lesezeit-Mahnung', () => {
  it('lehnt den ersten zu schnellen Klick ab', () => {
    einweisung();
    klick('Ich bin bereit');
    klick('Weiter');

    expect(screen.getByRole('heading', { name: 'Übersicht' })).toBeDefined();
  });

  it('lässt den zweiten Versuch durch – niemand sitzt hier fest', () => {
    einweisung();
    klick('Ich bin bereit');
    klick('Weiter');
    klick('Weiter');

    expect(screen.queryByRole('heading', { name: 'Übersicht' })).toBeNull();
    expect(screen.getByText(/Schritt 2 von/)).toBeDefined();
  });

  it('lässt sofort durch, wer sich Zeit gelassen hat', () => {
    einweisung();
    klick('Ich bin bereit');
    schrittWeiter();

    expect(screen.getByText(/Schritt 2 von/)).toBeDefined();
  });
});

describe('Einweisung – der Haken, der wieder aufgeht', () => {
  it('löst sich von selbst und kommentiert das', () => {
    einweisung();
    klick('Ich bin bereit');

    const haken = screen.getByRole('switch', { name: 'Ich habe das wirklich gelesen' });
    fireEvent.click(haken);
    expect(haken.getAttribute('aria-checked')).toBe('true');

    // Der Zeitgeber des Hakens läuft in React – ohne `act` käme sein
    // Ergebnis erst beim nächsten Rendern an.
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(
      screen
        .getByRole('switch', { name: 'Ich habe das wirklich gelesen' })
        .getAttribute('aria-checked'),
    ).toBe('false');
    expect(screen.getByText('Nein. Du hast nicht.')).toBeDefined();
  });
});

describe('Einweisung – Überspringen', () => {
  it('führt nach der Jagd auf den Knopf zur Urkunde mit der Fünf', () => {
    einweisung();

    const knopf = (): HTMLElement =>
      screen.getByRole('button', { name: /Überspringen|Fast!|Knapp daneben|hartnäckig|gewinnst/ });

    for (let i = 0; i < FLUCHT_MAX; i += 1) fireEvent.mouseEnter(knopf());
    fireEvent.click(knopf());

    expect(screen.getByText('Urkunde')).toBeDefined();
    expect(screen.getByText('5')).toBeDefined();
  });
});

/** Die drei versprochenen Fragen der ersten Seite richtig beantworten. */
function ersteSeiteRichtig(): void {
  for (const frage of seitenFragen(1)) {
    klick(frage.antworten[frage.richtig] ?? '');
  }
}

describe('Einweisung – das Quiz, das nicht aufhört', () => {
  function bisZumQuiz(): void {
    einweisung();
    klick('Ich bin bereit');
    for (let i = 0; i < sichtbareSchritte(konto()).length; i += 1) schrittWeiter();
  }

  it('verspricht zuerst genau drei Fragen', () => {
    bisZumQuiz();

    expect(screen.getByText(/Drei Fragen\./)).toBeDefined();
    expect(screen.getByRole('button', { name: 'Auswerten' })).toBeDefined();
    // Von Seiten ist vor der Enthüllung nirgends die Rede.
    expect(screen.queryByText(/Seite 1 von/)).toBeNull();
  });

  it('enthüllt nach dem Auswerten den ganzen Bogen', () => {
    bisZumQuiz();
    ersteSeiteRichtig();
    klick('Auswerten');

    expect(screen.getByText(/Geschafft/)).toBeDefined();
    expect(screen.getByText(/Seite 2 von/)).toBeDefined();
    // Die Zahl steht im Enthüllungstext – „124 Stück, um genau zu sein".
    expect(screen.getByText(`${QUIZ_FRAGEN.length} Stück`)).toBeDefined();
  });

  it('lässt ab der Enthüllung jederzeit aufgeben – und wertet das Erreichte', () => {
    bisZumQuiz();
    ersteSeiteRichtig();
    klick('Auswerten');

    klick('Ich gebe auf');

    expect(screen.getByText('Urkunde')).toBeDefined();
    expect(screen.getByText('Kevin')).toBeDefined();
    expect(screen.getByText(/3 von 3 beantworteten Fragen richtig/)).toBeDefined();
    expect(screen.getByText(/Drei Fragen, wie angekündigt/)).toBeDefined();
  });

  it('fragt nach sechs Fragen nach, ob das ernst gemeint ist', () => {
    bisZumQuiz();
    ersteSeiteRichtig();
    klick('Auswerten');

    // Seite 2 und 3 – nach der sechsten Antwort kommt die Rückfrage.
    for (const frage of seitenFragen(2)) klick(frage.antworten[frage.richtig] ?? '');
    klick('Nächste Seite');
    for (const frage of seitenFragen(3)) klick(frage.antworten[frage.richtig] ?? '');

    expect(screen.getByRole('dialog')).toBeDefined();
    expect(screen.getByText(/Kurze Zwischenfrage/)).toBeDefined();
  });

  it('beendet das Quiz, wenn man die Rückfrage mit Nein beantwortet', () => {
    bisZumQuiz();
    ersteSeiteRichtig();
    klick('Auswerten');
    for (const frage of seitenFragen(2)) klick(frage.antworten[frage.richtig] ?? '');
    klick('Nächste Seite');
    for (const frage of seitenFragen(3)) klick(frage.antworten[frage.richtig] ?? '');

    klick('Ich höre auf');

    expect(screen.getByText('Urkunde')).toBeDefined();
    expect(screen.getByText(/Sechs Fragen/)).toBeDefined();
  });
});
