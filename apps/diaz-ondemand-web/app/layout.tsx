import './globals.css';
import type { ReactNode } from 'react';
import { Manrope, Oswald } from 'next/font/google';
import { AuthProvider } from '@/components/auth-provider';
import { Nav } from '@/components/nav';

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
          <Nav />
          <main className="pb-28 pt-28 sm:pb-20 sm:pt-32">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
