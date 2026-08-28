'use client';

import { PhaseLockedPlaceholder, type IconName } from '@/components/shared';
import { useSession } from '@/app/(dashboard)/SessionProvider';
import { AdminAccessNotice, AdminLoading } from '../common';

/**
 * Gemeinsamer „Kommt später"-Zustand der Admin-Spiele-Verwaltung (Arbeitspaket
 * F11).
 *
 * Die vier Bereiche (Templates, Bilder, Sticker, Arcade-Musik) sind in Version 1
 * bewusst reine Platzhalter: Eine Admin-Oberfläche zum Hinzufügen neuer
 * Spiele-Typen gibt es laut Lastenheft §6 in Version 1 ausdrücklich nicht –
 * neue Spiele kommen über Code/Deployment. Fachlich entstehen diese Bereiche
 * erst mit dem generischen Spiele-Definitionssystem in Phase 3 (Lastenheft §7).
 *
 * Deshalb wird hier **keine** Verwaltungslogik, kein Upload und kein
 * Backend-Aufruf gebaut, sondern durchgehend die gemeinsame Komponente
 * `PhaseLockedPlaceholder` aus F2 verwendet – so sehen alle Phase-2/3-Seiten
 * identisch aus und verschwinden später gleichzeitig.
 *
 * Die Sichtbarkeit entscheidet allein das `permissions`-Objekt des Kontos
 * (`canManageGameTypes`, Pflichtenheft §5.2, §8). Das Recht `gametype.manage`
 * bleibt in Version 1 ohne funktionalen UI-Pfad: es schaltet nichts frei,
 * sondern blendet nur diesen Platzhalter ein. Das Ausblenden im UI ergänzt eine
 * Backend-Prüfung – hier gibt es mangels Endpunkt keine, weil es nichts zu
 * schützen gibt.
 */
export interface GameAdminPlaceholderProps {
  /** Bereichsname, z. B. „Templates" oder „Arcade-Musik". */
  title: string;
  /** Ein Satz, was hier später zu sehen sein wird (kein Fehlereindruck). */
  description: string;
  icon: IconName;
}

export function GameAdminPlaceholder({ title, description, icon }: GameAdminPlaceholderProps) {
  const { user, loading } = useSession();
  const canManage = user?.permissions.canManageGameTypes ?? false;

  if (loading) {
    return <AdminLoading label={`${title} wird geöffnet …`} />;
  }

  if (!canManage) {
    return <AdminAccessNotice area={`die Spiele-Verwaltung „${title}"`} />;
  }

  return <PhaseLockedPlaceholder title={title} description={description} phase={3} icon={icon} />;
}
