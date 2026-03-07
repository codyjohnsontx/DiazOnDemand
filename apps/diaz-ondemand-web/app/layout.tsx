import './globals.css';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth-provider';
import { Nav } from '@/components/nav';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          <Nav />
          <main className="pb-28 pt-28 sm:pb-20 sm:pt-32">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
