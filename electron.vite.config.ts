import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'
import { vditorAssets } from './tools/vditor-assets'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'dist-electron', rollupOptions: { input: resolve('electron/main.ts') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'dist-electron',
      emptyOutDir: false,
      rollupOptions: {
        input: resolve('electron/preload.ts'),
        output: { format: 'cjs', entryFileNames: 'preload.cjs' },
      },
    },
  },
  renderer: {
    root: 'src/renderer',
    resolve: { alias: { '@': resolve('src/renderer') } },
    plugins: [react(), tailwindcss(), vditorAssets()],
    build: {
      minify: 'esbuild',
      assetsInlineLimit: 0,
      cssMinify: true,
      outDir: resolve('dist'),
      rollupOptions: {
        input: resolve('src/renderer/index.html'),
        output: {
          manualChunks: {
            react: ['react', 'react-dom/client'],
            markdown: ['react-markdown', 'remark-gfm'],
            math: ['remark-math', 'rehype-katex'],
            syntax: ['rehype-highlight'],
            motion: ['motion/react'],
          },
        },
      },
    },
  },
})
