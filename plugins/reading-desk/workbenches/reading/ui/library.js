// IndexedDB transactions keep reading positions separate from the (larger) book texts.
// Each installed workbench has a different URL prefix, including its Project and Agent.
const scope = new URL("../", location.href).pathname;
const connection = new Promise((resolve, reject) => {
  const req = indexedDB.open("penguin-reading-desk:" + scope, 1);
  req.onupgradeneeded = () => {
    for (const name of ["books", "positions", "notes", "settings"])
      req.result.createObjectStore(name, { keyPath: "id" });
  };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
async function transaction(store, mode, fn) {
  const db = await connection;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onabort = () => reject(tx.error);
    tx.onerror = () => reject(tx.error);
  });
}
export const all = (store) => transaction(store, "readonly", (s) => s.getAll());
export const get = (store, id) => transaction(store, "readonly", (s) => s.get(id));
export const save = (store, row) => transaction(store, "readwrite", (s) => s.put(row));
export const remove = (store, id) => transaction(store, "readwrite", (s) => s.delete(id));
