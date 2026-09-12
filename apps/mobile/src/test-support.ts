/**
 * Helpers shared by the mobile test suite.
 *
 * `visibleText` is the single oracle every text assertion in the suite reads
 * through, including `expect(visibleText(stranger)).not.toContain(...)`, which
 * *is* the enumeration property rather than a check on it. That is why it lives
 * in one place: with a copy per file, anyone teaching it to descend into a node
 * shape it currently drops fixes the file they happen to have open, and the
 * security-critical assertion silently starts reading a smaller slice of the
 * screen while still passing. A test that quietly stops testing is the exact
 * failure this suite exists to prevent.
 */
import type { ReactTestRenderer } from 'react-test-renderer';

/** Every string the rendered tree puts in front of a user, in render order. */
export function visibleText(tree: ReactTestRenderer): string {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null || node === false) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join('\n');
}
