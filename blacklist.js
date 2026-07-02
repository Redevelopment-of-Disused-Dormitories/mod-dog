/* mod dog — blacklist.js
   Cross-platform blacklist federation.
   One ban on Twitch → sync to YouTube within 1 second. */

import * as db from './db.js';

const listeners = new Set();
let blacklist = [];
let syncEnabled = true;

export function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit() {
  for (const fn of listeners) fn({ blacklist: [...blacklist], syncEnabled });
}

export async function load() {
  blacklist = await db.getAll(db.STORES.BLACKLIST);
  emit();
}

export function setSyncEnabled(val) {
  syncEnabled = val;
  emit();
}

export function isSyncEnabled() { return syncEnabled; }

export async function banUser(platform, userId, username, reason = '') {
  const entry = {
    platform,
    userId,
    username,
    reason,
    bannedAt: Date.now(),
  };

  const id = await db.add(db.STORES.BLACKLIST, entry);
  entry.id = id;
  blacklist.push(entry);

  await db.audit('BLACKLIST_BAN', userId, `platform=${platform} reason=${reason}`);

  if (syncEnabled) {
    await syncBan(entry);
  }

  emit();
  return entry;
}

export async function unbanUser(platform, userId) {
  const entry = blacklist.find((b) => b.platform === platform && b.userId === userId);
  if (!entry) return;

  await db.remove(db.STORES.BLACKLIST, entry.id);
  blacklist = blacklist.filter((b) => b.id !== entry.id);

  await db.audit('BLACKLIST_UNBAN', userId, `platform=${platform}`);

  if (syncEnabled) {
    await syncUnban(platform, userId);
  }

  emit();
}

export function isBanned(platform, userId) {
  return blacklist.some((b) => b.platform === platform && b.userId === userId);
}

export function isBannedAny(userId) {
  return blacklist.some((b) => b.userId === userId);
}

export async function syncBan(entry) {
  const otherPlatforms = ['twitch', 'youtube'].filter((p) => p !== entry.platform);

  for (const targetPlatform of otherPlatforms) {
    if (isBanned(targetPlatform, entry.userId)) continue;

    const syncEntry = {
      ...entry,
      platform: targetPlatform,
      syncedFrom: entry.platform,
      syncedAt: Date.now(),
    };

    const id = await db.add(db.STORES.BLACKLIST, syncEntry);
    syncEntry.id = id;
    blacklist.push(syncEntry);

    await db.audit('BLACKLIST_SYNC', entry.userId, `from=${entry.platform} to=${targetPlatform}`);
  }
}

async function syncUnban(platform, userId) {
  const otherPlatforms = ['twitch', 'youtube'].filter((p) => p !== platform);

  for (const targetPlatform of otherPlatforms) {
    const entry = blacklist.find(
      (b) => b.platform === targetPlatform && b.userId === userId
    );
    if (entry) {
      await db.remove(db.STORES.BLACKLIST, entry.id);
      blacklist = blacklist.filter((b) => b.id !== entry.id);
      await db.audit('BLACKLIST_UNSYNC', userId, `from=${platform} to=${targetPlatform}`);
    }
  }
}

export async function batchBan(entries, modId) {
  const results = [];
  for (const entry of entries) {
    const result = await banUser(entry.platform, entry.userId, entry.username, entry.reason);
    results.push(result);
  }
  await db.audit('BLACKLIST_BATCH_BAN', modId, `count=${results.length}`);
  return results;
}

export function getAll() {
  return [...blacklist];
}

export function getByPlatform(platform) {
  return blacklist.filter((b) => b.platform === platform);
}

export function getStats() {
  const twitchCount = blacklist.filter((b) => b.platform === 'twitch').length;
  const youtubeCount = blacklist.filter((b) => b.platform === 'youtube').length;
  return { total: blacklist.length, twitch: twitchCount, youtube: youtubeCount };
}
