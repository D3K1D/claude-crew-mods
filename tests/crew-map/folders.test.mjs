// The map groups files by folder, sets apart files outside the project, keeps names readable,
// and takes `import … from '../types'` for types/index.d.ts rather than a file called "types".
globalThis.h = (type, props, ...children) => {
  const kids = children.flat(Infinity).filter(c => c != null && c !== false)
  return typeof type === 'function' ? type({ ...(props || {}), children: kids }) : { type, props: { ...(props || {}), children: kids } }
}
globalThis.__store = new Map()
const el = name => props => ({ type: name, props })
const elements = { Box: el('Box'), Text: el('Text'), Button: el('Button'), Client: el('Client'), Svg: el('Svg'), Select: el('Select'), Input: el('Input') }
const { register } = await import('../.build/crew-map.mjs')
const hooks = {}
let now = Date.parse('2026-10-12T10:00:00')
Date.now = () => now
const P = 'C:/work/mods'
const files = {
  [`${P}/crew-map/hooks/register.tsx`]: "import type { Crew } from '../types'\n",
  [`${P}/crew-map/types/index.d.ts`]: '',
}
const $ = {
  command: { register: async () => {} },
  ui: { open: async () => {}, resolve: () => elements, toast: async () => {}, copy: async () => ({ isCopied: true }) },
  clock: { every: () => ({ cancel() {} }), after: (ms, fn) => (setTimeout(fn, 0), { cancel() {} }) },
  fs: { read: async p => files[p] ?? '', exists: async p => p in files || p === `${P}/crew-map/types`, write: async () => {} },
  model: { complete: async () => ({ isAnswered: false }) },
  store: { get: async k => (k === 'intro' ? 'off' : undefined), set: async () => {} },
  session: { cwd: async () => P },
  env: { get: async n => (n === 'OS' ? 'Windows_NT' : undefined) },
  state: { get: async () => ({ value: [] }) },
  process: { run: async () => ({ exitCode: 0, stdout: '', stderr: '' }) },
}
register((ev, m, fn) => { hooks[ev] = fn ?? m; return { catch() {} } }, {})
await hooks['session.start']($, {}, async () => ({}))
// These checks are about the tree map: show it (desks and folder cards are the default).
globalThis.__store.set('crew', { ...globalThis.__store.get('crew'), view: 'map' })
await hooks['turn.start']($, { text: 'tidy up', turnId: 'T' }, async () => ({}))
const touched = [
  'crew-map/hooks/register.tsx', 'README.md', 'LICENSE', 'scripts/install.sh', 'scripts/install.ps1',
  ...Array.from({ length: 14 }, (_, i) => `tests/case-${String(i).padStart(2, '0')}-with-a-long-name.test.mjs`),
].map(f => `${P}/${f}`)
let n = 0
for (const f of [...touched, 'C:/Temp/scratch/frames.mjs', 'C:/Temp/scratch/shot.png']) {
  now += 1000
  await hooks['tool.call']($, { tool: 'Edit', tool_use_id: `c${n++}`, file_path: f, old_string: 'a', new_string: 'b' }, async () => ({ text: 'ok' }))
}
await new Promise(r => setTimeout(r, 30))
const find = (x, pred, out = []) => { if (!x || typeof x !== 'object') return out; if (pred(x)) out.push(x); for (const c of x.props?.children ?? []) find(c, pred, out); return out }
const tree = await hooks['ui.render']($, { surface: 'desktop', props: { bodyColumns: 150 }, viewport: { columns: 150 } })
const svg = find(tree, x => x.type === 'Svg')[0].props.source
let fails = 0
const check = (label, cond, extra = '') => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'} ${label}${extra ? `  [${extra}]` : ''}`) }
const nodes = globalThis.__store.get('crew').nodes
check('a folder import resolves to its index file, not a ghost "types"', !nodes[`${P}/crew-map/types`] && nodes[`${P}/crew-map/hooks/register.tsx`].imports.includes(`${P}/crew-map/types/index.d.ts`), JSON.stringify(nodes[`${P}/crew-map/hooks/register.tsx`].imports))
check('folders become nodes on the map', ['>project root<', '>scripts<', '>tests<', '>hooks<'].every(t => svg.includes(t)), ['project root', 'scripts', 'tests', 'hooks'].filter(t => !svg.includes(`>${t}<`)).join(','))
check('a nested folder names the folders above it', svg.includes('▾ 2 · in crew-map'))
check('files outside the project get their own group', svg.includes('>outside project<') && svg.includes('>frames.mjs<'))
check('files under a folder show their own name', svg.includes('>install.sh<') && svg.includes('>register.tsx<') && !svg.includes('>scripts/install.sh<'))
check('long names keep their start and their end (with the extension)', /<text[^>]*>case-00[^<…]*…[^<]*\.mjs</.test(svg), svg.match(/>case-00[^<]*</)?.[0])
// 14 files in one folder wrap into rows rather than one row wider than the map.
const ys = [...svg.matchAll(/translate\(([\d.]+),([\d.]+)\)"><g[^>]*>(?:<rect[^>]*\/>)*<path d="M0 0H28/g)].map(m => Number(m[2]))
check('a big folder wraps into several rows', new Set(ys).size >= 3, [...new Set(ys)].sort((a, b) => a - b).join(','))
const width = Number(svg.match(/<rect width="([\d.]+)" height="[\d.]+" rx="10"/)[1])
check('the map stays within its width', width <= (150 - 1) * 7.9 + 1, String(width))
check('the legend is not drawn into the map (the window draws it, the same size at any zoom)', svg.split('not opened').length <= 2 && (!svg.includes('not opened') || svg.indexOf('not opened') > svg.lastIndexOf(' scale(')))
console.log(`\n${fails} failing check(s)`)
