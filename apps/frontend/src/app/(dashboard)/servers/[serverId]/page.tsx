import { Suspense } from 'react';
import { ServerDetail } from '@/components/servers/detail/ServerDetail';

export const metadata = {
  title: 'Server · Palantir',
};

/**
 * Server-Detailansicht (Arbeitspaket F3, Lastenheft §3.3).
 *
 * Der aktive Reiter steht als `?tab=` in der Adresszeile; `useSearchParams()`
 * verlangt deshalb eine `Suspense`-Grenze.
 */
export default async function ServerDetailPage({
  params,
}: {
  params: Promise<{ serverId: string }>;
}) {
  const { serverId } = await params;

  return (
    <Suspense fallback={<p className="text-base text-ink-muted">Server wird geladen …</p>}>
      <ServerDetail serverId={serverId} />
    </Suspense>
  );
}
