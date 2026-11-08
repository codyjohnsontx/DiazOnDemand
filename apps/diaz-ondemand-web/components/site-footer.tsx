import Link from 'next/link';

export function SiteFooter() {
  return (
    <footer className="student-shell pb-28 pt-6 md:pb-8">
      <Link
        className="type-meta text-[var(--text-muted)] transition-colors duration-200 hover:text-[var(--text)]"
        href="/privacy"
      >
        Privacy
      </Link>
    </footer>
  );
}
