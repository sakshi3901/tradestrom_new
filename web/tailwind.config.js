/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx}",
    "./components/**/*.{js,jsx}",
    "./lib/**/*.{js,jsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#0d1b2a",
        sea: "#1b263b",
        mist: "#e0e1dd",
        accent: "#f77f00",
        success: "#2a9d8f",
        danger: "#d62828"
      }
    }
  },
  plugins: []
};
