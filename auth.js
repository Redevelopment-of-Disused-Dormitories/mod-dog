/* mod dog — auth.js
   OAuth 2.0 授權流。不儲存密碼。所有請求透過官方 redirect 授權。 */

import * as db from './db.js';
import config from './config.js';

const TC = config.twitch;
const TY = config.youtube;

const listeners = new Set();
let twitchAuth = { connected: false, token: null, username: null, channel: null };
let youtubeAuth = { connected: false, token: null, channelId: null };

export function onUpdate(fn) { listeners.add(fn); return () => listeners.delete(fn); }

function emit() {
  for (const fn of listeners) fn({ twitch: { ...twitchAuth }, youtube: { ...youtubeAuth } });
}

export function init() {
  handleOAuthCallback();
  loadSavedTokens();
}

async function loadSavedTokens() {
  const twitchToken = await db.getSetting('twitch_token');
  const youtubeToken = await db.getSetting('youtube_token');
  if (twitchToken) {
    twitchAuth = { connected: true, token: twitchToken, username: '已連線', channel: '已連線' };
  }
  if (youtubeToken) {
    youtubeAuth = { connected: true, token: youtubeToken, channelId: '已連線' };
  }
  emit();
}

function handleOAuthCallback() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get('code');
  const state = params.get('state');
  const error = params.get('error');

  if (error) {
    console.error('OAuth error:', error, params.get('error_description'));
    window.history.replaceState({}, '', window.location.pathname);
    return;
  }

  if (!code) return;

  if (state === 'twitch') exchangeTwitchToken(code);
  else if (state === 'youtube') exchangeYoutubeToken(code);

  window.history.replaceState({}, '', window.location.pathname);
}

async function exchangeTwitchToken(code) {
  if (!TC.clientId || !TC.clientSecret) {
    alert('請先在 config.js 中填入 Twitch clientId 與 clientSecret');
    return;
  }
  try {
    const resp = await fetch('https://id.twitch.tv/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: TC.clientId,
        client_secret: TC.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TC.redirectUri,
      }),
    });
    const data = await resp.json();
    if (data.access_token) {
      twitchAuth = { connected: true, token: data.access_token, username: '已連線', channel: '已連線' };
      await db.setSetting('twitch_token', data.access_token);
      await db.setSetting('twitch_client_id', TC.clientId);
      await db.audit('OAUTH_TWITCH_CONNECT', 'system', 'token_obtained');
      emit();
    } else {
      console.error('Twitch token exchange failed:', data);
      alert('Twitch 授權失敗: ' + (data.message || JSON.stringify(data)));
    }
  } catch (err) {
    console.error('Twitch OAuth error:', err);
    alert('Twitch 連線錯誤: ' + err.message);
  }
}

async function exchangeYoutubeToken(code) {
  if (!TY.clientId || !TY.clientSecret) {
    alert('請先在 config.js 中填入 YouTube clientId 與 clientSecret');
    return;
  }
  try {
    const resp = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: TY.clientId,
        client_secret: TY.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: TY.redirectUri,
      }),
    });
    const data = await resp.json();
    if (data.access_token) {
      youtubeAuth = { connected: true, token: data.access_token, channelId: '已連線' };
      await db.setSetting('youtube_token', data.access_token);
      await db.audit('OAUTH_YOUTUBE_CONNECT', 'system', 'token_obtained');
      emit();
    } else {
      console.error('YouTube token exchange failed:', data);
      alert('YouTube 授權失敗: ' + (data.message || JSON.stringify(data)));
    }
  } catch (err) {
    console.error('YouTube OAuth error:', err);
    alert('YouTube 連線錯誤: ' + err.message);
  }
}

export function connectTwitch() {
  if (!TC.clientId) {
    alert('請先在 config.js 中填入 Twitch clientId');
    return;
  }
  const url = `https://id.twitch.tv/oauth2/authorize?client_id=${TC.clientId}&redirect_uri=${encodeURIComponent(TC.redirectUri)}&response_type=code&scope=${encodeURIComponent(TC.scopes)}&state=twitch`;
  window.location.href = url;
}

export function connectYoutube() {
  if (!TY.clientId) {
    alert('請先在 config.js 中填入 YouTube clientId');
    return;
  }
  const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${TY.clientId}&redirect_uri=${encodeURIComponent(TY.redirectUri)}&response_type=code&scope=${encodeURIComponent(TY.scopes)}&state=youtube&access_type=offline`;
  window.location.href = url;
}

export function disconnectTwitch() {
  twitchAuth = { connected: false, token: null, username: null, channel: null };
  db.setSetting('twitch_token', null);
  db.audit('OAUTH_TWITCH_DISCONNECT', 'system', '');
  emit();
}

export function disconnectYoutube() {
  youtubeAuth = { connected: false, token: null, channelId: null };
  db.setSetting('youtube_token', null);
  db.audit('OAUTH_YOUTUBE_DISCONNECT', 'system', '');
  emit();
}

export function getTwitchAuth() { return { ...twitchAuth }; }
export function getYoutubeAuth() { return { ...youtubeAuth }; }
export function isTwitchConnected() { return twitchAuth.connected; }
export function isYoutubeConnected() { return youtubeAuth.connected; }
