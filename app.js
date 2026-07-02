/* mod dog — app.js
   Main orchestrator. Ties all modules into the Livio-style dashboard UI. */

import * as db from './db.js';
import * as patterns from './patterns.js';
import * as risk from './risk.js';
import * as mutex from './mutex.js';
import * as blacklist from './blacklist.js';
import * as twitch from './twitch.js';
import * as demo from './demo.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

let chatCountNum = 0;
let msgRateCounter = 0;
let lastRateCheck = Date.now();
let demoUnsub = null;
let twitchMsgUnsub = null;
let killSwitchActive = false;

// ── Init ──
async function init() {
  await db.open();
  risk.loadWhitelist();
  blacklist.load();
  mutex.initLocal();
  setupSidebar();
  setupKillOverlay();
  setupUI();
  setupTwitch();
  startMsgRateCounter();
  updateStats();

  // Restore saved token
  const savedToken = await db.getSetting('twitch_token');
  const savedChannel = await db.getSetting('twitch_channel');
  if (savedToken && savedChannel) {
    $('#twitchToken').value = savedToken;
    $('#twitchChannel').value = savedChannel;
  }
}

// ── Sidebar Navigation ──
function setupSidebar() {
  const panelMap = {
    dashboard: { el: 'panelDashboard', title: '控制台' },
    risk: { el: 'panelRisk', title: '風險攔截牆' },
    chat: { el: 'panelChat', title: '聊天串流' },
    blacklist: { el: 'panelBlacklist', title: '跨平台黑名單' },
    whitelist: { el: 'panelWhitelist', title: '白名單管理' },
    mods: { el: 'panelMods', title: '房管協作' },
    api: { el: 'panelApi', title: 'API 授權' },
    settings: { el: 'panelSettings', title: '頻道設定' },
  };

  document.querySelectorAll('.sidebar-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const key = item.dataset.panel;
      if (!key || !panelMap[key]) return;

      document.querySelectorAll('.sidebar-item').forEach((s) => s.classList.remove('active'));
      item.classList.add('active');

      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      const target = document.getElementById(panelMap[key].el);
      if (target) target.classList.add('active');
      $('#pageTitle').textContent = panelMap[key].title;
    });
  });
}

// ── Kill Switch Overlay ──
function setupKillOverlay() {
  $('#btnDeactivateKill').addEventListener('click', deactivateKillSwitch);
}

// ── Main UI Setup ──
function setupUI() {
  // Demo
  $('#btnDemoMode').addEventListener('click', toggleDemoMode);

  // Kill switch
  $('#btnKillSwitch').addEventListener('click', activateKillSwitch);

  // Quick actions
  $('#btnQuickBan').addEventListener('click', () => {
    risk.clearRisks();
    toast('已執行批次封鎖');
    addAuditEntry('BATCH_BAN', '透過快速操作');
  });
  $('#btnQuickClear').addEventListener('click', () => {
    risk.clearRisks();
    toast('風險攔截牆已清除');
  });
  $('#btnQuickSlow').addEventListener('click', () => {
    $('#slowModeSlider').value = 30;
    $('#slowModeValue').textContent = '30 秒';
    toast('慢速模式已設為 30 秒');
    addAuditEntry('SLOW_MODE', '30s');
  });
  $('#btnQuickSubOnly').addEventListener('click', () => {
    const cb = $('#btnSubOnly');
    cb.checked = !cb.checked;
    toast(cb.checked ? '訂閱者模式已啟用' : '訂閱者模式已關閉');
    addAuditEntry('SUB_ONLY', cb.checked ? 'ON' : 'OFF');
  });

  // Risk wall
  $('#btnClearRisks').addEventListener('click', () => {
    risk.clearRisks();
    toast('風險已清除');
  });
  $('#btnBatchBan').addEventListener('click', handleBatchBan);

  // Chat filter
  $('#chatFilter').addEventListener('input', handleChatFilter);

  // Slow mode
  $('#slowModeSlider').addEventListener('input', (e) => {
    const val = parseInt(e.target.value);
    $('#slowModeValue').textContent = `${val} 秒`;
  });

  // Whitelist
  $('#btnAddWhitelist').addEventListener('click', handleAddWhitelist);

  // Cross-platform sync
  $('#crossPlatformSync').addEventListener('change', (e) => {
    blacklist.setSyncEnabled(e.target.checked);
    addAuditEntry('CROSS_SYNC', e.target.checked ? 'ON' : 'OFF');
  });

  // Risk listener
  risk.onUpdate(({ riskItems, spamGroups, piiCount, groupedCount }) => {
    renderRiskWall(riskItems, spamGroups);
    const active = riskItems.filter((r) => !r.handled).length;
    $('#statRisk').textContent = active;
    $('#riskCount').textContent = `風險: ${active}`;
    $('#piiBlocked').textContent = `PII 擋下: ${piiCount}`;
    $('#spamGrouped').textContent = `群組化: ${groupedCount}`;
    $('#statPii').textContent = piiCount;
    $('#statSpam').textContent = groupedCount;
  });

  // Blacklist listener
  blacklist.onUpdate(({ blacklist: bl }) => {
    renderBlacklistTags(bl);
    $('#statBlacklist').textContent = bl.length;
  });

  // Mutex listener
  mutex.onUpdate(({ peers }) => {
    renderMutexStatus(peers);
    const count = peers.size + 1;
    $('#modCount').textContent = `房管: ${count}`;
    $('#statMods').textContent = count;
  });

  // Save config button
  $('#btnSaveConfig').addEventListener('click', async () => {
    const clientId = $('#cfgClientId').value.trim();
    const secret = $('#cfgClientSecret').value.trim();
    if (clientId) await db.setSetting('twitch_client_id', clientId);
    if (secret) await db.setSetting('twitch_client_secret', secret);
    $('#cfgStatus').textContent = '已儲存';
    setTimeout(() => { $('#cfgStatus').textContent = ''; }, 2000);
    toast('憑證已儲存至本地');
  });
}

// ── Twitch IRC Connection ──
function setupTwitch() {
  // Connect button
  $('#btnTwitchConnect').addEventListener('click', async () => {
    const channel = $('#twitchChannel').value.trim();
    let token = $('#twitchToken').value.trim();

    if (!channel) {
      toast('請輸入頻道名稱', 'error');
      return;
    }
    if (!token) {
      toast('請輸入 OAuth Token', 'error');
      return;
    }

    // Normalize token
    if (!token.startsWith('oauth:')) token = 'oauth:' + token;

    $('#twitchStatus').textContent = '連線中...';
    $('#btnTwitchConnect').disabled = true;

    try {
      await twitch.connect(channel, token, '');
      await db.setSetting('twitch_token', token);
      await db.setSetting('twitch_channel', channel);

      $('#twitchBadge').textContent = '已連線';
      $('#twitchBadge').classList.add('connected');
      $('#twitchStatus').innerHTML = `已連線至 <strong>#${channel}</strong> 的聊天室`;
      $('#btnTwitchConnect').style.display = 'none';
      $('#btnTwitchDisconnect').style.display = '';
      $('#sidebarStatus').textContent = `Twitch: #${channel}`;
      $('.sidebar-stat-dot').classList.add('online');

      addAuditEntry('TWITCH_CONNECT', `#${channel}`);
      toast(`已連線至 #${channel}`);

      // Switch to chat panel
      document.querySelectorAll('.sidebar-item').forEach((s) => s.classList.remove('active'));
      document.querySelector('[data-panel="chat"]').classList.add('active');
      document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
      $('#panelChat').classList.add('active');
      $('#pageTitle').textContent = '聊天串流';
    } catch (err) {
      $('#twitchStatus').textContent = '連線失敗: ' + err.message;
      toast('Twitch 連線失敗', 'error');
    }

    $('#btnTwitchConnect').disabled = false;
  });

  // Disconnect button
  $('#btnTwitchDisconnect').addEventListener('click', () => {
    twitch.disconnect();
    $('#twitchBadge').textContent = '未連線';
    $('#twitchBadge').classList.remove('connected');
    $('#twitchStatus').textContent = '';
    $('#btnTwitchConnect').style.display = '';
    $('#btnTwitchDisconnect').style.display = 'none';
    $('#sidebarStatus').textContent = '未連線';
    $('.sidebar-stat-dot').classList.remove('online');
    addAuditEntry('TWITCH_DISCONNECT', '');
    toast('Twitch 已斷線');
  });

  // Listen for Twitch messages
  twitch.onUpdate((data) => {
    if (data.type === 'message') {
      handleTwitchMessage(data.message);
    } else if (data.type === 'connected') {
      addAuditEntry('TWITCH_CONNECTED', data.channel);
    } else if (data.type === 'disconnected') {
      addAuditEntry('TWITCH_DISCONNECTED', '');
    }
  });
}

async function handleTwitchMessage(msg) {
  chatCountNum++;
  msgRateCounter++;

  appendChatMessage(msg);

  // Process through risk engine
  const riskResult = await risk.processMessage(msg);
  if (riskResult && riskResult.risk.type === 'pii') {
    appendBlockedMessage(msg, riskResult.maskedText);
  }
}

// ── Demo Mode ──
function toggleDemoMode() {
  if (demo.isRunning()) {
    demo.stop();
    if (demoUnsub) { demoUnsub(); demoUnsub = null; }
    $('#btnDemoMode').textContent = '▶ 啟動 Demo';
    $('#btnDemoMode').classList.remove('active');
    toast('Demo 已停止');
  } else {
    demo.start(300);
    demoUnsub = demo.onMessage(handleDemoMessage);
    $('#btnDemoMode').textContent = '■ 停止 Demo';
    $('#btnDemoMode').classList.add('active');
    toast('Demo 已啟動 — 模擬聊天流量中');
  }
}

async function handleDemoMessage(msg) {
  chatCountNum++;
  msgRateCounter++;
  appendChatMessage(msg);

  const riskResult = await risk.processMessage(msg);
  if (riskResult && riskResult.risk.type === 'pii') {
    appendBlockedMessage(msg, riskResult.maskedText);
  }
}

// ── Chat Rendering ──
function appendChatMessage(msg) {
  const el = document.createElement('div');
  el.className = 'chat-msg';
  el.dataset.userId = msg.userId;
  el.dataset.text = msg.text;

  const time = new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
  let badgeHtml = '';
  if (msg.badge === 'MOD') badgeHtml = '<span class="badge" style="background:#ecfdf5;color:#10b981">MOD</span>';
  else if (msg.badge === 'SUB') badgeHtml = '<span class="badge" style="background:#eff6ff;color:#2563eb">SUB</span>';
  else if (msg.badge === '主播') badgeHtml = '<span class="badge" style="background:#fef2f2;color:#ef4444">主播</span>';
  else if (msg.badge === 'VIP') badgeHtml = '<span class="badge" style="background:#fffbeb;color:#f59e0b">VIP</span>';
  else if (msg.badge === 'NEW') badgeHtml = '<span class="badge" style="background:#fef2f2;color:#ef4444">NEW</span>';

  const nameColor = msg.color || 'var(--accent)';

  el.innerHTML = `
    <span class="chat-time">${time}</span>
    ${badgeHtml}
    <span class="chat-user" style="color:${nameColor}">${esc(msg.username)}</span>
    <span class="chat-text">${esc(msg.text)}</span>
  `;

  $('#chatMessages').appendChild(el);

  if ($('#autoScroll').checked) {
    $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
  }

  while ($('#chatMessages').children.length > 500) {
    $('#chatMessages').removeChild($('#chatMessages').firstChild);
  }
}

function appendBlockedMessage(msg, maskedText) {
  const el = document.createElement('div');
  el.className = 'chat-msg blocked';
  const time = new Date(msg.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
  el.innerHTML = `
    <span class="chat-time">${time}</span>
    <span class="chat-user">${esc(msg.username)}</span>
    <span class="chat-text">[已攔截: PII 偵測] ${esc(maskedText)}</span>
  `;
  $('#chatMessages').appendChild(el);
  if ($('#autoScroll').checked) $('#chatMessages').scrollTop = $('#chatMessages').scrollHeight;
}

function handleChatFilter(e) {
  const filter = e.target.value.toLowerCase();
  $$('.chat-msg').forEach((el) => {
    if (!filter) { el.style.display = ''; return; }
    const text = (el.dataset.text || el.textContent).toLowerCase();
    el.style.display = text.includes(filter) ? '' : 'none';
  });
}

// ── Risk Wall ──
function renderRiskWall(items, spamGroups) {
  const list = $('#riskList');
  list.innerHTML = '';

  for (const [, group] of spamGroups) {
    const groupEl = document.createElement('div');
    groupEl.className = 'spam-group';
    groupEl.innerHTML = `
      <div class="spam-group-header">
        <span>洗板群組 ×${group.messages.length}</span>
        <button class="btn btn-warn btn-sm" data-group="${group.id}">批次封鎖</button>
      </div>
    `;
    groupEl.querySelector('button').addEventListener('click', () => handleGroupBan(group.id));
    for (const item of group.messages) groupEl.appendChild(createRiskEl(item));
    list.appendChild(groupEl);
  }

  for (const item of items) {
    if (!item.spamGroupId || !spamGroups.has(item.spamGroupId)) {
      list.appendChild(createRiskEl(item));
    }
  }
}

function createRiskEl(item) {
  const el = document.createElement('div');
  el.className = 'risk-item';
  if (item.handled) el.style.opacity = '0.35';

  const time = new Date(item.timestamp).toLocaleTimeString('zh-TW', { hour12: false });
  const typeMap = { pii: 'pii', spam: 'spam', flood: 'flood' };
  const typeLabel = { pii: 'PII', spam: 'SPAM', flood: '洗板' };
  const displayText = item.maskedText || item.text;

  el.innerHTML = `
    <div class="risk-header">
      <span class="risk-user">${esc(item.username)}</span>
      <span class="risk-type ${typeMap[item.risk.type] || 'spam'}">${typeLabel[item.risk.type] || item.risk.type.toUpperCase()}</span>
    </div>
    <div class="risk-msg">${esc(displayText)}</div>
    <div class="risk-time">${time} — ${item.risk.hits.map((h) => h.label).join(', ')}</div>
    ${!item.handled ? `
    <div class="risk-actions">
      <button class="btn btn-danger btn-sm" data-action="ban" data-id="${item.id}">封鎖</button>
      <button class="btn btn-ghost btn-sm" data-action="timeout" data-id="${item.id}">暫時禁言</button>
      <button class="btn btn-ghost btn-sm" data-action="dismiss" data-id="${item.id}">忽略</button>
    </div>` : `<div style="font-size:11px;color:var(--text-dim);margin-top:4px">已處理: ${item.handledAction}</div>`}
  `;

  el.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('click', () => handleRiskAction(btn.dataset.id, btn.dataset.action));
  });

  return el;
}

function handleRiskAction(riskId, action) {
  const modId = mutex.getLocalModId();
  if (action === 'ban') {
    risk.handleRisk(riskId, 'ban', modId);
    toast('使用者已封鎖');
    addAuditEntry('BAN', `risk=${riskId}`);
  } else if (action === 'timeout') {
    risk.handleRisk(riskId, 'timeout', modId);
    toast('使用者已暫時禁言');
    addAuditEntry('TIMEOUT', `risk=${riskId}`);
  } else {
    risk.handleRisk(riskId, 'dismiss', modId);
  }
}

function handleGroupBan(groupId) {
  const modId = mutex.getLocalModId();
  const userIds = risk.batchBanRiskGroup(groupId, modId);
  if (userIds) {
    toast(`${userIds.length} 位使用者已從洗板群組封鎖`);
    addAuditEntry('BATCH_BAN', `group=${groupId}`);
  }
}

function handleBatchBan() {
  const s = risk.getStats();
  if (s.riskCount === 0) { toast('無可封鎖的風險項目'); return; }
  risk.clearRisks();
  toast(`已批次封鎖 ${s.riskCount} 項風險`);
  addAuditEntry('BATCH_BAN', `${s.riskCount} items`);
}

// ── Whitelist ──
async function handleAddWhitelist() {
  const pattern = $('#whitelistUrl').value.trim();
  const duration = parseInt($('#whitelistDuration').value) || 0;
  if (!pattern) return;
  await risk.addToWhitelist(pattern, duration);
  renderWhitelistTags();
  $('#whitelistUrl').value = '';
  $('#whitelistDuration').value = '';
  addAuditEntry('WHITELIST_ADD', pattern);
  toast(`已新增白名單: ${pattern}`);
}

function renderWhitelistTags() {
  const wl = risk.getWhitelist();
  const container = $('#whitelistTags');
  container.innerHTML = '';
  for (const entry of wl) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    tag.innerHTML = `${esc(entry.pattern)} <span class="remove-tag" data-id="${entry.id}">×</span>`;
    tag.querySelector('.remove-tag').addEventListener('click', () => {
      risk.removeFromWhitelist(entry.id);
      renderWhitelistTags();
    });
    container.appendChild(tag);
  }
}

// ── Blacklist Tags ──
function renderBlacklistTags(list) {
  const container = $('#blacklistTags');
  container.innerHTML = '';
  for (const entry of list) {
    const tag = document.createElement('span');
    tag.className = 'tag';
    const color = entry.platform === 'twitch' ? '#9146ff' : '#ff0000';
    tag.innerHTML = `<span style="color:${color};font-weight:600">${entry.platform.toUpperCase()}</span> ${esc(entry.username)}`;
    container.appendChild(tag);
  }
}

// ── Mutex Status ──
function renderMutexStatus(peers) {
  const grid = $('#mutexStatus');
  grid.innerHTML = '';
  const local = document.createElement('div');
  local.className = 'mod-entry';
  local.innerHTML = '<span class="mod-dot"></span> 本機 (你)';
  grid.appendChild(local);

  for (const [modId] of peers) {
    const entry = document.createElement('div');
    entry.className = 'mod-entry';
    entry.innerHTML = `<span class="mod-dot"></span> ${modId.slice(0, 16)}`;
    grid.appendChild(entry);
  }
}

// ── Kill Switch ──
function activateKillSwitch() {
  killSwitchActive = true;
  document.body.classList.add('kill-active');
  $('#killOverlay').classList.add('active');
  $('#btnKillSwitch').classList.add('active');
  addAuditEntry('KILL_SWITCH', '已啟動');
  toast('緊急斷路器已啟動', 'error');
}

function deactivateKillSwitch() {
  killSwitchActive = false;
  document.body.classList.remove('kill-active');
  $('#killOverlay').classList.remove('active');
  $('#btnKillSwitch').classList.remove('active');
  addAuditEntry('KILL_SWITCH', '已解除');
  toast('斷路器已解除');
}

// ── Audit Log ──
function addAuditEntry(action, details = '') {
  const time = new Date().toLocaleTimeString('zh-TW', { hour12: false });
  const log = $('#auditLog');
  const el = document.createElement('div');
  el.className = 'audit-entry';
  el.innerHTML = `<span class="audit-time">${time}</span><span class="audit-action">${action}</span> ${esc(details)}`;
  log.prepend(el);
  while (log.children.length > 80) log.removeChild(log.lastChild);
}

// ── Stats ──
function startMsgRateCounter() {
  setInterval(() => {
    const now = Date.now();
    const elapsed = (now - lastRateCheck) / 1000;
    const rate = Math.round(msgRateCounter / elapsed);
    $('#msgRate').textContent = `${rate} msg/s`;
    $('#statMsgRate').textContent = rate;
    msgRateCounter = 0;
    lastRateCheck = now;
  }, 1000);
}

async function updateStats() {
  try {
    const count = await db.count(db.STORES.AUDIT_LOG);
  } catch {}
}

// ── Helpers ──
function esc(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

function toast(msg, type = '') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  $('#toastContainer').appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── Boot ──
document.addEventListener('DOMContentLoaded', init);
