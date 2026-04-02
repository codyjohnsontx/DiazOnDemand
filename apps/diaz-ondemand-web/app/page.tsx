import { redirect } from 'next/navigation';
import { auth } from '@clerk/nextjs/server';
import { LandingView } from '@/components/landing-view';

export default async function Home() {
  const { userId } = await auth();
  if (userId) redirect('/library');
  return <LandingView />;
}
