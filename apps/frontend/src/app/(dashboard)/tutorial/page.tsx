import { TutorialView } from '@/components/tutorial/TutorialView';

export const metadata = {
  title: 'Tutorial · Palantir',
};

/**
 * Einweisung ins Panel – erklärt jeden Bereich der Seitenleiste und zieht den
 * Nutzer dabei auf. Freiwillig, überspringbar, ohne Backend.
 */
export default function TutorialPage() {
  return <TutorialView />;
}
