import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

const shared = {
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
}

// Default `vite build` is a static site (index.html) so Vercel / preview work.
// `npm run build:lib` keeps the WordPress IIFE bundle (dist/prysmal-prism.js).
export default defineConfig(() => {
  if (process.env.BUILD_LIB === '1') {
    return {
      ...shared,
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
            assetFileNames: (assetInfo) =>
              assetInfo.name?.endsWith('.css') ? 'prysmal-prism.css' : '[name][extname]',
          },
        },
      },
    }
  }

  return {
    ...shared,
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  }
})
