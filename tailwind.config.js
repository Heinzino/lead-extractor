module.exports = {
  content: [
    './src/**/*.{js,jsx,ts,tsx}', 
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-manrope)', 'ui-sans-serif', 'system-ui'],
      },
      colors: {
        darkBlue: '#09031e',
        offWhite: '#f0ffff',
        whiteIce: '#c4f6fd',
        accentBlue: '#53e8ff',
      },
    },
  },
  plugins: [],
};