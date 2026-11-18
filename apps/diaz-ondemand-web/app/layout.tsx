import './globals.css';
import type { ReactNode } from 'react';
import { Manrope, Oswald } from 'next/font/google';
import { AuthProvider } from '@/components/auth-provider';
import { Nav } from '@/components/nav';
import { SiteFooter } from '@/components/site-footer';
import { comingSoonEnabled } from '@/lib/config';

const bodyFont = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '600', '700'],
});

const displayFont = Oswald({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['400', '500', '600'],
});

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className={`${bodyFont.variable} ${displayFont.variable}`}>
        <AuthProvider>
          {!comingSoonEnabled && <Nav />}
          {/* Outside coming-soon the footer is the last thing on the page, so it carries the
              clearance for the phone tab bar, which is fixed over the page. */}
          <main
            className={
              comingSoonEnabled ? 'py-1200 md:py-1600' : 'pb-1200 pt-800 md:pb-1600 md:pt-1200'
            }
          >
            {children}
          </main>
          {!comingSoonEnabled && <SiteFooter />}
        </AuthProvider>
      </body>
    </html>
  );
}
