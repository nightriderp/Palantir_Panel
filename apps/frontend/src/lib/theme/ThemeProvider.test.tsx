import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThemeProvider, useSpruch } from './ThemeProvider';

function Probe() {
  const { titel } = useSpruch('serverLeer');
  return <p>{titel}</p>;
}

describe('ThemeProvider', () => {
  it('reicht den Text des gewählten Themes durch', () => {
    render(
      <ThemeProvider themeId="schmiedefeuer">
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByText('Der Amboss ist noch kalt')).toBeTruthy();
  });

  it('gibt beim Standard den neutralen Text', () => {
    render(
      <ThemeProvider themeId="standard">
        <Probe />
      </ThemeProvider>,
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
      <ThemeProvider themeId="gibtesnicht">
        <Probe />
      </ThemeProvider>,
    );

    expect(screen.getByText('Noch keine Server')).toBeTruthy();
  });
});
