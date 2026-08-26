export interface AuthHeadingProps {
  title: string;
  description: string;
}

/**
 * Titel und Einleitung einer Anmelde-Ansicht.
 *
 * Bewusst kein `PageHeader` aus F2: der ist für Dashboard-Seiten mit
 * Aktionsleiste gedacht und bringt deren Abstände mit. Hier steht nur die
 * Textgruppe über dem Formular.
 */
export function AuthHeading({ title, description }: AuthHeadingProps) {
  return (
    <header className="mb-7">
      <h1 className="text-4xl font-bold">{title}</h1>
      <p className="mt-1.5 text-base text-ink-muted">{description}</p>
    </header>
  );
}
