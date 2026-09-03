/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        heading: ['Helvetica Now Display Bold', 'Helvetica', 'Arial', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        accent: {
          DEFAULT: '#0a5743',
          light: '#16a34a',
          muted: 'rgba(10, 87, 67, 0.1)',
        },
        ink: '#0d1a15',
        'login-bg': '#F2F2EE',
      },
      boxShadow: {
        glass: '0 8px 32px rgba(10, 87, 67, 0.12), 0 2px 8px rgba(10, 87, 67, 0.06)',
        cta: '0 4px 24px rgba(10,87,67,0.28)',
        card: '0 24px 64px rgba(10, 87, 67, 0.18), 0 4px 16px rgba(10, 87, 67, 0.1)',
        sheet: '-12px 0 48px rgba(25,40,55,0.18)',
      },
    },
  },
  plugins: [],
};
