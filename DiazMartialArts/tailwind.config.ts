import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './components/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#101214',
        ember: '#B42318',
        sand: '#F7F3ED',
        bronze: '#8A4B10',
      },
      boxShadow: {
        ring: '0 10px 30px -12px rgba(16, 18, 20, 0.35)',
      },
      keyframes: {
        rise: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        rise: 'rise 650ms ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
