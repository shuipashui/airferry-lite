/* AirFerry Lite IndexedDB persistence. */
(function (root) {
  const DB_NAME = "airferry-lite";
  const DB_VERSION = 1;
  let dbPromise = null;

  function request(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
    });
  }

  function open() {
    if (!("indexedDB" in root)) return Promise.reject(new Error("IndexedDB unavailable"));
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const pending = root.indexedDB.open(DB_NAME, DB_VERSION);
      pending.onupgradeneeded = () => {
        const db = pending.result;
        if (!db.objectStoreNames.contains("sessions")) db.createObjectStore("sessions", { keyPath: "session" });
        if (!db.objectStoreNames.contains("chunks")) {
          const chunks = db.createObjectStore("chunks", { keyPath: ["session", "index"] });
          chunks.createIndex("session", "session");
        }
        if (!db.objectStoreNames.contains("repairs")) {
          const repairs = db.createObjectStore("repairs", { keyPath: ["session", "groupStart", "seed"] });
          repairs.createIndex("session", "session");
        }
      };
      pending.onsuccess = () => resolve(pending.result);
      pending.onerror = () => { dbPromise = null; reject(pending.error || new Error("IndexedDB open failed")); };
    });
    return dbPromise;
  }

  async function put(storeName, value) {
    const db = await open();
    const tx = db.transaction(storeName, "readwrite");
    tx.objectStore(storeName).put(value);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }

  function bytesBuffer(bytes) {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return view.slice().buffer;
  }

  async function putSession(meta, headerText) {
    await put("sessions", { session: meta.session, meta: { ...meta, bytes: undefined, coefficients: undefined }, headerText, updatedAt: Date.now() });
  }

  async function putChunk(session, index, bytes, recovered) {
    await put("chunks", { session, index, bytes: bytesBuffer(bytes), recovered: !!recovered, updatedAt: Date.now() });
  }

  async function putChunks(records) {
    if (!records.length) return;
    const db = await open();
    const tx = db.transaction("chunks", "readwrite");
    const store = tx.objectStore("chunks");
    const updatedAt = Date.now();
    for (const record of records) {
      store.put({
        session: record.session, index: record.index, bytes: bytesBuffer(record.bytes),
        recovered: !!record.recovered, updatedAt
      });
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }

  async function putRepair(session, frame) {
    await put("repairs", {
      session, groupStart: frame.groupStart, seed: frame.seed || 0, count: frame.count, total: frame.total,
      parityCrc: frame.parityCrc, bytes: bytesBuffer(frame.bytes),
      coefficients: frame.coefficients ? bytesBuffer(frame.coefficients) : null, updatedAt: Date.now()
    });
  }

  async function latest() {
    const db = await open();
    const records = await request(db.transaction("sessions", "readonly").objectStore("sessions").getAll());
    return records.sort((a, b) => b.updatedAt - a.updatedAt)[0] || null;
  }

  async function load(session) {
    const db = await open();
    const tx = db.transaction(["sessions", "chunks", "repairs"], "readonly");
    const sessionRecord = await request(tx.objectStore("sessions").get(session));
    const chunks = await request(tx.objectStore("chunks").index("session").getAll(session));
    const repairs = await request(tx.objectStore("repairs").index("session").getAll(session));
    return { session: sessionRecord, chunks, repairs };
  }

  function deleteBySession(store, session) {
    return new Promise((resolve, reject) => {
      const cursor = store.index("session").openCursor(IDBKeyRange.only(session));
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) { resolve(); return; }
        current.delete();
        current.continue();
      };
      cursor.onerror = () => reject(cursor.error);
    });
  }

  async function remove(session) {
    if (!session) return;
    const db = await open();
    const tx = db.transaction(["sessions", "chunks", "repairs"], "readwrite");
    tx.objectStore("sessions").delete(session);
    await Promise.all([deleteBySession(tx.objectStore("chunks"), session), deleteBySession(tx.objectStore("repairs"), session)]);
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error); });
  }

  root.AirFerryLiteStorage = { putSession, putChunk, putChunks, putRepair, latest, load, remove };
})(typeof globalThis !== "undefined" ? globalThis : self);
