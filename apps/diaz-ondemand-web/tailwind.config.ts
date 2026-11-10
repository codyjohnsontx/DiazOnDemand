import type { Config } from 'tailwindcss';

/**
 * The theme is the token list in app/globals.css, by name. Every scale that carries a
 * design value is replaced rather than extended, so a class such as `p-4`, `text-sm`,
 * `rounded-full` or `bg-white/5` does not exist here and a raw value cannot be written
 * without an arbitrary-value bracket, which tests/design-tokens.test.ts refuses.
 */
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      surface: {
        page: 'var(--color-surface-page)',
        primary: 'var(--color-surface-primary)',
        raised: 'var(--color-surface-raised)',
        'interactive-hover': 'var(--color-surface-interactive-hover)',
        'interactive-active': 'var(--color-surface-interactive-active)',
        'success-faint': 'var(--color-surface-success-faint)',
        'premium-faint': 'var(--color-surface-premium-faint)',
        'critical-faint': 'var(--color-surface-critical-faint)',
        accent: 'var(--color-surface-accent)',
        'accent-hover': 'var(--color-surface-accent-hover)',
        'accent-active': 'var(--color-surface-accent-active)',
      },
      border: {
        primary: 'var(--color-border-primary)',
        strong: 'var(--color-border-strong)',
        success: 'var(--color-border-success)',
        premium: 'var(--color-border-premium)',
        critical: 'var(--color-border-critical)',
      },
      foreground: {
        primary: 'var(--color-foreground-primary)',
        faint: 'var(--color-foreground-faint)',
        disabled: 'var(--color-foreground-disabled)',
        'on-accent': 'var(--color-foreground-on-accent)',
        accent: 'var(--color-foreground-accent)',
        success: 'var(--color-foreground-success)',
        premium: 'var(--color-foreground-premium)',
        critical: 'var(--color-foreground-critical)',
      },
      focus: {
        ring: 'var(--color-focus-ring)',
      },
    },
    spacing: {
      0: '0',
      '050': 'var(--space-050)',
      100: 'var(--space-100)',
      200: 'var(--space-200)',
      300: 'var(--space-300)',
      400: 'var(--space-400)',
      500: 'var(--space-500)',
      600: 'var(--space-600)',
      800: 'var(--space-800)',
      1000: 'var(--space-1000)',
      1200: 'var(--space-1200)',
      1600: 'var(--space-1600)',
      'control-sm': 'var(--control-height-sm)',
      'control-md': 'var(--control-height-md)',
      'control-lg': 'var(--control-height-lg)',
      icon: 'var(--icon-size)',
      logo: 'var(--logo-size)',
      progress: 'var(--progress-height)',
      nav: 'var(--nav-height)',
      tabbar: 'var(--tabbar-height)',
      'tabbar-clearance': 'var(--tabbar-clearance)',
    },
    borderRadius: {
      none: '0',
      100: 'var(--radius-100)',
      200: 'var(--radius-200)',
      300: 'var(--radius-300)',
      400: 'var(--radius-400)',
    },
    borderWidth: {
      DEFAULT: 'var(--border-width)',
      0: '0',
    },
    fontFamily: {
      display: ['var(--font-display)', 'Arial Narrow', 'sans-serif'],
      body: ['var(--font-body)', 'Helvetica Neue', 'Arial', 'sans-serif'],
    },
    fontSize: {
      'display-700': [
        'var(--type-display-700-size)',
        {
          lineHeight: 'var(--type-display-700-line)',
          letterSpacing: 'var(--letter-spacing-display)',
        },
      ],
      'display-500': [
        'var(--type-display-500-size)',
        {
          lineHeight: 'var(--type-display-500-line)',
          letterSpacing: 'var(--letter-spacing-display)',
        },
      ],
      'display-400': [
        'var(--type-display-400-size)',
        {
          lineHeight: 'var(--type-display-400-line)',
          letterSpacing: 'var(--letter-spacing-display)',
        },
      ],
      'display-300': [
        'var(--type-display-300-size)',
        {
          lineHeight: 'var(--type-display-300-line)',
          letterSpacing: 'var(--letter-spacing-display)',
        },
      ],
      'body-300': ['var(--type-body-300-size)', { lineHeight: 'var(--type-body-300-line)' }],
      'body-200': ['var(--type-body-200-size)', { lineHeight: 'var(--type-body-200-line)' }],
      'body-100': ['var(--type-body-100-size)', { lineHeight: 'var(--type-body-100-line)' }],
    },
    fontWeight: {
      regular: 'var(--font-weight-regular)',
      medium: 'var(--font-weight-medium)',
      semibold: 'var(--font-weight-semibold)',
    },
    letterSpacing: {
      display: 'var(--letter-spacing-display)',
      body: 'var(--letter-spacing-body)',
      caps: 'var(--letter-spacing-caps)',
    },
    boxShadow: {
      none: 'none',
      overlay: 'var(--elevation-overlay)',
    },
    transitionDuration: {
      DEFAULT: 'var(--duration-fast)',
      fast: 'var(--duration-fast)',
    },
    transitionTimingFunction: {
      DEFAULT: 'var(--easing-standard)',
      standard: 'var(--easing-standard)',
    },
    opacity: {
      0: '0',
      100: '1',
      disabled: 'var(--opacity-disabled)',
    },
    zIndex: {
      auto: 'auto',
      nav: 'var(--z-nav)',
    },
    outlineWidth: {
      ring: 'var(--focus-ring-width)',
    },
    outlineOffset: {
      0: '0',
      ring: 'var(--focus-ring-offset)',
    },
    extend: {
      maxWidth: {
        container: 'var(--container-width)',
        reading: 'var(--reading-width)',
        sidebar: 'var(--sidebar-width)',
      },
      gridTemplateColumns: {
        split: 'minmax(0, 1fr) minmax(0, 1fr)',
        sidebar: 'minmax(0, 1fr) var(--sidebar-width)',
      },
    },
  },
  plugins: [],
};

export default config;
