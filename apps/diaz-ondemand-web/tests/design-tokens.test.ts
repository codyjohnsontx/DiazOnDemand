import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { tokenHex } from '../lib/design-tokens';

/**
 * The mechanical half of "no raw design values": every colour, size, space, radius,
 * shadow and duration in the web app comes from the token block in app/globals.css, by
 * name, through the Tailwind theme. These checks refuse the ways a raw value gets back in.
 */
const root = join(__dirname, '..');
const sourceDirs = ['app', 'components'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry) ? [path] : [];
  });
}

const files = sourceDirs.flatMap((dir) => sourceFiles(join(root, dir)));

/** The numeric steps of the spacing scale; any other number after a spacing utility is raw. */
const spacingSteps = new Set([
  '0',
  '050',
  '100',
  '200',
  '300',
  '400',
  '500',
  '600',
  '800',
  '1000',
  '1200',
  '1600',
]);
const spacingUtilities =
  'p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|gap-x|gap-y|space-x|space-y|w|h|size|min-w|min-h|max-h|top|bottom|left|right|inset|inset-x|inset-y|translate-x|translate-y';

const forbidden: { name: string; pattern: RegExp }[] = [
  { name: 'arbitrary Tailwind value', pattern: /\b[a-z][a-z-]*-\[[^\]]+\]/ },
  { name: 'translucent white or black', pattern: /\b[a-z-]+-(?:white|black)(?:\/\d+)?\b/ },
  {
    name: 'default Tailwind radius',
    pattern: /\brounded(?:-[trbl]{1,2})?(?:-(?:full|sm|md|lg|xl|\dxl))?(?=\s|"|'|`|$)/,
  },
  { name: 'default Tailwind font size', pattern: /\btext-(?:xs|sm|base|lg|xl|\dxl)\b/ },
  {
    name: 'default Tailwind weight',
    pattern: /\bfont-(?:thin|light|normal|bold|extrabold|black)\b/,
  },
  {
    name: 'default Tailwind tracking',
    pattern: /\btracking-(?:tighter|tight|normal|wide|wider|widest)\b/,
  },
  { name: 'numeric duration, opacity or z-index', pattern: /\b(?:duration|opacity|z)-\d+\b/ },
  {
    name: 'default Tailwind shadow',
    pattern: /\bshadow(?:-(?:sm|md|lg|xl|2xl|inner))?(?=\s|"|'|`|$)/,
  },
  { name: 'gradient or blur', pattern: /gradient|backdrop-blur/ },
  { name: 'hex colour', pattern: /#[0-9a-fA-F]{3,8}\b/ },
];

const spacingPattern = new RegExp(`\\b(?:${spacingUtilities})-(\\d+(?:\\.\\d+)?|px)\\b`, 'g');

describe('design tokens', () => {
  it('finds the web app source', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  for (const file of files) {
    const name = relative(root, file);
    const source = readFileSync(file, 'utf8');

    it(`${name} is built only from tokens`, () => {
      const offences: string[] = [];

      for (const { name: kind, pattern } of forbidden) {
        const match = source.match(pattern);
        if (match) offences.push(`${kind}: ${match[0]}`);
      }

      for (const match of source.matchAll(spacingPattern)) {
        if (!spacingSteps.has(match[1] ?? '')) offences.push(`raw spacing: ${match[0]}`);
      }

      expect(offences).toEqual([]);
    });
  }

  const css = readFileSync(join(root, 'app', 'globals.css'), 'utf8');

  for (const [token, hex] of Object.entries(tokenHex)) {
    it(`mirrors ${token} from app/globals.css in lib/design-tokens.ts`, () => {
      const declared = css.match(new RegExp(`--${token}:\\s*(#[0-9a-f]{6});`));

      expect(declared?.[1] ?? null).toBe(hex);
    });
  }
});
