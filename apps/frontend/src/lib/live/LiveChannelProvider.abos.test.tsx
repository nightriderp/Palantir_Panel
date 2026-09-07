import { type LiveServerEventFrame, type LiveTopic } from '@palantir/contracts';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type LiveChannelApi, LiveChannelProvider, useLiveChannel } from './LiveChannelProvider';

/**
 * Abonnement-Verwaltung des Live-Kanals (Audit W2-29, `test-gaps-10`).
 *
 * Eigene Datei neben `LiveChannelProvider.test.tsx`: dort steht seit W2-5 der
 * Ist-Stand nach dem Wiederanlauf mit einer eigenen WebSocket-Attrappe; beide
 * Sichten in eine Datei zu zwingen hieße, eine der beiden Attrappen aufzugeben.
 *
 * Bisher war nur geprüft, was **einzelne Haken** aus den Frames machen
 * (`useServerLive`, `useDtoRevision`) – der Provider darunter nicht. Er ist
 * aber die Stelle, an der die Zusagen aus Pflichtenheft §5.3 hängen: genau eine
 * Verbindung für den ganzen eingeloggten Bereich, ein Abo je Ressource egal wie
 * viele Ansichten es brauchen, Wiederanlauf mit erneutem Anmelden aller Abos,
 * und fremde Nachrichten werden stillschweigend verworfen statt die Oberfläche
 * mitzureißen.
 *
 * `WebSocket` steht als Attrappe da: Der Test steuert Öffnen, Nachricht und
 * Abbruch von Hand und liest mit, was hinausging.
 */

interface Nachricht {
  readonly data: unknown;
}

/** Attrappe des Browser-`WebSocket`. */
class FakeSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  /** Alle im Test erzeugten Verbindungen, in der Reihenfolge ihrer Entstehung. */
  static readonly instanzen: FakeSocket[] = [];

  readyState = FakeSocket.CONNECTING;
  readonly gesendet: string[] = [];
  vonUnsGeschlossen = false;

  onopen: (() => void) | null = null;
  onmessage: ((nachricht: Nachricht) => void) | null = null;
  onclose: ((ereignis: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    FakeSocket.instanzen.push(this);
  }

  send(daten: string): void {
    this.gesendet.push(daten);
  }

  close(code = 1000): void {
    this.vonUnsGeschlossen = true;
    this.readyState = FakeSocket.CLOSED;
    this.onclose?.({ code });
  }

  // -- Steuerung durch den Test ---------------------------------------------

  oeffne(): void {
    this.readyState = FakeSocket.OPEN;
    act(() => {
      this.onopen?.();
    });
  }

  empfange(rohdaten: unknown): void {
    act(() => {
      this.onmessage?.({ data: rohdaten });
    });
  }

  /**
   * Verbindungsabbruch von außen – anders als `close()` kein eigener Wunsch.
   *
   * Der Code geht an den Provider: Seit W2-5 entscheidet er daran, ob ein
   * Wiederanlauf überhaupt sinnvoll ist (4401/4403 nicht). 1006 ist der
   * übliche Code eines abgerissenen Sockets.
   */
  brichAb(code = 1006): void {
    this.readyState = FakeSocket.CLOSED;
    act(() => {
      this.onclose?.({ code });
    });
  }

  /** Die zuletzt gesendeten Frames als geparste Objekte. */
  frames(): { kind: string; topic: LiveTopic }[] {
    return this.gesendet.map(
      (eintrag) => JSON.parse(eintrag) as { kind: string; topic: LiveTopic },
    );
  }
}

const THEMA: LiveTopic = { resource: 'server', id: 'srv-1' };
const ANDERES_THEMA: LiveTopic = { resource: 'server', id: 'srv-2' };

function ereignis(serverId: string): LiveServerEventFrame {
  return {
    kind: 'event',
    event: 'server.statusChanged',
    topic: { resource: 'server', id: serverId },
    sentAt: '2026-09-06T10:00:00.000Z',
    data: { serverId, status: 'running', statusMessage: null },
  };
}

/** Greift den Kanal aus dem Kontext ab, damit der Test ihn bedienen kann. */
let kanal: LiveChannelApi | null = null;

function Zapfhahn() {
  kanal = useLiveChannel();

  return <span data-testid="verbindung">{kanal.connection}</span>;
}

function zeichne() {
  return render(
    <LiveChannelProvider>
      <Zapfhahn />
    </LiveChannelProvider>,
  );
}

function letzteVerbindung(): FakeSocket {
  const socket = FakeSocket.instanzen.at(-1);
  if (socket === undefined) throw new Error('Es wurde keine Verbindung aufgebaut.');

  return socket;
}

function verbindungsZustand(): string {
  return screen.getByTestId('verbindung').textContent ?? '';
}

beforeEach(() => {
  FakeSocket.instanzen.length = 0;
  kanal = null;
  vi.useFakeTimers();
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('LiveChannelProvider – Verbindung', () => {
  it('baut beim Einhängen genau eine Verbindung auf', () => {
    zeichne();

    expect(FakeSocket.instanzen).toHaveLength(1);
    expect(verbindungsZustand()).toBe('connecting');
  });

  it('meldet die offene Verbindung an die Ansichten', () => {
    zeichne();
    letzteVerbindung().oeffne();

    expect(verbindungsZustand()).toBe('open');
  });

  it('schickt nichts, solange die Verbindung nicht offen ist', () => {
    zeichne();

    const angenommen = kanal?.send({ kind: 'subscribe', topic: THEMA });

    expect(angenommen).toBe(false);
    expect(letzteVerbindung().gesendet).toHaveLength(0);
  });

  it('schließt die Verbindung beim Abbau und versucht es nicht erneut', () => {
    const { unmount } = zeichne();
    letzteVerbindung().oeffne();

    const socket = letzteVerbindung();
    unmount();

    expect(socket.vonUnsGeschlossen).toBe(true);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(FakeSocket.instanzen).toHaveLength(1);
  });
});

describe('LiveChannelProvider – Abonnements', () => {
  it('meldet ein Thema beim Backend genau einmal an, egal wie viele Ansichten es brauchen', () => {
    zeichne();
    letzteVerbindung().oeffne();

    act(() => {
      kanal?.subscribe(THEMA, () => undefined);
      kanal?.subscribe(THEMA, () => undefined);
    });

    expect(letzteVerbindung().frames()).toEqual([{ kind: 'subscribe', topic: THEMA }]);
  });

  it('meldet erst ab, wenn die letzte Ansicht geht', () => {
    zeichne();
    letzteVerbindung().oeffne();

    let ersteAbmeldung: (() => void) | undefined;
    let zweiteAbmeldung: (() => void) | undefined;

    act(() => {
      ersteAbmeldung = kanal?.subscribe(THEMA, () => undefined);
      zweiteAbmeldung = kanal?.subscribe(THEMA, () => undefined);
    });

    act(() => {
      ersteAbmeldung?.();
    });

    expect(letzteVerbindung().frames()).toHaveLength(1);

    act(() => {
      zweiteAbmeldung?.();
    });

    expect(letzteVerbindung().frames()).toEqual([
      { kind: 'subscribe', topic: THEMA },
      { kind: 'unsubscribe', topic: THEMA },
    ]);
  });

  it('gibt ein Ereignis nur an die Zuhörer seines Themas', () => {
    zeichne();
    letzteVerbindung().oeffne();

    const fuerEins: string[] = [];
    const fuerZwei: string[] = [];

    act(() => {
      kanal?.subscribe(THEMA, (frame) => fuerEins.push(frame.topic.id));
      kanal?.subscribe(ANDERES_THEMA, (frame) => fuerZwei.push(frame.topic.id));
    });

    letzteVerbindung().empfange(JSON.stringify(ereignis('srv-1')));

    expect(fuerEins).toEqual(['srv-1']);
    expect(fuerZwei).toEqual([]);
  });

  it('erreicht mehrere Zuhörer desselben Themas', () => {
    zeichne();
    letzteVerbindung().oeffne();

    const gesehen: string[] = [];

    act(() => {
      kanal?.subscribe(THEMA, () => gesehen.push('a'));
      kanal?.subscribe(THEMA, () => gesehen.push('b'));
    });

    letzteVerbindung().empfange(JSON.stringify(ereignis('srv-1')));

    expect(gesehen).toEqual(['a', 'b']);
  });

  it('erreicht einen abgemeldeten Zuhörer nicht mehr', () => {
    zeichne();
    letzteVerbindung().oeffne();

    const gesehen: string[] = [];
    let abmelden: (() => void) | undefined;

    act(() => {
      abmelden = kanal?.subscribe(THEMA, () => gesehen.push('a'));
    });

    act(() => {
      abmelden?.();
    });

    letzteVerbindung().empfange(JSON.stringify(ereignis('srv-1')));

    expect(gesehen).toEqual([]);
  });
});

describe('LiveChannelProvider – fremde Nachrichten', () => {
  /**
   * Alles, was kein gültiges Ereignis-Frame ist, wird verworfen. Ein Wurf an
   * dieser Stelle liefe im `onmessage`-Rückruf auf – außerhalb jeder
   * Fehlergrenze von React und damit direkt in die Konsole des Nutzers.
   */
  const fremdeNachrichten: readonly { name: string; rohdaten: unknown }[] = [
    { name: 'kein JSON', rohdaten: 'kein json' },
    { name: 'keine Zeichenkette', rohdaten: { kind: 'event' } },
    { name: 'JSON-Null', rohdaten: 'null' },
    {
      name: 'anderes kind',
      rohdaten: JSON.stringify({ kind: 'ack', event: 'server.statusChanged' }),
    },
    {
      name: 'unbekanntes Ereignis',
      rohdaten: JSON.stringify({
        kind: 'event',
        event: 'server.explodiert',
        topic: { resource: 'server', id: 'srv-1' },
      }),
    },
    {
      name: 'fremde Ressource',
      rohdaten: JSON.stringify({
        kind: 'event',
        event: 'server.statusChanged',
        topic: { resource: 'chat', id: 'srv-1' },
      }),
    },
    {
      name: 'Thema ohne Id',
      rohdaten: JSON.stringify({
        kind: 'event',
        event: 'server.statusChanged',
        topic: { resource: 'server' },
      }),
    },
  ];

  for (const { name, rohdaten } of fremdeNachrichten) {
    it(`verwirft eine Nachricht: ${name}`, () => {
      zeichne();
      letzteVerbindung().oeffne();

      const gesehen: unknown[] = [];

      act(() => {
        kanal?.subscribe(THEMA, (frame) => gesehen.push(frame));
      });

      letzteVerbindung().empfange(rohdaten);

      expect(gesehen).toEqual([]);
      expect(verbindungsZustand()).toBe('open');
    });
  }
});

describe('LiveChannelProvider – Wiederanlauf', () => {
  it('meldet den Abbruch und versucht es nach der Wartezeit erneut', () => {
    zeichne();
    letzteVerbindung().oeffne();
    letzteVerbindung().brichAb();

    expect(verbindungsZustand()).toBe('closed');
    expect(FakeSocket.instanzen).toHaveLength(1);

    act(() => {
      // Obergrenze der Wartezeit inklusive Zufallsanteil (`backoff.ts`).
      vi.advanceTimersByTime(20_000);
    });

    expect(FakeSocket.instanzen).toHaveLength(2);
    expect(verbindungsZustand()).toBe('connecting');
  });

  it('meldet nach dem Wiederanlauf alle offenen Abos erneut an', () => {
    zeichne();
    letzteVerbindung().oeffne();

    act(() => {
      kanal?.subscribe(THEMA, () => undefined);
      kanal?.subscribe(ANDERES_THEMA, () => undefined);
    });

    letzteVerbindung().brichAb();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    const zweite = letzteVerbindung();
    zweite.oeffne();

    // Das Backend kennt die Abos nach einem Neuaufbau nicht mehr – ohne diese
    // Wiederanmeldung bliebe die Ansicht stumm, obwohl die Verbindung steht.
    expect(zweite.frames()).toEqual([
      { kind: 'subscribe', topic: THEMA },
      { kind: 'subscribe', topic: ANDERES_THEMA },
    ]);
  });

  it('liefert nach dem Wiederanlauf wieder Ereignisse aus', () => {
    zeichne();
    letzteVerbindung().oeffne();

    const gesehen: string[] = [];

    act(() => {
      kanal?.subscribe(THEMA, (frame) => gesehen.push(frame.topic.id));
    });

    letzteVerbindung().brichAb();

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    letzteVerbindung().oeffne();
    letzteVerbindung().empfange(JSON.stringify(ereignis('srv-1')));

    expect(gesehen).toEqual(['srv-1']);
    expect(verbindungsZustand()).toBe('open');
  });

  it('schließt die Verbindung bei einem Fehler und läuft darüber wieder an', () => {
    zeichne();
    const erste = letzteVerbindung();
    erste.oeffne();

    act(() => {
      erste.onerror?.();
    });

    // `onerror` schließt selbst; der Wiederanlauf hängt an `onclose`.
    expect(erste.vonUnsGeschlossen).toBe(true);

    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(FakeSocket.instanzen).toHaveLength(2);
  });
});

describe('useLiveChannel ohne Provider', () => {
  it('wirft, statt stillschweigend ohne Live-Daten zu laufen', () => {
    // Eine Ansicht, die unbemerkt keine Live-Daten bekommt, wäre schwerer zu
    // finden als ein klarer Fehler beim Entwickeln.
    expect(() => render(<Zapfhahn />)).toThrowError(/LiveChannelProvider/);
  });
});
