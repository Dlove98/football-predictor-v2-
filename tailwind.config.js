/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Palette "trading sportif" — fond bleu-nuit profond, jamais un noir pur
        base: {
          950: '#080b12',
          900: '#0d1119',
          800: '#12161f',
          700: '#1a1f2b',
          600: '#242a38',
        },
        line: '#232838',
        ink: {
          100: '#eef1f6',
          300: '#c2c8d6',
          500: '#8992a6',
          700: '#5b6376',
        },
        signal: {
          home: '#22c78a',   // victoire domicile
          draw: '#e0a83e',   // match nul
          away: '#5b8def',   // victoire extérieur
          risk: '#e2596b',   // faible confiance / alerte discrète
        },
      },
      fontFamily: {
        sans: ['var(--font-manrope)', 'ui-sans-serif', 'system-ui'],
        mono: ['var(--font-jetbrains)', 'ui-monospace', 'SFMono-Regular'],
      },
      boxShadow: {
        card: '0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.6)',
      },
      borderRadius: {
        xl2: '1.1rem',
      },
    },
  },
  plugins: [],
};
