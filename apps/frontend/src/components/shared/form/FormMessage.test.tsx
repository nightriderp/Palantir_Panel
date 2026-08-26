import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { FormMessage } from './FormMessage';

describe('FormMessage', () => {
  it('wird ohne Fokuswechsel vorgelesen', () => {
    render(<FormMessage>Benutzername oder Passwort stimmt nicht.</FormMessage>);

    expect(screen.getByRole('alert').textContent).toBe('Benutzername oder Passwort stimmt nicht.');
  });

  it('färbt sich nach der Tonlage', () => {
    const { rerender } = render(<FormMessage>Fehlgeschlagen.</FormMessage>);
    const error = screen.getByRole('alert').className;

    rerender(<FormMessage tone="success">Gespeichert.</FormMessage>);
    const success = screen.getByRole('alert').className;

    expect(error).toContain('text-danger');
    expect(success).toContain('text-success');
  });

  it('bleibt bei Token-Klassen, ohne literale Farbwerte', () => {
    render(<FormMessage tone="warning">Zu viele Versuche.</FormMessage>);

    expect(screen.getByRole('alert').className).not.toMatch(/#[0-9a-f]{3,6}|rgb|\[/i);
  });
});
