import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import postcss, { type Root } from 'postcss';
import tailwindcss from 'tailwindcss';
import { describe, expect, it } from 'vitest';
import { tokenLiteral } from '../lib/design-tokens';
import tailwindConfig from '../tailwind.config';

/**
 * The mechanical half of "no raw design values": every colour, size, space, radius,
 * shadow and duration in the web app comes from the token block in app/globals.css, by
 * name, through the Tailwind theme. These checks run the stylesheet the app ships through
 * Tailwind and read what comes out.
 */
const root = join(__dirname, '..');
const globalsPath = join(root, 'app', 'globals.css');
const globals = readFileSync(globalsPath, 'utf8');

async function compile(css: string, content: string[]) {
  const config = { ...tailwindConfig, content };
  const result = await postcss([tailwindcss(config)]).process(css, { from: globalsPath });
  return result.root;
}

function declarations(css: Root) {
  const found: { selector: string; prop: string; value: string }[] = [];
  css.walkDecls((decl) => {
    const parent = decl.parent;
    const selector =
      parent && parent.type === 'rule' ? (parent as { selector: string }).selector : '';
    found.push({ selector, prop: decl.prop, value: decl.value });
  });
  return found;
}

const key = ({ selector, prop, value }: { selector: string; prop: string; value: string }) =>
  `${selector}|${prop}|${value}`;

const rawColour =
  /#[0-9a-f]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:white|black)\b/i;
const decoration = /gradient|blur\(/i;
/** Tailwind's empty shadow, a transparent placeholder in its ring and shadow composition. */
const emptyShadow = /0 0 #0000/g;

describe('design tokens', () => {
  const content = (tailwindConfig.content as string[]).map((glob) => join(root, glob));
  const shipped = compile(globals, content);
  const reset = compile('@tailwind base;', []);

  it('compiles the utilities the app uses', async () => {
    const selectors = new Set(declarations(await shipped).map((decl) => decl.selector));

    expect(selectors).toContain('.bg-surface-raised');
    expect(selectors).toContain('.p-600');
  });

  it('generates no arbitrary Tailwind value', async () => {
    const arbitrary = new Set<string>();
    (await shipped).walkRules((rule) => {
      if (rule.selector.includes('\\[')) arbitrary.add(rule.selector);
    });

    expect([...arbitrary]).toEqual([]);
  });

  it('holds raw colours, gradients and blurs only in the :root token block', async () => {
    const tailwindReset = new Set(declarations(await reset).map(key));
    const offences = declarations(await shipped)
      .filter((decl) => decl.selector !== ':root' && !tailwindReset.has(key(decl)))
      .filter((decl) => {
        const value = decl.value.replace(emptyShadow, '');
        return rawColour.test(value) || decoration.test(value);
      })
      .map((decl) => `${decl.selector} { ${decl.prop}: ${decl.value} }`);

    expect(offences).toEqual([]);
  });

  const tokens = new Map<string, string>();
  postcss.parse(globals).walkRules(':root', (rule) => {
    rule.walkDecls((decl) => {
      tokens.set(decl.prop, decl.value);
    });
  });

  for (const [token, literal] of Object.entries(tokenLiteral)) {
    it(`mirrors ${token} from app/globals.css in lib/design-tokens.ts`, () => {
      expect(tokens.get(`--${token}`) ?? null).toBe(literal);
    });
  }
});
