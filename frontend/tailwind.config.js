/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'monospace'],
        mono: ['SF Mono', 'JetBrains Mono', 'Fira Code', 'monospace'],
      },
      colors: {
        osm: {
          background: '#09090b',
          surface: '#18181b',
          border: '#27272a',
          accent: '#ffffff',
          green: '#22c55e',
          red: '#ef4444',
          yellow: '#f59e0b',
          highlight: '#27272a',
          text: '#e4e4e7',
          muted: '#71717a',
        }
      },
      animation: {
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'ticker': 'ticker 35s linear infinite',
      },
      keyframes: {
        ticker: {
          '0%': { transform: 'translateX(0)' },
          '100%': { transform: 'translateX(-50%)' },
        }
      }
    }
  },
  plugins: []
}
