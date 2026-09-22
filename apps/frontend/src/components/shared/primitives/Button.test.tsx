import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Button, ButtonLink, IconButton, buttonClasses } from './Button';

/**
 * Rückmeldung einer laufenden Aktion.
 *
 * Bis zu diesem Paket gab es im Frontend **keine einzige** Ladeanzeige: Eine
 * laufende Aktion machte ihre Schaltfläche nur blass und unklickbar, und das
 * liest sich als „Knopf ist kaputt", nicht als „läuft". Die Fälle hier halten
 * die drei Zusagen fest, an denen das hängt.
 */
describe('Button – laufende Aktion', () => {
  it('zeigt einen Spinner und sperrt sich selbst', () => {
    render(<Button loading>Speichern</Button>);

    const knopf = screen.getByRole('button', { name: /Speichern/ });

    expect((knopf as HTMLButtonElement).disabled).toBe(true);
    expect(knopf.getAttribute('aria-busy')).toBe('true');
    expect(knopf.querySelector('.animate-spin')).not.toBeNull();
  });

  it('ersetzt das linke Symbol, statt neben es zu treten', () => {
    const { rerender } = render(<Button iconLeft="plus">Neuer Server</Button>);

    const ruhend = screen.getByRole('button').querySelectorAll('svg').length;

    rerender(
      <Button iconLeft="plus" loading>
        Neuer Server
      </Button>,
    );

    // Ein Symbol weniger: Der Spinner ist kein `svg`, sondern ein Rand. Träte
    // er daneben, würde die Schaltfläche beim Start der Aktion breiter und die
    // ganze Zeile nachrutschen.
    expect(screen.getByRole('button').querySelectorAll('svg').length).toBe(ruhend - 1);
  });

  it('nimmt keinen Klick mehr an, solange die Aktion läuft', async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Starten
      </Button>,
    );

    screen.getByRole('button').click();

    expect(onClick).not.toHaveBeenCalled();
  });

  it('bleibt gesperrt, wenn `disabled` ohne `loading` gesetzt ist – ohne Spinner', () => {
    render(<Button disabled>Starten</Button>);

    const knopf = screen.getByRole('button');

    expect((knopf as HTMLButtonElement).disabled).toBe(true);
    expect(knopf.getAttribute('aria-busy')).toBeNull();
    expect(knopf.querySelector('.animate-spin')).toBeNull();
  });

  /**
   * ⚠️ Der Fall, der beim Bauen zuerst danebenging.
   *
   * `loading` setzt `disabled` mit – und damit griff `disabled:opacity-50`
   * auch auf die laufende Schaltfläche. Sie sah aus wie eine tote, also genau
   * so wie vorher. Ein nachgeschobenes `disabled:opacity-100` half nicht:
   * Tailwind gibt `100` **vor** `50` aus, die Überschreibung lief ins Leere.
   * Seither entscheidet `buttonClasses` zwischen beiden Zuständen, statt sie
   * zu stapeln.
   */
  it('verblasst nicht, solange die Aktion läuft – nur Gesperrtes verblasst', () => {
    const { rerender } = render(<Button loading>Speichern</Button>);

    const laufend = screen.getByRole('button').className;

    expect(laufend).toContain('cursor-wait');
    expect(laufend).not.toContain('opacity-50');

    rerender(<Button disabled>Speichern</Button>);

    const gesperrt = screen.getByRole('button').className;

    expect(gesperrt).toContain('disabled:opacity-50');
    expect(gesperrt).not.toContain('cursor-wait');
  });
});

describe('IconButton – laufende Aktion', () => {
  it('tauscht sein Symbol gegen den Spinner, statt beides zu zeigen', () => {
    render(<IconButton icon="restart" label="Neustart" loading />);

    const knopf = screen.getByRole('button', { name: 'Neustart' });

    expect(knopf.querySelector('.animate-spin')).not.toBeNull();
    expect(knopf.querySelectorAll('svg')).toHaveLength(0);
  });
});

/**
 * Reine Navigation gehört an einen Link, nicht an `router.push`.
 *
 * Ein `<Link>` holt sein Ziel vor, ein Klick-Handler nicht – und nur ein Link
 * lässt sich mit der mittleren Maustaste in einem neuen Tab öffnen.
 */
describe('ButtonLink', () => {
  it('ist ein Link mit Ziel und sieht aus wie eine Schaltfläche', () => {
    render(
      <ButtonLink href="/servers/neu" variant="primary" iconLeft="plus">
        Neuer Server
      </ButtonLink>,
    );

    const link = screen.getByRole('link', { name: /Neuer Server/ });

    expect(link.getAttribute('href')).toBe('/servers/neu');
    expect(link.className).toContain('bg-brand-gradient');
    expect(screen.queryByRole('button')).toBeNull();
  });
});

/**
 * Der Verlauf der Primäraktion darf an den Rändern nicht umschlagen.
 *
 * Gemessen am gerenderten Knopf lag links eine 1 px türkise Linie
 * (`rgb(38,205,239)`, die Endfarbe) direkt neben dem violetten Verlaufsanfang
 * (`rgb(120,98,254)`), rechts dasselbe andersherum. Ursache war die
 * Vorgabekombination aus `background-origin: padding-box` und
 * `background-clip: border-box`: Für die Spur des durchsichtigen Rahmens
 * bleibt kein Verlauf übrig, und ein Hintergrundbild kachelt dort vorgabegemäß
 * weiter – also mit der gegenüberliegenden Kante.
 *
 * Der Test hängt an der Klasse und nicht an Pixeln, weil jsdom nichts malt.
 * Er hält damit genau das fest, was die Korrektur ausmacht: Wo ein Verlauf auf
 * einen Rahmen trifft, muss auch der Ursprung die Border-Box sein.
 */
describe('Verlauf und Rahmen der Primäraktion', () => {
  it('rechnet den Verlauf über die Border-Box, nicht über die Padding-Box', () => {
    const klassen = buttonClasses('primary');

    expect(klassen).toContain('bg-brand-gradient');
    expect(klassen).toContain('border');
    expect(klassen).toContain('bg-origin-border');
  });

  it('gilt auch für den Link, der wie eine Primäraktion aussieht', () => {
    render(
      <ButtonLink href="/servers/neu" variant="primary">
        Neuer Server
      </ButtonLink>,
    );

    expect(screen.getByRole('link', { name: /Neuer Server/ }).className).toContain(
      'bg-origin-border',
    );
  });

  it('hängt den Ursprung nicht an Varianten ohne Verlauf', () => {
    // Eine einfarbige Fläche kachelt nicht sichtbar; die Klasse wäre dort nur
    // Rauschen im Markup.
    for (const variante of ['secondary', 'success', 'danger', 'ghost'] as const) {
      expect(buttonClasses(variante)).not.toContain('bg-origin-border');
    }
  });
});
