/* mod dog — db.js
   IndexedDB local-first storage engine. All data stays on device. */

const DB_NAME = 'moddog';
const DB_VERSION = 1;

const STORES = {
  BLACKLIST: 'blacklist',
  AUDIT_LOG: 'audit_log',
  WHITELIST: 'whitelist',
  BANS: 'bans',
  SETTINGS: 'settings',
};

let db = null;

export function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains(STORES.BLACKLIST)) {
        const s = d.createObjectStore(STORES.BLACKLIST, { keyPath: 'id', autoIncrement: true });
        s.createIndex('platform', 'platform', { unique: false });
        s.createIndex('userId', 'userId', { unique: false });
      }
      if (!d.objectStoreNames.contains(STORES.AUDIT_LOG)) {
        const s = d.createObjectStore(STORES.AUDIT_LOG, { keyPath: 'id', autoIncrement: true });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!d.objectStoreNames.contains(STORES.WHITELIST)) {
        d.createObjectStore(STORES.WHITELIST, { keyPath: 'id', autoIncrement: true });
      }
      if (!d.objectStoreNames.contains(STORES.BANS)) {
        const s = d.createObjectStore(STORES.BANS, { keyPath: 'id', autoIncrement: true });
        s.createIndex('userId', 'userId', { unique: false });
        s.createIndex('platform', 'platform', { unique: false });
      }
      if (!d.objectStoreNames.contains(STORES.SETTINGS)) {
        d.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
      }
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = (e) => reject(e.target.error);
  });
}

function tx(storeName, mode = 'readonly') {
  return db.transaction(storeName, mode).objectStore(storeName);
}

function reqPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function add(storeName, data) {
  return reqPromise(tx(storeName, 'readwrite').add(data));
}

export async function put(storeName, data) {
  return reqPromise(tx(storeName, 'readwrite').put(data));
}

export async function get(storeName, key) {
  return reqPromise(tx(storeName).get(key));
}

export async function getAll(storeName) {
  return reqPromise(tx(storeName).getAll());
}

export async function remove(storeName, key) {
  return reqPromise(tx(storeName, 'readwrite').delete(key));
}

export async function clear(storeName) {
  return reqPromise(tx(storeName, 'readwrite').clear());
}

export async function count(storeName) {
  return reqPromise(tx(storeName).count());
}

export async function audit(action, userId, details = '') {
  return add(STORES.AUDIT_LOG, {
    timestamp: Date.now(),
    action,
    userId,
    details,
  });
}

export async function getSetting(key, defaultVal = null) {
  const row = await get(STORES.SETTINGS, key);
  return row ? row.value : defaultVal;
}

export async function setSetting(key, value) {
  return put(STORES.SETTINGS, { key, value });
}
