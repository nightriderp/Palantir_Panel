import { type ReactNode } from 'react';

import { AuthBrandColumn } from './_components/AuthBrandColumn';

/**
 * Rahmen aller Anmelde-Ansichten (Arbeitspaket F1).
 *
 * Aufbau wie im Referenz-Mockup: links eine Markenspalte, rechts das Formular.
 * **Mobile-First** (Lastenheft §4): auf dem Smartphone entfällt die Markenspalte
 * ganz und das Formular nimmt die volle Breite ein; die zweite Spalte kommt erst
 * ab `lg` dazu, wo genug Platz dafür ist.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas bg-app-glow lg:grid lg:grid-cols-[0.95fr_1fr]">
      <AuthBrandColumn />
      <main className="flex min-h-screen items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>
    </div>
  );
}
