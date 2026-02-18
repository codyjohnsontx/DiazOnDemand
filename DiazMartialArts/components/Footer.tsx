import Link from 'next/link';

import { site } from '@/content/site';

const quickLinks = [
  { href: '/programs', label: 'Programs' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Contact' },
];

export function Footer() {
  const socialLinks = [
    { label: 'Instagram', href: site.socials.instagram },
    { label: 'Facebook', href: site.socials.facebook },
    { label: 'YouTube', href: site.socials.youtube },
  ].filter((item) => Boolean(item.href));

  return (
    <footer className="mt-16 border-t border-black/10 bg-ink text-sand">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-12 sm:grid-cols-2 sm:px-6 lg:grid-cols-4 lg:px-8">
        <div>
          <h3 className="text-lg font-bold">{site.name}</h3>
          <p className="mt-3 text-sm text-white/75">
            Address: {site.address.street}
            <br />
            {site.address.city}, {site.address.state} {site.address.zip}
          </p>
          <p className="mt-3 text-sm text-white/75">
            Phone: <a href={`tel:${site.phone}`}>{site.phone}</a>
            <br />
            Email: <a href={`mailto:${site.email}`}>{site.email}</a>
          </p>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">Hours</h3>
          <ul className="mt-3 space-y-2 text-sm text-white/75">
            {site.hours.map((hour) => (
              <li key={hour}>{hour}</li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">Quick Links</h3>
          <ul className="mt-3 space-y-2 text-sm text-white/75">
            {quickLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="hover:text-white">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className="text-sm font-semibold uppercase tracking-[0.2em] text-white/80">Socials</h3>
          <ul className="mt-3 space-y-2 text-sm text-white/75">
            {socialLinks.map((social) => (
              <li key={social.label}>
                <a href={social.href} target="_blank" rel="noreferrer" className="hover:text-white">
                  {social.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="border-t border-white/10 px-4 py-4 text-center text-xs text-white/60 sm:px-6 lg:px-8">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 sm:flex-row">
          <p>© {new Date().getFullYear()} {site.name}. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-white">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-white">
              Terms
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
