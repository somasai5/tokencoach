// src/popup/popup.js
'use strict';

const STORE_KEY = 'ts_state';

function fmt(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000)    return (n / 1000).toFixed(1) + 'k';
  return String(n);
}

function pct(val, max) {
  return Math.min(100, Math.round((val / max) * 100));
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function loadData() {
  return new Promise((res) => {
    chrome.storage.local.get(STORE_KEY, (r) => {
      const d = r[STORE_KEY]?.daily;
      res({
        msgCount:    d?.msgCount    || 0,
        dailyTokens: d?.dailyTokens || 0,
        date:        d?.date        || todayStr(),
      });
    });
  });
}

async function render() {
  const data = await loadData();
  const msgLimit = 80;
  const msgCount = data.msgCount;
  const tokens   = data.dailyTokens;
  const p        = pct(msgCount, msgLimit);
  const remain   = Math.max(0, msgLimit - msgCount);

  document.getElementById('msg-count').textContent   = msgCount;
  document.getElementById('token-count').textContent = fmt(tokens);
  document.getElementById('msg-pct').textContent     = `${p}% of daily limit`;
  document.getElementById('msgs-remain').textContent = `${remain} remaining`;

  const bar = document.getElementById('msg-bar');
  bar.style.width = p + '%';
  bar.className = 'prog-fill' +
    (p >= 90 ? ' danger' : p >= 70 ? ' warn' : '');

  // Show reset time in user's timezone
  const midnight = new Date();
  midnight.setDate(midnight.getDate() + 1);
  midnight.setHours(0, 0, 0, 0);
  const timeLeft = midnight - Date.now();
  const hrs  = Math.floor(timeLeft / 3600000);
  const mins = Math.floor((timeLeft % 3600000) / 60000);
  document.getElementById('reset-time').textContent =
    hrs > 0 ? `in ${hrs}h ${mins}m` : `in ${mins}m`;
}

// Reset daily counter
document.getElementById('reset-btn').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ action: 'RESET_DAILY' });
  await render();
  const btn = document.getElementById('reset-btn');
  btn.textContent = '✅ Reset!';
  btn.style.color = '#34d399';
  setTimeout(() => {
    btn.textContent = '↺ Reset Daily';
    btn.style.color = '';
  }, 1500);
});

// Open ChatGPT
document.getElementById('open-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://chatgpt.com' });
});

// Init
render();
