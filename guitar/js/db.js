// Хранилище песен в IndexedDB
const DB = 'guitar', STORE = 'songs';
let dbp = null;
function open() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode); const st = t.objectStore(STORE); const req = fn(st);
    t.oncomplete = () => res(req?.result); t.onerror = () => rej(t.error);
  });
}
export const SongDb = {
  all: () => tx('readonly', s => s.getAll()).then(a => (a || []).sort((x, y) => (y.savedAt || 0) - (x.savedAt || 0))),
  get: id => tx('readonly', s => s.get(id)),
  put: song => tx('readwrite', s => s.put(song)),
  remove: id => tx('readwrite', s => s.delete(id))
};
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
