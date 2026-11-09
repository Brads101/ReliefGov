/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        // Institutional navy — primary structural colour (spec: #17365D)
        navy: {
          50: '#EEF2F8',
          100: '#DCE5F0',
          200: '#B9CBE2',
          300: '#8FAACD',
          400: '#5F80B0',
          500: '#3D5F90',
          600: '#2B4874',
          700: '#17365D',
          800: '#162742',
          900: '#0F1D33',
          950: '#0A1424'
        },
        // Government blue — secondary / action colour (spec: #245A81)
        gov: {
          50: '#EEF4F8',
          100: '#D9E7F0',
          200: '#B6D0E1',
          300: '#8CB2CB',
          400: '#5F8FB2',
          500: '#40759B',
          600: '#245A81',
          700: '#1D4A6B',
          800: '#173C57',
          900: '#122F44'
        },
        // Muted teal — supportive accent (spec: #2A7F80)
        teal: {
          50: '#EAF5F5',
          100: '#D2EAEA',
          200: '#A7D5D6',
          300: '#74BABC',
          400: '#4CA4A5',
          500: '#34898A',
          600: '#2A7F80',
          700: '#216667',
          800: '#1A5152',
          900: '#154243'
        },
        // Subtle amber — limited attention / disaster-response accent (spec: #E8A23A)
        alert: {
          50: '#FDF7EC',
          100: '#FAEDD3',
          200: '#F5DCAF',
          300: '#EFC985',
          400: '#EDB758',
          500: '#E8A23A',
          600: '#A06411',
          700: '#7E4C0D'
        },
        danger: {
          50: '#FEF2F2',
          100: '#FEE2E2',
          200: '#FECACA',
          300: '#FCA5A5',
          400: '#F87171',
          500: '#DC2626',
          600: '#B91C1C',
          700: '#991B1B'
        },
        surface: {
          DEFAULT: '#F3F6F9',
          card: '#FFFFFF',
          muted: '#EEF2F6'
        },
        line: {
          DEFAULT: '#E2E8F0',
          strong: '#CBD5E1'
        }
      },
      fontFamily: {
        sans: [
          'ui-sans-serif',
          'system-ui',
          '-apple-system',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif'
        ]
      },
      boxShadow: {
        card: '0 1px 2px rgba(23, 54, 93, 0.06), 0 6px 16px -10px rgba(23, 54, 93, 0.16)',
        pop: '0 8px 24px rgba(23, 54, 93, 0.14)'
      }
    }
  },
  plugins: []
};
