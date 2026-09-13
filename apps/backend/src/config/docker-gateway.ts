import { readFileSync } from 'node:fs';

/**
 * Das Standard-Gateway des eigenen Containers (Fundpunkt 288).
 *
 * **Wozu.** Der Health-Check fragt die Spielserver über frps ab. Läuft das
 * Backend auf derselben Maschine wie frps, geht das Paket über das Gateway
 * hinaus und die Antwort kommt mit **dessen** Adresse als Absender zurück –
 * die NAT-Schleife des Hosts setzt sie ein. `gamedig` nimmt eine UDP-Antwort
 * nur von der Adresse an, die es gefragt hat. Gefragt werden muss also genau
 * die Adresse, auf die zurückgeschrieben wird: das Gateway der eigenen Route.
 *
 * **Warum nicht `host.docker.internal`.** Der Name lässt sich über
 * `extra_hosts: host-gateway` setzen, zeigt dann aber auf das Gateway der
 * Standard-Bridge (`172.17.0.1`) – und nicht auf das des Netzes, an dem der
 * Container tatsächlich hängt (`172.20.0.1` beim Netz `palantir`). Damit
 * stimmen Ziel und Absender wieder nicht überein. Am 13.09.2026 auf der VPS
 * genau so gemessen: Abfrage an `172.17.0.1` scheitert, an `172.20.0.1`
 * antwortet derselbe Server in 42 ms.
 *
 * Die Route ist die einzige Quelle, die beides zusammenhält: Das Gateway der
 * Standardroute ist per Konstruktion dasselbe, auf das der Rückweg umgeschrieben
 * wird – auch wenn der Container an mehreren Netzen hängt oder Docker die
 * Adressbereiche anders vergibt.
 */

/** Pfad der Kernel-Routentabelle; als Parameter, damit der Test ihn stellt. */
const ROUTEN_PFAD = '/proc/net/route';

/**
 * Liest das Gateway der Standardroute aus dem Inhalt von `/proc/net/route`.
 *
 * Format der Datei: eine Kopfzeile, danach je Route eine Zeile mit
 * tabgetrennten Feldern. `Destination` `00000000` ist die Standardroute, das
 * Feld `Gateway` daneben trägt die Adresse als **little-endian** Hexwert
 * (`0100A8C0` ist `192.168.0.1`).
 *
 * Gibt `null` zurück, wenn es keine Standardroute gibt oder die Zeile nicht
 * lesbar ist – geraten wird nichts.
 */
export function standardGatewayAusRouten(inhalt: string): string | null {
  for (const zeile of inhalt.split('\n').slice(1)) {
    const felder = zeile.trim().split(/\s+/);

    // Iface, Destination, Gateway, Flags, ... – weniger ist keine Route.
    if (felder.length < 3) {
      continue;
    }

    const [, ziel, gateway] = felder;

    if (ziel !== '00000000' || gateway === undefined || !/^[0-9A-Fa-f]{8}$/.test(gateway)) {
      continue;
    }

    // 00000000 als Gateway heisst „direkt verbunden" – dann gibt es keines.
    if (gateway === '00000000') {
      continue;
    }

    const zahl = Number.parseInt(gateway, 16);
    const oktette = [zahl & 0xff, (zahl >>> 8) & 0xff, (zahl >>> 16) & 0xff, (zahl >>> 24) & 0xff];

    return oktette.join('.');
  }

  return null;
}

/**
 * Dasselbe, aber von der laufenden Maschine.
 *
 * `null`, wenn die Datei fehlt (jedes System ausser Linux) oder keine
 * Standardroute führt. Der Aufrufer entscheidet, was das bedeutet.
 */
export function standardGatewayDesContainers(pfad: string = ROUTEN_PFAD): string | null {
  try {
    return standardGatewayAusRouten(readFileSync(pfad, 'utf8'));
  } catch {
    return null;
  }
}
