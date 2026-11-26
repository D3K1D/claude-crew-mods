// What a release needs to be right: each mod's version the same everywhere it is written, the changelog
// naming it, nothing but Node's own modules at run time, and no development files in a plugin folder.
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const json = p => JSON.parse(readFileSync(join(root, p), 'utf8'))
const check = (what, ok, detail = '') => console.log(`${ok ? 'PASS' : 'FAIL'} ${what}${ok || !detail ? '' : `  [${detail}]`}`)

const market = json('.claude-plugin/marketplace.json')
const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
// Where each mod's code says its version (shown in its pane).
const versionIn = { 'crew-map': 'crew-map/hooks/track.ts', 'codex-bridge': 'codex-bridge/hooks/register.tsx' }
for (const mod of ['crew-map', 'codex-bridge']) {
  const plugin = json(`${mod}/.claude-plugin/plugin.json`).version
  const listed = market.plugins.find(p => p.name === mod)?.version
  const inCode = readFileSync(join(root, versionIn[mod]), 'utf8').match(/^(?:export )?const VERSION = '([^']+)'/m)?.[1]
  check(`${mod}: plugin.json, marketplace.json and the code say the same version`, plugin === listed && plugin === inCode, `${plugin} / ${listed} / ${inCode}`)
  check(`${mod}: the changelog has a section for ${plugin}`, new RegExp(`^## .*\\b${mod === 'crew-map' ? 'Claude Crew' : 'Codex Bridge'} ${plugin.replace(/\./g, '\\.')}\\b`, 'm').test(changelog))
  // A marketplace install copies the whole plugin folder: nothing in it but what the mod needs.
  const top = readdirSync(join(root, mod))
  const extra = top.filter(f => !['.claude-plugin', 'hooks', 'types', 'web', 'README.md', 'tsconfig.json'].includes(f))
  check(`${mod}: its folder holds only what users need`, !extra.length, extra.join(', '))
}
// The mods run on Node's own modules (the website's server) and the engine's: no npm dependency at run time.
const pkg = json('package.json')
check('the repository has no runtime dependencies', !pkg.dependencies || !Object.keys(pkg.dependencies).length, Object.keys(pkg.dependencies ?? {}).join(', '))
const web = readdirSync(join(root, 'crew-map/web')).filter(f => f.endsWith('.mjs'))
const outside = web.flatMap(f => [...readFileSync(join(root, 'crew-map/web', f), 'utf8').matchAll(/^import [^'"]*['"]([^'"]+)['"]/gm)].map(m => m[1]).filter(m => !m.startsWith('node:')).map(m => `${f}: ${m}`))
check("the website's scripts import only Node's own modules", !outside.length, outside.join(', '))
