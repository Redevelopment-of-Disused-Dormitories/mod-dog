/* mod dog — twitch.js
   Twitch IRC WebSocket 連線。直接連接 Twitch 聊天室，讀取即時訊息。 */

import config from './config.js';
import * as db from './db.js';

const TWITCH_IRC_WSS = 'wss://irc-ws.chat.twitch.tv:443';

let ws = null;
let channel = null;
let connected = false;
let accessToken = null;
let clientId = null;
const listeners = new Set();
const msgBuffer = [];

export function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit(data) {
  for (const fn of listeners) fn(data);
}

export function isConnected() { return connected; }
export function getChannel() { return channel; }
export function getMessageBuffer() { return [...msgBuffer]; }

export async function connect(channelName, token, cid) {
  if (connected) disconnect();

  channel = channelName.toLowerCase().replace(/^#/, '');
  accessToken = token;
  clientId = cid;

  return new Promise((resolve, reject) => {
    ws = new WebSocket(TWITCH_IRC_WSS);

    ws.onopen = () => {
      // Send PASS and NICK
      ws.send(`PASS oauth:${accessToken}`);
      ws.send(`NICK moddog_${channel}`);

      // Request capabilities
      ws.send('CAP REQ :twitch.tv/membership twitch.tv/tags twitch.tv/commands');

      // Join channel
      ws.send(`JOIN #${channel}`);

      connected = true;
      emit({ type: 'connected', channel });
      db.audit('TWITCH_CHAT_CONNECT', 'system', `channel=${channel}`);
      resolve();
    };

    ws.onmessage = (e) => {
      const lines = e.data.split('\r\n');
      for (const line of lines) {
        if (!line) continue;
        handleIRCLine(line);
      }
    };

    ws.onclose = () => {
      connected = false;
      emit({ type: 'disconnected' });
      db.audit('TWITCH_CHAT_DISCONNECT', 'system', `channel=${channel}`);
    };

    ws.onerror = (err) => {
      console.error('Twitch IRC error:', err);
      emit({ type: 'error', message: 'WebSocket 連線錯誤' });
      reject(err);
    };

    // Timeout
    setTimeout(() => {
      if (!connected) {
        reject(new Error('連線逾時'));
      }
    }, 10000);
  });
}

export function disconnect() {
  if (ws) {
    ws.close();
    ws = null;
  }
  connected = false;
  channel = null;
}

function handleIRCLine(line) {
  // PING → PONG
  if (line.startsWith('PING')) {
    ws.send('PONG :twitch');
    return;
  }

  // Parse IRC message
  const parsed = parseIRC(line);
  if (!parsed) return;

  // PRIVMSG — chat message
  if (parsed.command === 'PRIVMSG') {
    const msg = {
      id: `twitch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      userId: parsed.userId || parsed.username,
      username: parsed.displayName || parsed.username,
      text: parsed.message,
      timestamp: Date.now(),
      badges: parsed.badges || [],
      color: parsed.color || '#888',
      emotes: parsed.emotes || [],
      subscriber: parsed.subscriber || false,
      mod: parsed.mod || false,
      badge: null,
    };

    // Determine badge
    if (msg.mod) msg.badge = 'MOD';
    else if (msg.subscriber) msg.badge = 'SUB';
    else if (parsed.badges?.some((b) => b.type === 'broadcaster')) msg.badge = '主播';

    msgBuffer.push(msg);
    if (msgBuffer.length > 1000) msgBuffer.shift();

    emit({ type: 'message', message: msg });
  }

  // Reconnect hints
  if (line.includes(':tmi.twitch.tv RECONNECT')) {
    emit({ type: 'reconnect' });
  }
}

function parseIRC(line) {
  const result = {};
  let remaining = line;

  // Parse tags
  if (remaining.startsWith('@')) {
    const spaceIdx = remaining.indexOf(' ');
    const tagStr = remaining.slice(1, spaceIdx);
    remaining = remaining.slice(spaceIdx + 1);

    const tags = {};
    for (const pair of tagStr.split(';')) {
      const [key, val] = pair.split('=', 2);
      tags[key] = val || '';
    }

    result.userId = tags['user-id'];
    result.displayName = tags['display-name'];
    result.color = tags['color'];
    result.subscriber = tags['subscriber'] === '1';
    result.mod = tags['mod'] === '1';
    result.tmiSentTs = tags['tmi-sent-ts'];

    // Parse badges
    if (tags['badges']) {
      result.badges = tags['badges'].split(',').map((b) => {
        const [type, version] = b.split('/');
        return { type, version };
      });
    }

    // Parse emotes
    if (tags['emotes']) {
      result.emotes = tags['emotes'].split('/').map((e) => {
        const [id, positions] = e.split(':');
        return { id, positions: positions.split(',') };
      });
    }
  }

  // Parse :username!user@user.tmi.twitch.tv COMMAND #channel :message
  const userMatch = remaining.match(/^:([^!]+)!/);
  if (userMatch) result.username = userMatch[1];

  const cmdMatch = remaining.match(/(?:\s|^)([A-Z]+)(?:\s+#(\S+))?(?:\s+:?(.*))?$/);
  if (cmdMatch) {
    result.command = cmdMatch[1];
    result.channel = cmdMatch[2];
    result.message = cmdMatch[3] || '';
  }

  if (!result.command) return null;
  return result;
}

// ── Send chat message (requires OAuth token with chat:edit scope) ──
export function sendMessage(text) {
  if (!connected || !ws) return false;
  ws.send(`PRIVMSG #${channel} :${text}`);
  return true;
}

// ── Ban user via Twitch API (not IRC) ──
export async function banUser(userId, reason = '') {
  if (!accessToken || !clientId || !channel) return { error: 'not_connected' };
  try {
    // First get broadcaster ID
    const chResp = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-Id': clientId },
    });
    const chData = await chResp.json();
    const broadcasterId = chData.data?.[0]?.id;
    if (!broadcasterId) return { error: 'channel_not_found' };

    const resp = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id': clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { user_id: userId, reason } }),
    });
    const data = await resp.json();
    await db.audit('TWITCH_BAN', userId, `channel=${channel} reason=${reason}`);
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

// ── Timeout user ──
export async function timeoutUser(userId, duration = 600, reason = '') {
  if (!accessToken || !clientId || !channel) return { error: 'not_connected' };
  try {
    const chResp = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-Id': clientId },
    });
    const chData = await chResp.json();
    const broadcasterId = chData.data?.[0]?.id;
    if (!broadcasterId) return { error: 'channel_not_found' };

    const resp = await fetch(`https://api.twitch.tv/helix/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id': clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ data: { user_id: userId, duration, reason } }),
    });
    const data = await resp.json();
    await db.audit('TWITCH_TIMEOUT', userId, `duration=${duration} reason=${reason}`);
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

// ── Update chat settings ──
export async function updateChatSettings(settings) {
  if (!accessToken || !clientId || !channel) return { error: 'not_connected' };
  try {
    const chResp = await fetch(`https://api.twitch.tv/helix/users?login=${channel}`, {
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Client-Id': clientId },
    });
    const chData = await chResp.json();
    const broadcasterId = chData.data?.[0]?.id;
    if (!broadcasterId) return { error: 'channel_not_found' };

    const resp = await fetch(`https://api.twitch.tv/helix/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id': clientId,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(settings),
    });
    const data = await resp.json();
    await db.audit('TWITCH_CHAT_SETTINGS', 'system', JSON.stringify(settings));
    return data;
  } catch (err) {
    return { error: err.message };
  }
}
