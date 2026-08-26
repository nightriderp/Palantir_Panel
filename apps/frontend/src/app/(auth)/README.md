# Auth & Onboarding (F1)

Anmelde-Oberflächen des Panels: Login, Registrierung, 2FA-Eingabe und der
Gast-Wartebildschirm. Fachliche Grundlage: [Lastenheft §3.1](../../../../../LASTENHEFT.md),
technische: [Pflichtenheft §5 und §7](../../../../../PFLICHTENHEFT.md).

## Ansichten

| Route       | Datei                      | Inhalt                                                                 |
| ----------- | -------------------------- | ---------------------------------------------------------------------- |
| `/login`    | `_components/LoginView`    | Benutzername + Passwort, Discord/Twitch/Steam, zweiter Schritt für 2FA |
| `/register` | `_components/RegisterView` | Registrierung mit ALTCHA-Widget                                        |
| `/pending`  | `_components/PendingView`  | Gast-Wartebildschirm für noch nicht freigeschaltete Konten             |

Alle drei liegen im Rahmen aus `layout.tsx`: links die Markenspalte
(`AuthBrandColumn`, erst ab `lg`), rechts das Formular. Auf dem Smartphone
entfällt die Markenspalte – Mobile-First ist Vorgabe (Lastenheft §4).

Die **2FA-Eingabe ist bewusst keine eigene Route**: der Zwischen-Token aus dem
ersten Schritt lebt nur im Speicher und würde einen Seitenwechsel nicht
überstehen.

## Datenfluss

```
Formular → lib/auth/api.ts → Backend (B1)
              ↓ Envelope + Zod-Schema aus @palantir/validation
           AccountDto / LoginResult
              ↓ lib/auth/routes.ts
           /servers  ·  /pending  ·  /login
```

- **Fehler werden anhand des Codes übersetzt**, nie anhand des Freitexts aus der
  Antwort (`lib/auth/errors.ts`, Pflichtenheft §5.1). Die deutschen Sätze stehen
  im `ERROR_CATALOG` in `@palantir/contracts`.
- **Keine Rechteberechnung im Frontend.** Wohin es nach der Anmeldung geht,
  entscheiden `AccountDto.banned` und `AccountDto.awaitingApproval` – beides vom
  Backend gesetzt (Pflichtenheft §5.2). Rollennamen werden nur angezeigt.
- **CSRF:** zustandsändernde Aufrufe schicken das Token aus dem Cookie
  `palantir_csrf` im Header `x-csrf-token` mit (Pflichtenheft §7).

## Erwartete Backend-Endpunkte (B1)

Gesammelt in `AUTH_ENDPOINTS` (`lib/auth/api.ts`) – bei abweichender Pfadwahl
ist das die einzige anzupassende Stelle:

| Pfad                     | Methode | Antwort                    |
| ------------------------ | ------- | -------------------------- |
| `/auth/login`            | POST    | `LoginResult`              |
| `/auth/login/2fa`        | POST    | `{ account: AccountDto }`  |
| `/auth/register`         | POST    | `{ account: AccountDto }`  |
| `/auth/session`          | GET     | `{ account: AccountDto }`  |
| `/auth/logout`           | POST    | `null`                     |
| `/auth/altcha/challenge` | GET     | `AltchaChallenge`          |
| `/auth/<provider>/start` | GET     | Weiterleitung zum Provider |

Scheitert ein Provider-Rücklauf, leitet das Backend auf
`/login?error=<FEHLERCODE>` zurück – ein Code aus dem Katalog, kein Freitext.

## ALTCHA

Das Widget (`_components/AltchaWidget`) holt eine signierte Aufgabe, löst sie im
Hintergrund über die Web-Crypto-API und reicht die base64-kodierte Lösung ans
Formular weiter (`lib/auth/altcha.ts`). Kein Bilderraten, kein Fremdanbieter –
Schwierigkeit und Gültigkeit steuert das Backend über `ALTCHA_COMPLEXITY` und
`ALTCHA_EXPIRY_SECONDS` in der zentralen `.env`.

Bewusst **ohne das offizielle `altcha`-Paket**: der nötige Anteil ist eine
Schleife über `crypto.subtle.digest`; eine Laufzeit-Abhängigkeit mit eigener
Gestaltung und eigenen (englischen) Texten wäre dafür nicht zu rechtfertigen.

## Bausteine

Alles Gemeinsame kommt aus **F2** (`@/components/shared`): `Button`, `Panel`,
`Badge`, `Icon`, `LogoMark`, `cn`. Lokal zu F1 sind nur die Teile, die F2 (noch)
nicht führt:

| Datei             | Warum lokal                                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `AuthField`       | F2 hat bisher keine Formular-Bausteine (Label/Eingabe/Feldfehler)      |
| `AuthFormMessage` | Meldungszeile im Formular – F2 kennt nur Toasts und Modal-Fehlerzeilen |
| `AuthHeading`     | `PageHeader` aus F2 ist für Dashboard-Seiten mit Aktionsleiste gedacht |
| `AuthBrandColumn` | Nur hier verwendet                                                     |

Beide Lücken sind unter „Gefundene Punkte" in
[WORK_STATUS.md](../../../../../WORK_STATUS.md) vermerkt; sobald F2 passende
Bausteine hat, wird hier darauf umgestellt.

## Tests

Reine Logik liegt in `src/lib/auth/` und ist getestet
(`pnpm --filter @palantir/frontend test`): Fehlercode-Übersetzung, Zielroute nach
der Anmeldung, ALTCHA-Lösung und -Kodierung, CSRF-Cookie. Die Ansichten selbst
sind ungetestet – für Komponententests fehlt im Frontend bisher eine
Test-Umgebung (ebenfalls unter „Gefundene Punkte" vermerkt).
