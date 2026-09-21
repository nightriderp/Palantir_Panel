import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SpruchProvider, useSpruch } from './SpruchProvider';

function Probe() {
  const { titel } = useSpruch('serverLeer');
  return <p>{titel}</p>;
}

describe('SpruchProvider', () => {
  it('reicht den Text des gewählten Themes durch', () => {
    render(
      <SpruchProvider themeId="schmiedefeuer">
        <Probe />
      </SpruchProvider>,
    );

    expect(screen.getByText('Der Amboss ist noch kalt')).toBeTruthy();
  });

  it('gibt beim Standard den neutralen Text', () => {
    render(
      <SpruchProvider themeId="standard">
        <Probe />
      </SpruchProvider>,
    );

    expect(screen.getByText('Noch keine Server')).toBeTruthy();
  });

  /*
   * Der Vorgabewert des Kontexts ist der Standard. Eine Ansicht kann damit
   * nicht dadurch kaputtgehen, dass sie ohne den Rahmen gerendert wird – was
   * in jedem Komponententest dieses Projekts der Fall ist.
   */
  it('kommt ohne Anbieter aus und zeigt dann den neutralen Text', () => {
    render(<Probe />);

    expect(screen.getByText('Noch keine Server')).toBeTruthy();
  });

  it('fällt bei unbekannter Kennung auf den neutralen Text zurück', () => {
    render(
      <SpruchProvider themeId="gibtesnicht">
        <Probe />
      </SpruchProvider>,
    );

    expect(screen.getByText('Noch keine Server')).toBeTruthy();
  });
});
