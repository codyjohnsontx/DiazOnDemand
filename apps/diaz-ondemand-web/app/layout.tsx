import './globals.css';
import type { ReactNode } from 'react';
import { Manrope, Oswald } from 'next/font/google';
import { AuthProvider } from '@/components/auth-provider';
import { Nav } from '@/components/nav';
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
          {/* The bottom padding clears the phone tab bar, which is fixed over the page. */}
          <main
            className={
              comingSoonEnabled
                ? 'py-1200 md:py-1600'
                : 'pb-tabbar-clearance pt-800 md:pb-1600 md:pt-1200'
            }
          >
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
