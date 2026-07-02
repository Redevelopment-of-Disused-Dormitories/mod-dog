/* mod dog — auth.js
   Twitch OAuth Implicit Grant Flow。
   不需要 client_secret，token 直接回傳到 URL hash。
   開發者只需到 dev.twitch.tv 建立應用程式，設定 redirect URI 即可。 */

import * as db from './db.js';

const REDIRECT_URI = window.location.origin + window.location.pathname;

const SCOPES = [
  'chat:read',
  'chat:edit',
  'moderator:manage:banned_users',
  'moderator:manage:chat_settings',
  'channel:moderate',
];

const listeners = new Set();
let twitchAuth = { connected: false, token: null, username: null, channelId: null };

export function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit() {
  for (const fn of listeners) fn({ twitch: { ...twitchAuth } });
}

export function init() {
  handleImplicitCallback();
  loadSaved();
}

async function loadSaved() {
  const token = await db.getSetting('twitch_token');
  const username = await db.getSetting('twitch_username');
  const channelId = await db.getSetting('twitch_channel_id');
  if (token) {
    twitchAuth = { connected: true, token, username: username || '已連線', channelId };
    emit();
  }
}

function handleImplicitCallback() {
  const hash = window.location.hash;
  if (!hash || !hash.includes('access_token')) return;

  const params = new URLSearchParams(hash.substring(1));
  const token = params.get('access_token');

  if (token) {
    twitchAuth = { connected: true, token, username: '已連線', channelId: null };
    db.setSetting('twitch_token', token);
    db.audit('OAUTH_TWITCH_CONNECT', 'system', 'implicit_flow');

    // Fetch user info
    fetchUserInfo(token);

    // Clean URL
    window.history.replaceState({}, '', window.location.pathname);
    emit();
  }
}

async function fetchUserInfo(token) {
  try {
    const resp = await fetch('https://api.twitch.tv/helix/users', {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Client-Id': await db.getSetting('twitch_client_id') || '',
      },
    });
    const data = await resp.json();
    if (data.data && data.data[0]) {
      twitchAuth.username = data.data[0].display_name;
      twitchAuth.channelId = data.data[0].id;
      db.setSetting('twitch_username', data.data[0].display_name);
      db.setSetting('twitch_channel_id', data.data[0].id);
      emit();
    }
  } catch (err) {
    console.error('Failed to fetch user info:', err);
  }
}

export function startAuth(clientId) {
  if (!clientId) {
    alert('請先輸入 Twitch Client ID');
    return;
  }

  db.setSetting('twitch_client_id', clientId);

  const scopeStr = SCOPES.join('+');
  const url = `https://id.twitch.tv/oauth2/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=token&scope=${encodeURIComponent(scopeStr)}&force_verify=true`;
  window.location.href = url;
}

export function disconnect() {
  twitchAuth = { connected: false, token: null, username: null, channelId: null };
  db.setSetting('twitch_token', null);
  db.setSetting('twitch_username', null);
  db.setSetting('twitch_channel_id', null);
  db.audit('OAUTH_TWITCH_DISCONNECT', 'system', '');
  emit();
}

export function getToken() { return twitchAuth.token; }
export function getUsername() { return twitchAuth.username; }
export function getChannelId() { return twitchAuth.channelId; }
export function isConnected() { return twitchAuth.connected; }
export function getAuth() { return { ...twitchAuth }; }
