/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0a0c11',
        panel: '#0f1219',
        panel2: '#141824',
        panel3: '#1a1f2d',
        line: '#232a3b',
        accent: '#6c7cff',
        accent2: '#9a6bff',
        ok: '#37d39b',
        warn: '#f5b544',
        danger: '#ff5d73',
        muted: '#8a93a8',
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glow: '0 0 40px rgba(108, 124, 255, 0.25)',
        panel: '0 20px 60px rgba(0, 0, 0, 0.45)',
      },
      keyframes: {
        'pulse-soft': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
        'rise': {
          '0%': { opacity: '0', transform: 'translateY(8px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
        'speak': {
          '0%, 100%': { boxShadow: '0 0 0 2px rgba(55, 211, 155, 0.55)' },
          '50%': { boxShadow: '0 0 0 5px rgba(55, 211, 155, 0.16)' },
        },
      },
      animation: {
        'pulse-soft': 'pulse-soft 2s ease-in-out infinite',
        rise: 'rise 0.18s ease-out',
        speak: 'speak 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
