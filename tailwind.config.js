/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: { base: '#090D16', card: '#111827', accent: '#10B981' },
    },
  },
  plugins: [],
};
