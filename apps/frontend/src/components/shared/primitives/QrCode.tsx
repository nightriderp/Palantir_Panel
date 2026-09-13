'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { cn } from '../utils/cn';

export interface QrCodeProps {
  /** Was der Code trägt – bei 2FA die `otpauth://`-Adresse. */
  value: string;
  /**
   * Kantenlänge in Bildpunkten. Der Code selbst ist auflösungsfrei (SVG); die
   * Angabe bestimmt nur, wie groß er gezeichnet wird.
   */
  size?: number;
  /**
   * Beschriftung für Vorlesehilfen. Der Code selbst ist für sie wertlos –
   * daneben steht deshalb immer auch der Text, den er enthält.
   */
  label: string;
  className?: string;
}

/**
 * QR-Code als SVG.
 *
 * **Neue Abhängigkeit `qrcode-generator` (CLAUDE.md §1).** Die Kodierung eines
 * QR-Codes ist Reed-Solomon-Fehlerkorrektur samt Maskenwahl – genau die Sorte
 * Code, die man nicht selbst schreibt. Gewählt wurde die kleinste ernsthafte
 * Umsetzung: eine Datei, **keine** eigenen Abhängigkeiten, MIT. Das übliche
 * `qrcode`-Paket zieht für den Browser-Weg unter anderem einen PNG-Kodierer
 * und einen Kommandozeilen-Parser mit.
 *
 * Gezeichnet wird hier, nicht von der Bibliothek: Sie liefert nur die Matrix
 * (`isDark`), das SVG entsteht aus unseren eigenen Tokens. So kommt kein
 * fremdes Markup über `dangerouslySetInnerHTML` in die Seite, und der Code
 * trägt dieselbe Farbe wie alles andere.
 *
 * **Die Zeichenfolge daneben bleibt.** Der QR-Code ist die Abkürzung, nicht der
 * einzige Weg: Wer am selben Gerät sitzt wie seine Authenticator-App, kann
 * nichts abfotografieren und braucht den Text (Lastenheft §4, Bedienbarkeit).
 */
export function QrCode({ value, size = 176, label, className }: QrCodeProps) {
  const matrix = useMemo(() => {
    /*
     * Typnummer 0 heisst „so klein wie möglich"; die Fehlerkorrektur steht auf
     * `M` – die übliche Wahl für otpauth-Adressen. Höher machte den Code
     * dichter, ohne dass ihn eine Kamera besser läse.
     */
    const code = qrcode(0, 'M');
    code.addData(value);
    code.make();

    const zaehlung = code.getModuleCount();
    const felder: boolean[][] = [];

    for (let zeile = 0; zeile < zaehlung; zeile += 1) {
      const spalten: boolean[] = [];
      for (let spalte = 0; spalte < zaehlung; spalte += 1) {
        spalten.push(code.isDark(zeile, spalte));
      }
      felder.push(spalten);
    }

    return felder;
  }, [value]);

  const zaehlung = matrix.length;
  /** Ruhezone: vier Module ringsum, wie die Norm sie verlangt. */
  const rand = 4;
  const kante = zaehlung + rand * 2;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${kante} ${kante}`}
      width={size}
      height={size}
      className={cn('rounded-md bg-white p-0', className)}
      shapeRendering="crispEdges"
    >
      {matrix.map((spalten, zeile) =>
        spalten.map((dunkel, spalte) =>
          dunkel ? (
            <rect
              key={`${zeile}-${spalte}`}
              x={spalte + rand}
              y={zeile + rand}
              width={1}
              height={1}
              fill="#000"
            />
          ) : null,
        ),
      )}
    </svg>
  );
}
