import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="mx-auto w-full max-w-container px-400 pb-tabbar-clearance md:px-600 md:pb-1200">
      <Link
        className="rounded-100 text-body-200 text-foreground-faint transition-colors duration-fast hover:text-foreground-primary"
        href="/privacy"
      >
        Privacy
      </Link>
    </footer>
  );
}
