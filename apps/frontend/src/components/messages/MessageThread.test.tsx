import { DELETED_ACCOUNT_DISPLAY_NAME, type MessageDto } from '@palantir/contracts';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { conversation, message } from './testFixtures';
import { MessageThread } from './MessageThread';

/**
 * Der Verlauf mit gelöschten Absender-Konten (Fundpunkt 141).
 *
 * Seit dem Löschen eines Kontos dessen Nachrichten stehen bleiben, trägt
 * `MessageDto.senderId` in genau diesen Zeilen `null`. Geprüft wird hier, was
 * daraus im Verlauf werden muss – und vor allem, was **nicht**: zwei
 * verschiedene gelöschte Konten dürfen nicht zu einem Absender verschmelzen,
 * und ein Konto, das es nicht mehr gibt, darf weder verlinkt noch als eigener
 * Beitrag gezeigt werden.
 */

// Gebraucht nicht die Ansicht selbst, wohl aber der Sammel-Export von
// `@/components/shared`, über den sie ihre Bausteine bezieht.
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(''),
  usePathname: () => '/messages',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const SERVER_CHAT = conversation({
  id: 'c1',
  type: 'server_chat',
  title: 'Server-Chat',
  participants: [{ userId: 'u1', displayName: 'Alex' }],
});

/** Eine Nachricht, deren Absender-Konto gelöscht wurde. */
function ohneAbsender(overrides: Partial<MessageDto> = {}): MessageDto {
  return message({
    senderId: null,
    senderDisplayName: DELETED_ACCOUNT_DISPLAY_NAME,
    permissions: { canDelete: false, canReport: true },
    ...overrides,
  });
}

function zeige(messages: MessageDto[], viewerId: string | null) {
  return render(
    <MessageThread
      conversation={SERVER_CHAT}
      thread={{ messages, nextCursor: null, loaded: true }}
      viewerId={viewerId}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      sending={false}
      onSend={vi.fn()}
      loadingOlder={false}
      onLoadOlder={vi.fn()}
      onReport={vi.fn()}
      onDelete={vi.fn()}
      onBack={vi.fn()}
    />,
  );
}

describe('Verlauf mit gelöschten Konten', () => {
  it('fasst zwei verschiedene gelöschte Konten nicht zu einem Absender zusammen', () => {
    /*
     * Der eigentliche Fundpunkt: Zusammengefasst wird über
     * `previous.senderId !== message.senderId`. Ohne den `null`-Zweig wäre
     * `null === null` „derselbe Absender", die zweite Nachricht verlöre ihre
     * Namenszeile und beide Beiträge sähen aus, als kämen sie von einer
     * Person. Zwei Namenszeilen heißt: zwei Absender, so wie es ist.
     */
    zeige(
      [
        ohneAbsender({ id: 'm1', content: 'von Konto A' }),
        ohneAbsender({ id: 'm2', content: 'von Konto B' }),
      ],
      'u1',
    );

    expect(screen.getAllByText(DELETED_ACCOUNT_DISPLAY_NAME)).toHaveLength(2);
  });

  it('fasst aufeinanderfolgende Beiträge eines bestehenden Kontos weiterhin zusammen', () => {
    // Gegenprobe: Der `null`-Zweig darf die Zusammenfassung nicht generell
    // abschalten – bei einer echten Kennung bleibt es bei einer Namenszeile.
    zeige(
      [
        message({ id: 'm1', senderId: 'u2', senderDisplayName: 'Femi', content: 'eins' }),
        message({ id: 'm2', senderId: 'u2', senderDisplayName: 'Femi', content: 'zwei' }),
      ],
      'u1',
    );

    expect(screen.getAllByText('Femi')).toHaveLength(1);
  });

  it('verlinkt ein gelöschtes Konto nicht', () => {
    /*
     * Ein Link ins Leere ist schlechter als kein Link: Es gibt kein Profil
     * mehr, auf das er zeigen könnte. Der Name steht deshalb als reiner Text
     * da – die Prüfung hält das fest, damit eine später ergänzte
     * Profil-Verlinkung diesen Fall nicht stillschweigend mitnimmt.
     */
    zeige([ohneAbsender({ id: 'm1' })], 'u1');

    const name = screen.getByText(DELETED_ACCOUNT_DISPLAY_NAME);

    expect(name.closest('a')).toBeNull();
    expect(name.closest('button')).toBeNull();
  });

  it('hält die Nachricht eines gelöschten Kontos auch ohne angemeldetes Konto für fremd', () => {
    /*
     * `viewerId` ist `null`, solange die Sitzung noch nicht geladen ist. Träfen
     * sich hier zwei `null`, gälte die Nachricht als eigener Beitrag – sie
     * stünde rechts in der Markenfarbe und ohne Namenszeile. Dass der Name
     * erscheint, ist genau die sichtbare Gegenprobe.
     */
    zeige([ohneAbsender({ id: 'm1' })], null);

    expect(screen.getByText(DELETED_ACCOUNT_DISPLAY_NAME)).toBeTruthy();
  });
});
