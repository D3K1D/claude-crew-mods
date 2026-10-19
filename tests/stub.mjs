const store = (globalThis.__store ??= new Map())
export const atom = (ref, init) => ({ ref, init })
export const read = async ($, a) => (store.has(a.ref.key) ? store.get(a.ref.key) : a.init)
export const update = async ($, a, fn) => { store.set(a.ref.key, fn(store.has(a.ref.key) ? store.get(a.ref.key) : a.init)) }
