import { ServerOverview } from '@/components/servers/ServerOverview';

export const metadata = {
  title: 'Übersicht · Palantir',
};

/** Serverübersicht (Arbeitspaket F3, Lastenheft §3.3). */
export default function ServersPage() {
  return <ServerOverview />;
}
