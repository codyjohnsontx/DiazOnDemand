import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { ComingSoonView } from '@/components/coming-soon-view';
import { LandingView } from '@/components/landing-view';
import { comingSoonEnabled } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function Home() {
  if (comingSoonEnabled) {
    return <ComingSoonView />;
  }

  const { userId } = await auth();
  if (userId) redirect('/library');
  return <LandingView />;
}
