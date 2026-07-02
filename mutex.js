/* mod dog — mutex.js
   WebSocket-based multi-mod mutex lock system.
   Prevents conflicting actions between moderators in real-time. */

const LOCK_TIMEOUT_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 5_000;

let ws = null;
let localModId = `mod_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
let locks = new Map();
let modPeers = new Map();
let listeners = new Set();

export function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit() {
  for (const fn of listeners) fn({
    locks: new Map(locks),
    peers: new Map(modPeers),
    localModId,
  });
}

export function getLocalModId() { return localModId; }

export function connect(url) {
  try {
    ws = new WebSocket(url);
    ws.onopen = () => {
      broadcast({ type: 'join', modId: localModId, ts: Date.now() });
      startHeartbeat();
      emit();
    };
    ws.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data);
        handleMessage(data);
      } catch {}
    };
    ws.onclose = () => {
      stopHeartbeat();
      emit();
    };
    ws.onerror = () => {};
  } catch {}
}

let heartbeatTimer = null;

function startHeartbeat() {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    broadcast({ type: 'heartbeat', modId: localModId, ts: Date.now() });
    cleanStalePeers();
    emit();
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  heartbeatTimer = null;
}

function cleanStalePeers() {
  const now = Date.now();
  for (const [modId, peer] of modPeers) {
    if (now - peer.lastSeen > LOCK_TIMEOUT_MS) {
      modPeers.delete(modId);
      releaseLocksForMod(modId);
    }
  }
}

function handleMessage(data) {
  switch (data.type) {
    case 'join':
      modPeers.set(data.modId, { lastSeen: Date.now() });
      broadcast({ type: 'heartbeat', modId: localModId, ts: Date.now() });
      break;
    case 'heartbeat':
      modPeers.set(data.modId, { lastSeen: Date.now() });
      break;
    case 'lock_request':
      handleLockRequest(data);
      break;
    case 'lock_granted':
      if (data.targetMod === localModId) {
        locks.set(data.targetId, { modId: data.modId, ts: Date.now() });
      }
      break;
    case 'lock_release':
      locks.delete(data.targetId);
      break;
    case 'leave':
      modPeers.delete(data.modId);
      releaseLocksForMod(data.modId);
      break;
  }
  emit();
}

function handleLockRequest(data) {
  const { targetId, modId: requesterMod } = data;
  if (requesterMod === localModId) return;

  if (!locks.has(targetId)) {
    locks.set(targetId, { modId: requesterMod, ts: Date.now() });
    broadcast({ type: 'lock_granted', targetId, modId: localModId, targetMod: requesterMod });
  }
}

function releaseLocksForMod(modId) {
  for (const [targetId, lock] of locks) {
    if (lock.modId === modId) {
      locks.delete(targetId);
    }
  }
}

export function tryLock(targetId) {
  if (locks.has(targetId)) {
    const lock = locks.get(targetId);
    return { locked: false, heldBy: lock.modId };
  }
  locks.set(targetId, { modId: localModId, ts: Date.now() });
  broadcast({ type: 'lock_request', targetId, modId: localModId });
  return { locked: true, heldBy: localModId };
}

export function releaseLock(targetId) {
  if (locks.has(targetId) && locks.get(targetId).modId === localModId) {
    locks.delete(targetId);
    broadcast({ type: 'lock_release', targetId, modId: localModId });
  }
}

export function isLocked(targetId) {
  return locks.has(targetId);
}

export function getLockHolder(targetId) {
  const lock = locks.get(targetId);
  return lock ? lock.modId : null;
}

export function getActiveMods() {
  return [...modPeers.keys()];
}

export function disconnect() {
  broadcast({ type: 'leave', modId: localModId });
  stopHeartbeat();
  if (ws) {
    ws.close();
    ws = null;
  }
}

function broadcast(data) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// ── Local-only fallback when no WebSocket server ──
export function initLocal() {
  emit();
}
