'use client';

import { SignIn } from '@clerk/nextjs';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { clerkEnabled, devBypassEnabled } from '@/lib/config';
import { tokenLiteral } from '@/lib/design-tokens';

export default function SignInPage() {
  if (!clerkEnabled) {
    return (
      <AppShell>
        <EmptyState
          description={
            devBypassEnabled
              ? 'Sign-in is temporarily bypassed for development. You can keep working through the library as the configured local dev user.'
              : 'Clerk keys are not configured for this environment. Configure Clerk for real member sign-in or explicitly enable development bypass locally.'
          }
          title={
            devBypassEnabled ? 'Development access is enabled' : 'Member access is not configured'
          }
        />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader title="Enter Diaz on Demand" />
      <Card className="flex justify-center">
        <SignIn
          appearance={{
            // Clerk derives shades and radii from these, so they are the literal mirror of
            // the tokens rather than the custom properties; the element classes below use
            // the tokens.
            variables: {
              colorBackground: tokenLiteral['color-surface-primary'],
              colorInputBackground: tokenLiteral['color-surface-raised'],
              colorInputText: tokenLiteral['color-foreground-primary'],
              colorPrimary: tokenLiteral['color-surface-accent'],
              colorText: tokenLiteral['color-foreground-primary'],
              colorTextSecondary: tokenLiteral['color-foreground-faint'],
              colorDanger: tokenLiteral['color-foreground-critical'],
              borderRadius: tokenLiteral['radius-200'],
              fontFamily: 'var(--font-body), Helvetica Neue, sans-serif',
            },
            elements: {
              rootBox: 'w-full max-w-sidebar',
              card: 'w-full border border-border-primary bg-transparent shadow-none',
              headerTitle: 'type-display-500',
              headerSubtitle: 'text-foreground-faint',
              socialButtonsBlockButton:
                'border border-border-strong bg-surface-raised text-foreground-primary hover:bg-surface-interactive-hover transition-colors duration-fast',
              formButtonPrimary:
                'bg-surface-accent hover:bg-surface-accent-hover text-foreground-on-accent text-body-200 font-semibold',
              formFieldInput:
                'border border-border-strong bg-surface-raised text-foreground-primary focus:border-focus-ring focus:ring-0',
              footerActionLink: 'text-foreground-primary hover:text-foreground-accent',
            },
          }}
          fallbackRedirectUrl="/library"
        />
      </Card>
    </AppShell>
  );
}
