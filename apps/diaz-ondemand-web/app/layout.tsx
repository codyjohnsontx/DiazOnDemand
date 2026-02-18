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
          <main className="mx-auto max-w-5xl p-6">{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
