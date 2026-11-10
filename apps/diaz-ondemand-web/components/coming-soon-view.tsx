import { marketingSiteUrl } from '@/lib/config';

import { AppShell } from './app-shell';
import { ButtonLink } from './ui/button';
import { CardActions } from './ui/card';

export function ComingSoonView() {
  const waitlistUrl = new URL('/ondemand', marketingSiteUrl).toString();

  return (
    <AppShell className="min-h-screen justify-center">
      <section className="mx-auto flex max-w-reading flex-col items-center gap-600 text-center">
        <h1 className="type-display-700">Coming soon</h1>
        <p className="text-body-300 text-foreground-faint">
          The online training library is still being built. Join the waitlist and Diaz Martial Arts
          will let you know when access opens.
        </p>
        <CardActions className="justify-center">
          <ButtonLink href={waitlistUrl} size="lg" variant="primary">
            Join the waitlist
          </ButtonLink>
          <ButtonLink href={marketingSiteUrl} size="lg" variant="secondary">
            Back to Diaz Martial Arts
          </ButtonLink>
        </CardActions>
      </section>
    </AppShell>
  );
}
