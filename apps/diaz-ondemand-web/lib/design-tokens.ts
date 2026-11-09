/**
 * The few token values that have to be handed to a third-party widget as a literal.
 *
 * Clerk's `appearance.variables` derives hover and shade colours from the value it is
 * given, and the Mux player takes its accent as an attribute, so neither can read a CSS
 * custom property. Every value here mirrors the token of the same name in
 * app/globals.css, and tests/design-tokens.test.ts fails if the two drift apart.
 */
export const tokenHex = {
  'color-surface-primary': '#12151a',
  'color-surface-raised': '#1b1f26',
  'color-surface-accent': '#c44a2d',
  'color-foreground-primary': '#f3f0e8',
  'color-foreground-faint': '#9aa3af',
  'color-foreground-critical': '#e36d6d',
} as const;
