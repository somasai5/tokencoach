// src/background.js
// Service Worker — persistent state, daily reset, cross-tab sync

const STORE_KEY  = 'ts_state';
const ALARM_NAME = 'ts_midnight_reset';

const defaultData = () => ({
  daily: { date: todayStr(), msgCount: 0, dailyTokens: 0 },
});

// ── Lifecycle ──────────────────────────────────────────────────────────────
chrome.runtime.onInstalled.addListener(async () => {
  await ensureData();
  scheduleMidnightAlarm();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureData();
  scheduleMidnightAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) resetDaily();
});

// ── Message Handler ────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  const tabId = sender.tab?.id;

  if (msg.action === 'MSG_SENT') {
    handleUpdate({ msgCount: 1, inputTokens: msg.inputTokens || 0, outputTokens: 0 }, tabId)
      .then(() => reply({ ok: true }));
    return true;
  }

  if (msg.action === 'OUTPUT_TOKENS') {
    handleUpdate({ msgCount: 0, inputTokens: 0, outputTokens: msg.outputTokens || 0 }, tabId)
      .then(() => reply({ ok: true }));
    return true;
  }

  if (msg.action === 'GET_STATS') {
    getStats().then(reply);
    return true;
  }

  if (msg.action === 'RESET_DAILY') {
    resetDaily().then(() => reply({ ok: true }));
    return true;
  }
});

// ── Core Logic ────────────────────────────────────────────────────────────
async function handleUpdate({ msgCount, inputTokens, outputTokens }, fromTabId) {
  const data = await load();

  // Auto-reset if day has changed
  if (data.daily.date !== todayStr()) {
    data.daily = defaultData().daily;
  }

  data.daily.msgCount    += msgCount;
  data.daily.dailyTokens += (inputTokens + outputTokens);
  await save(data);

  // Push updated stats to all ChatGPT tabs
  const snapshot = { msgCount: data.daily.msgCount, dailyTokens: data.daily.dailyTokens };
  broadcastToTabs(snapshot);
}

async function getStats() {
  const data = await load();
  if (data.daily.date !== todayStr()) {
    data.daily = defaultData().daily;
    await save(data);
  }
  return { msgCount: data.daily.msgCount, dailyTokens: data.daily.dailyTokens };
}

async function resetDaily() {
  const data = await load();
  data.daily = defaultData().daily;
  await save(data);
  broadcastToTabs({ msgCount: 0, dailyTokens: 0 });
}

async function broadcastToTabs(statsData) {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://chatgpt.com/*', 'https://chat.openai.com/*'],
    });
    for (const tab of tabs) {
      chrome.tabs.sendMessage(tab.id, { action: 'STATS_PUSH', data: statsData }).catch(() => {});
    }
  } catch (_) {}
}

// ── Alarm ─────────────────────────────────────────────────────────────────
// Clear any existing alarm first to prevent duplicate firing on reinstall
async function scheduleMidnightAlarm() {
  await chrome.alarms.clear(ALARM_NAME);

  const midnight = new Date();
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 1, 0, 0); // 00:01 AM local time

  chrome.alarms.create(ALARM_NAME, {
    when: midnight.getTime(),
    periodInMinutes: 1440,
  });
}

// ── Storage Helpers ───────────────────────────────────────────────────────
function load() {
  return new Promise((res) => {
    chrome.storage.local.get(STORE_KEY, (r) => {
      res(r[STORE_KEY] || defaultData());
    });
  });
}

function save(data) {
  return chrome.storage.local.set({ [STORE_KEY]: data });
}

async function ensureData() {
  const data = await load();
  if (!data.daily?.date) await save(defaultData());
}

function todayStr() {
  // Use LOCAL date, NOT toISOString() which is UTC.
  // At +5:30, 11:30 PM IST = next day in UTC, causing premature resets.
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
