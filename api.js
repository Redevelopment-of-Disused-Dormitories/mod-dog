/* mod dog — api.js
   Twitch Helix & YouTube Live Chat API integration.
   All requests are direct to official servers. 100% compliant with ToS. */

import * as auth from './auth.js';
import * as db from './db.js';

const TWITCH_API = 'https://api.twitch.tv/helix';
const YOUTUBE_API = 'https://www.googleapis.com/youtube/v3';

async function twitchHeaders() {
  const a = auth.getTwitchAuth();
  return {
    'Authorization': `Bearer ${a.token}`,
    'Client-Id': 'YOUR_TWITCH_CLIENT_ID',
    'Content-Type': 'application/json',
  };
}

async function youtubeHeaders() {
  const a = auth.getYoutubeAuth();
  return {
    'Authorization': `Bearer ${a.token}`,
    'Content-Type': 'application/json',
  };
}

// ── Twitch Helix API ──

export async function twitchBanUser(broadcasterId, userId, reason = '', duration = 0) {
  if (!auth.isTwitchConnected()) return { error: 'not_connected' };
  try {
    const body = { data: { user_id: userId, reason } };
    if (duration > 0) body.data.duration = duration;

    const resp = await fetch(`${TWITCH_API}/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
      method: 'POST',
      headers: await twitchHeaders(),
      body: JSON.stringify(body),
    });
    const data = await resp.json();
    await db.audit('API_TWITCH_BAN', userId, `duration=${duration} reason=${reason}`);
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

export async function twitchUnbanUser(broadcasterId, userId) {
  if (!auth.isTwitchConnected()) return { error: 'not_connected' };
  try {
    const resp = await fetch(`${TWITCH_API}/moderation/bans?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}&user_id=${userId}`, {
      method: 'DELETE',
      headers: await twitchHeaders(),
    });
    await db.audit('API_TWITCH_UNBAN', userId, '');
    return { status: resp.status };
  } catch (err) {
    return { error: err.message };
  }
}

export async function timeoutUser(broadcasterId, userId, duration, reason = '') {
  if (!auth.isTwitchConnected()) return { error: 'not_connected' };
  return twitchBanUser(broadcasterId, userId, reason, duration);
}

export async function updateChatSettings(broadcasterId, settings) {
  if (!auth.isTwitchConnected()) return { error: 'not_connected' };
  try {
    const resp = await fetch(`${TWITCH_API}/chat/settings?broadcaster_id=${broadcasterId}&moderator_id=${broadcasterId}`, {
      method: 'PATCH',
      headers: await twitchHeaders(),
      body: JSON.stringify(settings),
    });
    const data = await resp.json();
    await db.audit('API_TWITCH_CHAT_SETTINGS', 'system', JSON.stringify(settings));
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

export async function setSlowMode(broadcasterId, seconds) {
  return updateChatSettings(broadcasterId, { slow_mode: seconds });
}

export async function setSubOnly(broadcasterId, enabled) {
  return updateChatSettings(broadcasterId, { subscriber_only: enabled });
}

export async function setEmoteOnly(broadcasterId, enabled) {
  return updateChatSettings(broadcasterId, { emote_only: enabled });
}

// ── YouTube Live Chat API ──

export async function youtubeBanUser(broadcastId, userId) {
  if (!auth.isYoutubeConnected()) return { error: 'not_connected' };
  try {
    const resp = await fetch(`${YOUTUBE_API}/liveChat/bans?part=snippet&broadcastId=${broadcastId}`, {
      method: 'POST',
      headers: await youtubeHeaders(),
      body: JSON.stringify({
        snippet: {
          liveChatId: broadcastId,
          bannedUserDetails: { channelId: userId },
        },
      }),
    });
    const data = await resp.json();
    await db.audit('API_YOUTUBE_BAN', userId, '');
    return data;
  } catch (err) {
    return { error: err.message };
  }
}

export async function youtubeUnbanUser(broadcastId, banId) {
  if (!auth.isYoutubeConnected()) return { error: 'not_connected' };
  try {
    const resp = await fetch(`${YOUTUBE_API}/liveChat/bans?id=${banId}`, {
      method: 'DELETE',
      headers: await youtubeHeaders(),
    });
    await db.audit('API_YOUTUBE_UNBAN', banId, '');
    return { status: resp.status };
  } catch (err) {
    return { error: err.message };
  }
}

export async function youtubeDeleteMessage(chatId, messageId) {
  if (!auth.isYoutubeConnected()) return { error: 'not_connected' };
  try {
    const resp = await fetch(`${YOUTUBE_API}/liveChat/messages?id=${messageId}&liveChatId=${chatId}`, {
      method: 'DELETE',
      headers: await youtubeHeaders(),
    });
    await db.audit('API_YOUTUBE_DELETE_MSG', messageId, '');
    return { status: resp.status };
  } catch (err) {
    return { error: err.message };
  }
}

// ── Unified Moderation Actions ──

export async function moderateAction(platform, action, target, options = {}) {
  switch (platform) {
    case 'twitch':
      switch (action) {
        case 'ban': return twitchBanUser(options.broadcasterId, target, options.reason || '', 0);
        case 'timeout': return timeoutUser(options.broadcasterId, target, options.duration || 600, options.reason || '');
        case 'unban': return twitchUnbanUser(options.broadcasterId, target);
        case 'slow_mode': return setSlowMode(options.broadcasterId, options.seconds || 0);
        case 'sub_only': return setSubOnly(options.broadcasterId, options.enabled || false);
        case 'emote_only': return setEmoteOnly(options.broadcasterId, options.enabled || false);
      }
      break;
    case 'youtube':
      switch (action) {
        case 'ban': return youtubeBanUser(options.broadcastId, target);
        case 'unban': return youtubeUnbanUser(options.broadcastId, target);
        case 'delete': return youtubeDeleteMessage(options.broadcastId, target);
      }
      break;
  }
  return { error: 'unknown_platform' };
}
