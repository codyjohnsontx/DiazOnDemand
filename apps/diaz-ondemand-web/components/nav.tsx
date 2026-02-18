import Link from 'next/link';

export function Nav() {
  return (
    <nav className="flex flex-wrap gap-4 border-b bg-white px-6 py-4 text-sm">
      <Link href="/library">Library</Link>
      <Link href="/favorites">Favorites (mobile only for MVP)</Link>
      <Link href="/admin/programs">Admin Programs</Link>
      <Link href="/subscribe">Subscribe</Link>
      <Link href="/sign-in">Sign In</Link>
    </nav>
  );
}
