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
      <body className={`${bodyFont.variable} ${displayFont.variable} antialiased`}>
        <AuthProvider>
          {!comingSoonEnabled && <Nav />}
          <main className={comingSoonEnabled ? 'py-16 sm:py-20' : 'pb-10 pt-36 md:pt-32'}>
            {children}
          </main>
          {!comingSoonEnabled && <SiteFooter />}
        </AuthProvider>
      </body>
    </html>
  );
}
