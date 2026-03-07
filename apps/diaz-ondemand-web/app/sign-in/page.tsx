'use client';

import { SignIn } from '@clerk/nextjs';
import { AppShell } from '@/components/app-shell';
import { EmptyState } from '@/components/empty-state';
import { PageHeader } from '@/components/page-header';
import { clerkEnabled } from '@/lib/config';

export default function SignInPage() {
  if (!clerkEnabled) {
    return (
      <AppShell>
        <EmptyState
          description="Clerk keys are not configured for this environment. Use DEV_BYPASS_AUTH=true in the API and NEXT_PUBLIC_DEV_USER_ID in the web app for local development."
          title="Member access is not configured"
        />
      </AppShell>
    );
  }

  return (
    <AppShell className="space-y-8">
      <PageHeader
        description="Sign in to open your library, resume course progress, and manage premium access."
        eyebrow="Member Access"
        title="Enter Diaz on Demand"
      />
      <div className="surface-panel flex justify-center p-4 sm:p-8">
        <SignIn
          appearance={{
            variables: {
              colorBackground: '#12151A',
              colorInputBackground: '#1B1F26',
              colorInputText: '#F3F0E8',
              colorPrimary: '#C44A2D',
              colorText: '#F3F0E8',
              colorTextSecondary: '#9AA3AF',
              borderRadius: '24px',
              fontFamily: 'Avenir Next, Helvetica Neue, sans-serif',
            },
            elements: {
              rootBox: 'w-full max-w-[440px]',
              card: 'w-full border border-white/10 bg-transparent shadow-none',
              headerTitle: 'font-display uppercase tracking-[0.04em] text-3xl text-[#F3F0E8]',
              headerSubtitle: 'text-[#9AA3AF]',
              socialButtonsBlockButton:
                'border border-white/10 bg-white/5 text-[#F3F0E8] hover:bg-white/10 transition-colors duration-200',
              formButtonPrimary:
                'bg-[#C44A2D] hover:bg-[#E0643F] text-[#F3F0E8] uppercase tracking-[0.18em] text-xs font-semibold',
              formFieldInput:
                'border border-white/10 bg-[#1B1F26] text-[#F3F0E8] focus:border-[#35E0A1] focus:ring-0',
              footerActionLink: 'text-[#F3F0E8] hover:text-white',
            },
          }}
          fallbackRedirectUrl="/library"
        />
      </div>
    </AppShell>
  );
}
