/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.16, 1, 0.3, 1)',
        snappy: 'cubic-bezier(0.4, 0, 0.2, 1)',
      },
      transitionDuration: {
        250: '250ms',
        350: '350ms',
      },
      boxShadow: {
        subtle: '0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.03)',
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.04)',
        'card-hover': '0 8px 24px -4px rgb(0 0 0 / 0.08), 0 2px 8px -2px rgb(0 0 0 / 0.05)',
        popover: '0 12px 32px -8px rgb(0 0 0 / 0.16), 0 4px 12px -4px rgb(0 0 0 / 0.08)',
      },
      keyframes: {
        'fade-in': {
          from: { opacity: 0 },
          to: { opacity: 1 },
        },
        'fade-out': {
          from: { opacity: 1 },
          to: { opacity: 0 },
        },
        'scale-in': {
          from: { opacity: 0, transform: 'scale(0.96)' },
          to: { opacity: 1, transform: 'scale(1)' },
        },
        'scale-out': {
          from: { opacity: 1, transform: 'scale(1)' },
          to: { opacity: 0, transform: 'scale(0.96)' },
        },
        'slide-up': {
          from: { opacity: 0, transform: 'translateY(8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        'slide-down': {
          from: { opacity: 0, transform: 'translateY(-8px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        'slide-in-end': {
          from: { opacity: 0, transform: 'translateX(var(--slide-from, 12px))' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
        'sheet-in': {
          from: { transform: 'translateX(var(--sheet-from, 100%))' },
          to: { transform: 'translateX(0)' },
        },
        shimmer: {
          from: { backgroundPosition: '150% 0' },
          to: { backgroundPosition: '-50% 0' },
        },
        'progress-shrink': {
          from: { transform: 'scaleX(1)' },
          to: { transform: 'scaleX(0)' },
        },
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgb(15 23 42 / 0.12)' },
          '100%': { boxShadow: '0 0 0 8px rgb(15 23 42 / 0)' },
        },
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
        'fade-out': 'fade-out 150ms ease-in both',
        'scale-in': 'scale-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'scale-out': 'scale-out 150ms ease-in both',
        'slide-up': 'slide-up 260ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-down': 'slide-down 200ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'slide-in-end': 'slide-in-end 220ms cubic-bezier(0.16, 1, 0.3, 1) both',
        'sheet-in': 'sheet-in 280ms cubic-bezier(0.16, 1, 0.3, 1) both',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
        'progress-shrink': 'progress-shrink linear forwards',
      },
    },
  },
  plugins: [],
};
