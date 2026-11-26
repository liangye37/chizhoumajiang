import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

const gameDirectories = ['audio', 'avatars', 'effects', 'images', 'img', 'themes', 'tiles']

function describe(path, bytes) {
  return { path, size: bytes.byteLength, revision: createHash('sha256').update(bytes).digest('hex') }
}

function publicAssets(root) {
  const entries = []
  function visit(directory) {
    for (const file of readdirSync(join(root, directory), { withFileTypes: true })) {
      const path = directory + '/' + file.name
      if (file.isDirectory()) visit(path)
      else if (!file.name.startsWith('.') && !/\.(?:md|txt)$/i.test(file.name) && file.name !== 'source.json') {
        entries.push(describe(path, readFileSync(join(root, path))))
      }
    }
  }
  gameDirectories.forEach(visit)
  return entries
}

function inject(html, entries) {
  const json = JSON.stringify(entries.sort((a, b) => a.path.localeCompare(b.path))).replaceAll('<', '\\u003c')
  return html.replace('<!-- game-asset-manifest -->', () =>
    '<script id="game-asset-manifest" type="application/json">' + json + '</script>')
}

/** Tie the list to the HTML release, including lazy chunks, CSS and both game workers. */
export function gameAssetManifest() {
  let publicDir
  let dev = false
  let devEntries
  return {
    name: 'game-asset-manifest',
    enforce: 'post',
    configResolved(config) {
      publicDir = config.publicDir
      dev = config.command === 'serve'
    },
    configureServer(server) {
      server.watcher.on('all', (_event, file) => {
        if (gameDirectories.includes(relative(publicDir, file).split(/[\\/]/)[0])) devEntries = undefined
      })
    },
    transformIndexHtml(html) {
      if (dev && html.includes('<!-- game-asset-manifest -->')) return inject(html, devEntries ??= publicAssets(publicDir))
    },
    generateBundle: {
      order: 'post',
      handler(_options, bundle) {
        const html = bundle['index.html']
        if (!html) return
        const entries = publicAssets(publicDir)
        for (const output of Object.values(bundle)) {
          if (!output.fileName.startsWith('assets/') || output.fileName.endsWith('.map')) continue
          const bytes = Buffer.from(output.type === 'chunk' ? output.code : output.source)
          entries.push(describe(output.fileName, bytes))
        }
        html.source = inject(String(html.source), entries)
      },
    },
  }
}
