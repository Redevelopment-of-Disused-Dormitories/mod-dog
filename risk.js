/* mod dog — risk.js
   Risk Interception Wall — group, classify, and escalate threats. */

import { classifyMessage, diceCoefficient, matchesWhitelist } from './patterns.js';
import * as db from './db.js';

const MAX_RISK_ITEMS = 500;
const SIMILARITY_THRESHOLD = 0.75;
const NEW_ACCOUNT_WINDOW_MS = 60_000;

let riskItems = [];
let spamGroups = new Map();
let piiCount = 0;
let groupedCount = 0;
let recentMessages = [];
let whitelist = [];

const listeners = new Set();

export function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit() {
  for (const fn of listeners) fn({ riskItems: [...riskItems], spamGroups: new Map(spamGroups), piiCount, groupedCount });
}

export async function loadWhitelist() {
  whitelist = await db.getAll(db.STORES.WHITELIST);
}

export function getWhitelist() { return [...whitelist]; }

export async function addToWhitelist(pattern, duration = 0) {
  const entry = { pattern, duration, createdAt: Date.now() };
  const id = await db.add(db.STORES.WHITELIST, entry);
  entry.id = id;
  whitelist.push(entry);
  return entry;
}

export async function removeFromWhitelist(id) {
  await db.remove(db.STORES.WHITELIST, id);
  whitelist = whitelist.filter((w) => w.id !== id);
}

export function isWhitelisted(text) {
  return matchesWhitelist(text, whitelist.filter((w) => {
    if (w.duration > 0) {
      return Date.now() - w.createdAt < w.duration * 1000;
    }
    return true;
  }));
}

function addToRecent(text) {
  recentMessages.push({ text, ts: Date.now() });
  if (recentMessages.length > 50) recentMessages.shift();
}

function getRecentTexts(userId) {
  return recentMessages.filter((m) => m.userId === userId).map((m) => ({ text: m.text }));
}

function isDuplicateRisk(item) {
  return riskItems.some((r) => r.userId === item.userId && r.text === item.text);
}

function addToSpamGroup(item) {
  for (const [groupId, group] of spamGroups) {
    if (group.messages.some((m) => diceCoefficient(m.text, item.text) >= SIMILARITY_THRESHOLD)) {
      group.messages.push(item);
      groupedCount++;
      emit();
      return groupId;
    }
  }
  const groupId = `spam_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  spamGroups.set(groupId, {
    id: groupId,
    pattern: item.risk.hits[0]?.label || 'SIMILAR',
    messages: [item],
    createdAt: Date.now(),
  });
  groupedCount++;
  emit();
  return groupId;
}

export async function processMessage(msg) {
  if (isWhitelisted(msg.text)) return null;

  const recentTexts = getRecentTexts(msg.userId);
  const classification = classifyMessage(msg.text, recentTexts);

  addToRecent({ text: msg.text, userId: msg.userId });

  if (classification.level === 'safe') return null;

  const item = {
    id: `risk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId: msg.userId,
    username: msg.username,
    text: msg.text,
    risk: classification,
    timestamp: Date.now(),
    handled: false,
    spamGroupId: null,
  };

  if (isDuplicateRisk(item)) return null;

  if (classification.type === 'pii') {
    piiCount++;
    const masked = maskPII(msg.text, classification.hits);
    item.maskedText = masked;
  }

  if (classification.type === 'spam' || classification.type === 'flood') {
    item.spamGroupId = addToSpamGroup(item);
  }

  riskItems.unshift(item);
  if (riskItems.length > MAX_RISK_ITEMS) riskItems.pop();

  await db.audit('RISK_DETECTED', msg.userId, `${classification.type}: ${classification.hits.map((h) => h.label).join(', ')}`);

  emit();
  return item;
}

function maskPII(text, hits) {
  let masked = text;
  for (const hit of hits) {
    for (const match of hit.matches) {
      const replacement = match[0] + '*'.repeat(Math.max(0, match.length - 2)) + match[match.length - 1];
      masked = masked.replace(match, replacement);
    }
  }
  return masked;
}

export function handleRisk(riskId, action, modId) {
  const item = riskItems.find((r) => r.id === riskId);
  if (!item || item.handled) return;

  item.handled = true;
  item.handledBy = modId;
  item.handledAction = action;
  item.handledAt = Date.now();

  db.audit(`RISK_${action.toUpperCase()}`, modId, `target=${item.userId} type=${item.risk.type}`);
  emit();
}

export function batchBanRiskGroup(groupId, modId) {
  const group = spamGroups.get(groupId);
  if (!group) return;

  const userIds = [...new Set(group.messages.map((m) => m.userId))];
  for (const item of group.messages) {
    item.handled = true;
    item.handledBy = modId;
    item.handledAction = 'batch_ban';
    item.handledAt = Date.now();
  }

  db.audit('RISK_BATCH_BAN', modId, `group=${groupId} users=${userIds.join(',')}`);
  emit();
  return userIds;
}

export function clearRisks() {
  riskItems = [];
  spamGroups.clear();
  piiCount = 0;
  groupedCount = 0;
  emit();
}

export function getStats() {
  return { riskCount: riskItems.length, piiCount, groupedCount, spamGroupCount: spamGroups.size };
}
