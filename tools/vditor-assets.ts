import { readFileSync, readdirSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import type { Plugin } from 'vite'

// Chromium checks the default copy menu's inline handlers as soon as its HTML
// is parsed, before renderMenu can replace it. Make those inert attributes;
// MarkdownEditor supplies accessible buttons with normal event listeners.
function withoutInlineCopyHandlers(code: string) {
  const start = code.indexOf('var codeRender = function')
  const end = code.indexOf('\n};', start) + 3
  if (start < 0 || end < 3) throw new Error('Vditor copy renderer changed; review the CSP adapter.')
  return (
    code.slice(0, start) +
    code.slice(start, end).replace(/on(mouseover|click)=/g, 'data-vditor-$1=') +
    code.slice(end)
  )
}

// Vditor loads its parser, locale and renderers on demand. Serve the same local
// files in development and in file:// Electron builds, without a remote CDN.
export function vditorAssets(): Plugin {
  const files = new Map<string, string>()
  const collect = (directory: string, prefix: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = resolve(directory, entry.name)
      const name = `${prefix}/${entry.name}`
      if (entry.isDirectory()) collect(file, name)
      else files.set(name, file)
    }
  }
  for (const directory of ['js', 'css', 'images'])
    collect(resolve('node_modules/vditor/dist', directory), `vendor/vditor/dist/${directory}`)
  // Share the maintained KaTeX version used by the read-only Markdown renderer.
  collect(resolve('node_modules/katex/dist'), 'vendor/vditor/dist/js/katex')
  files.set(
    'vendor/vditor/dist/js/katex/mhchem.min.js',
    resolve('node_modules/katex/dist/contrib/mhchem.min.js'),
  )
  files.set('vendor/vditor/LICENSE', resolve('node_modules/vditor/LICENSE'))
  files.set('vendor/vditor/dist/js/katex/LICENSE', resolve('node_modules/katex/LICENSE'))
  const mime: Record<string, string> = {
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
  }
  return {
    name: 'local-vditor-assets',
    enforce: 'pre',
    config() {
      return {
        optimizeDeps: {
          esbuildOptions: {
            plugins: [
              {
                name: 'vditor-csp',
                setup(build) {
                  build.onLoad({ filter: /[\\/]vditor[\\/]dist[\\/]index\.js$/ }, (args) => ({
                    contents: withoutInlineCopyHandlers(readFileSync(args.path, 'utf8')),
                    loader: 'js',
                  }))
                },
              },
            ],
          },
        },
      }
    },
    transform(code, id) {
      if (/[\\/]vditor[\\/]dist[\\/]index\.js$/.test(id))
        return { code: withoutInlineCopyHandlers(code), map: null }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const name = new URL(request.url ?? '/', 'http://localhost').pathname.slice(1)
        const file = files.get(name)
        if (!file) return next()
        response.setHeader('Content-Type', mime[extname(file)] ?? 'application/octet-stream')
        response.end(readFileSync(file))
      })
    },
    generateBundle() {
      for (const [fileName, file] of files)
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) })
    },
  }
}
