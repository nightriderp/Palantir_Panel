import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rundgang } from './Rundgang';
import { RundgangProvider } from './RundgangProvider';
import { RundgangSection } from './RundgangSection';
import { ABBRUCH_KLICKS, ABBRUCH_STUFEN, abbruchStufe } from './rundgangSchritte';
import { RUNDGANG_STORAGE_KEY } from './rundgangStand';

/**
 * Der Rundgang über der laufenden Anwendung.
 *
 * Zwei Dinge sind hier wichtiger als die Gestaltung: Er zeigt nur auf Elemente,
 * die es wirklich gibt (sonst leuchtet der Scheinwerfer ins Leere), und man
 * kommt jederzeit heraus. Beides steht unten als Test.
 *
 * jsdom misst nichts – jedes `getBoundingClientRect` wäre sonst null breit und
 * damit „unsichtbar". Deshalb der Ersatz unten: Was ein `data-rundgang` trägt,
 * bekommt eine Größe, alles andere bleibt bei null.
 */

function rechteck(top: number, left: number, breite: number, hoehe: number): DOMRect {
  return {
    top,
    left,
    width: breite,
    height: hoehe,
    right: left + breite,
    bottom: top + hoehe,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

beforeEach(() => {
  window.localStorage.clear();

  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ): DOMRect {
    return this.hasAttribute('data-rundgang')
      ? rechteck(120, 40, 200, 36)
      : rechteck(0, 0, 320, 210);
  });

  // jsdom kennt es nicht; der Rundgang holt damit sein Ziel ins Bild.
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Die Anwendung darunter – zwei Ziele, mehr braucht der Rundgang nicht. */
function panel(kontoGeladen = true) {
  render(
    <RundgangProvider kontoGeladen={kontoGeladen}>
      <button type="button" data-rundgang="nav-servers">
        Übersicht
      </button>
      <button type="button" data-rundgang="konto">
        Konto
      </button>
      <Rundgang />
    </RundgangProvider>,
  );
}

function zettel(): HTMLElement {
  return screen.getByRole('dialog');
}

describe('Rundgang – erster Besuch', () => {
  it('geht von selbst auf, sobald das Konto da ist', () => {
    panel();

    expect(zettel().textContent).toContain('Kurz stehen bleiben.');
  });

  it('wartet, solange das Konto noch lädt', () => {
    panel(false);

    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('bleibt weg, wenn dieser Browser ihn schon hatte', () => {
    window.localStorage.setItem(RUNDGANG_STORAGE_KEY, 'erledigt');
    panel();

    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('Rundgang – durchlaufen', () => {
  it('überspringt Stationen, deren Element es hier nicht gibt', () => {
    panel();

    // Nach der Begrüßung kämen Menü-Knopf, Übersicht, Server erstellen … –
    // vorhanden ist nur die Übersicht.
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    expect(zettel().textContent).toContain('Deine Server');
  });

  it('springt vom letzten vorhandenen Ziel zum Schluss', () => {
    panel();

    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    expect(zettel().textContent).toContain('Dein Konto');

    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    expect(zettel().textContent).toContain('Das war er.');
    expect(screen.getByRole('button', { name: 'Verstanden' })).toBeDefined();

    // Auf der Schlussstation gibt es nichts mehr abzubrechen – und erst recht
    // keine Rückfrage, ob man wirklich schon gehen will.
    expect(screen.queryByRole('button', { name: 'Nicht jetzt' })).toBeNull();
  });

  it('kommt mit „Zurück" wieder an den Anfang', () => {
    panel();

    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Zurück' }));

    expect(zettel().textContent).toContain('Kurz stehen bleiben.');
  });

  it('merkt sich das Ende und geht beim nächsten Mal nicht wieder auf', () => {
    panel();

    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Verstanden' }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(RUNDGANG_STORAGE_KEY)).toBe('erledigt');
  });
});

describe('Rundgang – wieder herauskommen', () => {
  it('lässt erst nach fünf Klicks los und wird dabei jedes Mal frecher', () => {
    panel();

    // Ein Klick je Stufe; die letzte beendet. Der Test geht die Leiter aus
    // ABBRUCH_STUFEN ab, statt die Beschriftungen abzuschreiben – wer den Ton
    // ändert, muss ihn nicht an zwei Stellen ändern.
    for (let klicks = 0; klicks < ABBRUCH_KLICKS - 1; klicks += 1) {
      const stufe = abbruchStufe(klicks);

      fireEvent.click(screen.getByRole('button', { name: stufe.knopf }));

      const naechste = abbruchStufe(klicks + 1);

      // Rückfrage und Beschriftung sind eine Stufe weitergerückt, der
      // Rundgang steht aber noch.
      expect(zettel().textContent).toContain(naechste.frage);
      expect(screen.getByRole('button', { name: naechste.knopf })).toBeDefined();
      expect(screen.queryByRole('dialog')).not.toBeNull();
    }

    const letzte = ABBRUCH_STUFEN[ABBRUCH_STUFEN.length - 1];

    fireEvent.click(screen.getByRole('button', { name: letzte?.knopf }));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(RUNDGANG_STORAGE_KEY)).toBe('erledigt');
  });

  it('setzt die Leiter zurück, wenn man zwischendurch weiterliest', () => {
    panel();

    fireEvent.click(screen.getByRole('button', { name: 'Nicht jetzt' }));
    fireEvent.click(screen.getByRole('button', { name: abbruchStufe(1).knopf }));
    fireEvent.click(screen.getByRole('button', { name: 'Weiter' }));

    // Sonst sammelte jemand über elf Stationen hinweg heimlich Klicks und
    // stünde beim nächsten Versuch ohne Rückfrage draußen.
    expect(screen.getByRole('button', { name: 'Nicht jetzt' })).toBeDefined();
    expect(zettel().textContent).not.toContain(abbruchStufe(1).frage);
  });

  it('beendet mit Escape sofort und ohne Rückfrage', () => {
    panel();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(window.localStorage.getItem(RUNDGANG_STORAGE_KEY)).toBe('erledigt');
  });
});

describe('Rundgang – Schalter in den Einstellungen', () => {
  function einstellungen() {
    render(
      <RundgangProvider kontoGeladen>
        <button type="button" data-rundgang="konto">
          Konto
        </button>
        <RundgangSection />
        <Rundgang />
      </RundgangProvider>,
    );
  }

  it('startet ihn auf Knopfdruck, auch wenn er längst erledigt war', () => {
    window.localStorage.setItem(RUNDGANG_STORAGE_KEY, 'erledigt');
    einstellungen();

    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Rundgang jetzt starten' }));

    expect(zettel().textContent).toContain('Kurz stehen bleiben.');
  });

  it('schaltet ihn für den nächsten Besuch wieder ein, ohne ihn sofort zu starten', () => {
    window.localStorage.setItem(RUNDGANG_STORAGE_KEY, 'erledigt');
    einstellungen();

    fireEvent.click(screen.getByRole('switch', { name: 'Beim nächsten Besuch wieder zeigen' }));

    expect(window.localStorage.getItem(RUNDGANG_STORAGE_KEY)).toBe('offen');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
