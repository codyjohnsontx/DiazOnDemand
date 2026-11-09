'use client';

import { SignIn } from '@clerk/nextjs';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { Card } from '@/components/ui/card';
import { clerkEnabled, devBypassEnabled } from '@/lib/config';
import { tokenHex } from '@/lib/design-tokens';

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
            // Clerk derives shades from these, so they are the hex mirror of the tokens
            // rather than the custom properties; the element classes below use the tokens.
            variables: {
              colorBackground: tokenHex['color-surface-primary'],
              colorInputBackground: tokenHex['color-surface-raised'],
              colorInputText: tokenHex['color-foreground-primary'],
              colorPrimary: tokenHex['color-surface-accent'],
              colorText: tokenHex['color-foreground-primary'],
              colorTextSecondary: tokenHex['color-foreground-faint'],
              colorDanger: tokenHex['color-foreground-critical'],
              borderRadius: 'var(--radius-200)',
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
