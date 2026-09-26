import { ArcadeMusicView } from '@/components/admin/arcade-musik/ArcadeMusicView';

export const metadata = {
  title: 'Arcade-Musik · Palantir',
};

/**
 * Arcade-Musik: je Spiel die mitgelieferte Melodie oder ein hochgeladenes
 * Stück (Pflichtenheft §17). Berechtigung ist `canManageGameTypes`.
 */
export default function AdminArcadeMusikPage() {
  return <ArcadeMusicView />;
}
