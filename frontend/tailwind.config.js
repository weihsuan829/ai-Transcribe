/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#3B82F6', // Blue 500
          light: '#60A5FA',   // Blue 400
          dark: '#2563EB',    // Blue 600
        },
        accent: {
          DEFAULT: '#F97316', // Orange 500
          light: '#FB923C',   // Orange 400
        },
        background: {
          DEFAULT: '#F8FAFC', // Slate 50
          card: '#FFFFFF',
          soft: '#F1F5F9',    // Slate 100
        },
        text: {
          DEFAULT: '#1E293B', // Slate 800
          muted: '#64748B',   // Slate 500
          light: '#94A3B8',   // Slate 400
        },
        border: {
          DEFAULT: '#E2E8F0', // Slate 200
          soft: '#F1F5F9',    // Slate 100
        }
      },
      fontFamily: {
        heading: ['Outfit', 'sans-serif'],
        body: ['Work Sans', 'sans-serif'],
      },
      boxShadow: {
        'soft': '0 4px 20px -2px rgba(0, 0, 0, 0.05)',
        'soft-xl': '0 10px 40px -4px rgba(0, 0, 0, 0.08)',
        'inner-soft': 'inset 0 2px 4px 0 rgba(0, 0, 0, 0.05)',
      },
      borderRadius: {
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
      }
    },
  },
  plugins: [],
}
