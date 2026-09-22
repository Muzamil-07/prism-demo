import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Builds a single self-contained IIFE bundle (dist/prysmal-prism.js) with React,
// three, and drei bundled inside. The only external runtime it touches is the
// theme's global window.gsap / window.ScrollTrigger, which it reads (never
// bundles) so it can drive scroll animations without replacing the theme copy.
export default defineConfig({
  plugins: [react()],
  define: {
    process: JSON.stringify({ env: { NODE_ENV: 'production' } }),
  },
  // Use an inline (empty) PostCSS config so Vite does NOT search parent folders.
  // Without this it walks up and finds the Next.js app's postcss.config.mjs,
  // which requires @tailwindcss/postcss — a plugin this widget neither has nor needs.
  css: {
    postcss: {},
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    lib: {
      entry: resolve(__dirname, 'src/main.jsx'),
      name: 'PrysmalPrism',
      formats: ['iife'],
      fileName: () => 'prysmal-prism.js',
    },
    rollupOptions: {
      output: {
        // Emit the stylesheet as prysmal-prism.css (Vite's lib mode would
        // otherwise name it style.css) so it matches the enqueued handle.
        assetFileNames: (assetInfo) => (assetInfo.name?.endsWith('.css') ? 'prysmal-prism.css' : '[name][extname]'),
      },
    },
  },
})
