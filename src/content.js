// src/content.js  — TokenSense UX v2: Productivity-First
//
// Two separate floating components:
//
//  1. PILL HUD (bottom-right, draggable, compact by default)
//     ⚡ 1.2k · 🟢 12/80  [≡]
//     Click ≡ → expands to show full stats + budget input
//
//  2. PROMPT COACH (anchored above ChatGPT input, contextual)
//     Appears only when typing. Shows score + tips right where you work.
//     Click → tips slide up. "✨ Apply" button rewrites in one click.
//
// Zero interference with reading or conversation flow.

/* global TokenizerEngine, PromptEngineer */
(function () {
  'use strict';

  // ── State ─────────────────────────────────────────────────────────────────
  const S = {
    conv:           { input: 0, output: 0 },
    streamBuf:      '',
    streamTokAcc:   0,
    streamTimeout:  null,
    isStreaming:    false,
    // Exact counts from OpenAI's API usage field
    exactTotal:     0,
    hasExactData:   false,
    coachHovered:   false, // true while mouse is over the coach panel
    model:          'gpt-4o',
    msgStats:       { msgCount: 0, dailyTokens: 0 },
    analysis:       null,
    budgetLimit:    0,
    pillExpanded:   false,
    coachTipsOpen:  false,
    coachDismissed: false,
    promptTimer:    null,
    pillShadow:  null,
    pillHost:    null,
    coachShadow: null,
    coachHost:   null,
  };


  const fmt  = n => n >= 10000 ? (n / 1000).toFixed(1) + 'k' : n.toLocaleString();
  const pct  = (v, m) => Math.min(100, Math.round((v / m) * 100));
  const PS   = id => S.pillShadow?.getElementById(id);
  const CS   = id => S.coachShadow?.getElementById(id);

  // ── Bridge: receive streaming data from inject.js (MAIN world) ───────────
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.source !== 'tokensense-inject') return;
    const { type, text } = ev.data;

    if (type === 'USER_MESSAGE') {
      const t = TokenizerEngine.countTokens(text);
      S.conv.input += t;
      S.isStreaming  = true;
      S.streamBuf    = '';
      S.streamTokAcc = 0;
      chrome.runtime.sendMessage({ action: 'MSG_SENT', inputTokens: t }).catch(() => {});
      updatePill();
      hideCoach();

      clearTimeout(S.streamTimeout);
      S.streamTimeout = setTimeout(() => {
        if (S.isStreaming) {
          S.isStreaming = false;
          S.streamBuf  = '';
          updatePill();
        }
      }, 10000);

    }

    if (type === 'STREAM_CHUNK') {
      const newToks = TokenizerEngine.countTokens(text);
      S.streamTokAcc = (S.streamTokAcc || 0) + newToks;
      S.streamBuf += text;
      updatePillCompact();
    }

    // ── USAGE_DATA: exact token counts from OpenAI's own API ────────────
    // This arrives in the final streaming chunk of every response.
    // prompt_tokens  = ALL tokens OpenAI charged for input this turn
    //                  (system prompt + conversation history + your message)
    // completion_tokens = exact tokens in this response
    // Together they represent the true context window usage after this turn.
    if (type === 'USAGE_DATA') {
      const { promptTokens, completionTokens } = ev.data;
      clearTimeout(S.streamTimeout);
      S.isStreaming    = false;
      S.streamBuf      = '';
      S.streamTokAcc   = 0;
      S.exactTotal     = promptTokens + completionTokens;
      S.hasExactData   = true;
      // Also sync the estimated conv counters so fallback display is close
      S.conv.input     = promptTokens;
      S.conv.output    = completionTokens;
      // Send exact output count to background for daily stats
      chrome.runtime.sendMessage({ action: 'OUTPUT_TOKENS', outputTokens: completionTokens }).catch(() => {});
      updatePill();
      return;
    }

    if (type === 'STREAM_END') {
      clearTimeout(S.streamTimeout);
      S.isStreaming = false;
      // Only use estimated count if we didn't already get exact data from USAGE_DATA
      if (!S.hasExactData) {
        const out = S.streamTokAcc || TokenizerEngine.countTokens(S.streamBuf);
        S.conv.output += out;
        chrome.runtime.sendMessage({ action: 'OUTPUT_TOKENS', outputTokens: out }).catch(() => {});
      }
      S.streamBuf    = '';
      S.streamTokAcc = 0;
      updatePill();
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // COMPONENT 1: Pill HUD
  // ─────────────────────────────────────────────────────────────────────────
  function buildPill() {
    const host = document.createElement('div');
    host.id = 'ts-pill-root';
    Object.assign(host.style, {
      position: 'fixed',
      bottom:   '18px',
      right:    '16px',
      zIndex:   '2147483647',
    });
    document.body.appendChild(host);
    S.pillHost   = host;
    S.pillShadow = host.attachShadow({ mode: 'open' });

    S.pillShadow.innerHTML = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:host{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px;line-height:1}

.pill{
  display:inline-flex;align-items:center;gap:7px;
  background:rgba(10,14,26,0.93);
  backdrop-filter:blur(22px);-webkit-backdrop-filter:blur(22px);
  border:1px solid rgba(255,255,255,0.1);
  border-radius:40px;
  padding:7px 10px 7px 12px;
  color:#f1f5f9;
  box-shadow:0 8px 28px rgba(0,0,0,0.5),0 0 0 1px rgba(255,255,255,0.04) inset;
  white-space:nowrap;
  cursor:default;user-select:none;
  transition:border-radius .22s ease, padding .22s ease, border-color .2s;
}
.pill:hover{border-color:rgba(255,255,255,0.18)}
.pill.expanded{
  border-radius:14px;
  padding:10px 12px;
  display:flex;flex-direction:column;align-items:stretch;gap:0;
}

/* Compact row */
.pill-row{display:flex;align-items:center;gap:7px}

.logo-mark{
  font-size:13px;font-weight:900;
  background:linear-gradient(135deg,#818cf8,#34d399);
  -webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;
  flex-shrink:0;
}
.stream-dot{
  width:5px;height:5px;border-radius:50%;background:#34d399;flex-shrink:0;
  animation:beat 1s ease-in-out infinite;
}
@keyframes beat{0%,100%{opacity:1}50%{opacity:.2}}

.tok-val{font-size:12px;font-weight:700;color:#e2e8f0;letter-spacing:-.3px}
.sep{color:rgba(255,255,255,.2)}
.msg-chip{
  font-size:10px;font-weight:700;border-radius:20px;padding:1px 8px;
  background:rgba(52,211,153,.12);border:1px solid rgba(52,211,153,.2);color:#34d399;
}
.msg-chip.warn{background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.2);color:#f59e0b}
.msg-chip.danger{background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.2);color:#ef4444}

.expand-btn{
  background:none;border:none;color:rgba(255,255,255,.35);cursor:pointer;
  font-size:13px;padding:1px 2px;line-height:1;transition:color .15s;
  border-radius:4px;font-family:inherit;
}
.expand-btn:hover{color:rgba(255,255,255,.75)}

/* ── Expanded panel ── */
.panel{display:none;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,.06)}
.pill.expanded .panel{display:block}

.prow{display:flex;align-items:center;gap:7px;padding:3px 0}
.plbl{font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#475569;font-weight:700;width:58px;flex-shrink:0}
.pbar-wrap{flex:1;height:3px;background:rgba(255,255,255,.07);border-radius:3px;overflow:hidden}
.pbar{height:100%;border-radius:3px;transition:width .45s ease,background .3s}
.pbar.ctx  {background:linear-gradient(90deg,#818cf8,#a78bfa)}
.pbar.daily{background:linear-gradient(90deg,#34d399,#10b981)}
.pbar.bdgt {background:linear-gradient(90deg,#818cf8,#6366f1)}
.pbar.warn {background:linear-gradient(90deg,#f59e0b,#f97316)}
.pbar.danger{background:linear-gradient(90deg,#ef4444,#dc2626)}
.pval{font-size:9px;color:#64748b;width:52px;text-align:right;flex-shrink:0}

.budget-row{display:flex;align-items:center;gap:6px;margin-top:9px;padding-top:9px;border-top:1px solid rgba(255,255,255,.05)}
.budget-inp{
  flex:1;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);
  border-radius:6px;padding:4px 8px;color:#e2e8f0;font-size:10px;font-family:inherit;
  outline:none;transition:border-color .2s;
}
.budget-inp:focus{border-color:rgba(129,140,248,.5)}
.budget-lbl{font-size:10px;color:#475569;white-space:nowrap}

.reset-btn{
  width:100%;background:none;border:1px solid rgba(255,255,255,.06);
  border-radius:6px;padding:5px;color:#475569;font-size:10px;
  font-family:inherit;cursor:pointer;text-align:center;margin-top:7px;transition:all .2s;
}
.reset-btn:hover{border-color:rgba(255,255,255,.14);color:#94a3b8}

.hidden{display:none!important}
</style>

<div class="pill" id="ts-pill">
  <!-- Always-visible compact row -->
  <div class="pill-row" id="ts-drag-handle" style="cursor:grab;flex:1">
    <span class="logo-mark">⚡</span>
    <span class="stream-dot hidden" id="ts-dot"></span>
    <span class="tok-val" id="ts-tok">0</span>
    <span class="sep">·</span>
    <span class="msg-chip" id="ts-msgs">0/80</span>
  </div>
  <button class="expand-btn" id="ts-expand-btn" title="Toggle stats">≡</button>

  <!-- Expanded panel -->
  <div class="panel">
    <div class="prow">
      <span class="plbl">Context</span>
      <div class="pbar-wrap"><div class="pbar ctx" id="ep-ctx" style="width:0%"></div></div>
      <span class="pval" id="ep-ctx-v">0</span>
    </div>
    <div class="prow">
      <span class="plbl">Daily</span>
      <div class="pbar-wrap"><div class="pbar daily" id="ep-daily" style="width:0%"></div></div>
      <span class="pval" id="ep-daily-v">0/80</span>
    </div>
    <div class="prow hidden" id="ep-budget-row">
      <span class="plbl">Budget</span>
      <div class="pbar-wrap"><div class="pbar bdgt" id="ep-bdgt" style="width:0%"></div></div>
      <span class="pval" id="ep-bdgt-v">—</span>
    </div>

    <div class="budget-row">
      <input type="number" class="budget-inp" id="ts-budget-inp"
             placeholder="Token budget…" min="100" step="500" />
      <span class="budget-lbl">token limit</span>
    </div>

    <button class="reset-btn" id="ts-reset-conv">↺ Reset conversation counter</button>
  </div>
</div>`;

    // Wire events
    PS('ts-expand-btn').addEventListener('click', togglePill);
    // 'input' = live preview as you type; 'change' = persist on blur/Enter
    PS('ts-budget-inp').addEventListener('input',  onBudgetChange);
    PS('ts-budget-inp').addEventListener('change', onBudgetChange);
    PS('ts-reset-conv').addEventListener('click', resetConversation);
    makeDraggable(host, PS('ts-drag-handle'));
  }

  function togglePill() {
    S.pillExpanded = !S.pillExpanded;
    PS('ts-pill')?.classList.toggle('expanded', S.pillExpanded);
    const btn = PS('ts-expand-btn');
    if (btn) btn.textContent = S.pillExpanded ? '✕' : '≡';
  }

  function updatePillCompact() {
    const live = S.isStreaming ? S.streamTokAcc : 0;
    // Prefer exact API data when available; fall back to estimator
    const total = S.hasExactData
      ? S.exactTotal + live   // exact base (includes system prompt) + live stream estimate
      : S.conv.input + S.conv.output + live;
    const dot = PS('ts-dot');
    const tok = PS('ts-tok');
    if (dot) dot.classList.toggle('hidden', !S.isStreaming);
    if (tok) tok.textContent = fmt(total);
  }

  function updatePill() {
    updatePillCompact();

    const ctx      = TokenizerEngine.getContextLimit(S.model);
    const msgLimit = TokenizerEngine.getFreeLimit(S.model);
    const live     = S.isStreaming ? S.streamTokAcc : 0;

    // Prefer exact API data; fall back to estimator
    const total = S.hasExactData
      ? S.exactTotal + live
      : S.conv.input + S.conv.output + live;

    const msgs = S.msgStats.msgCount;
    const cp   = pct(total, ctx);
    const mp   = pct(msgs, msgLimit);

    // Compact: msg chip colour
    const chip = PS('ts-msgs');
    if (chip) {
      chip.textContent = `${msgs}/${msgLimit}`;
      chip.className = `msg-chip${mp >= 90 ? ' danger' : mp >= 70 ? ' warn' : ''}`;
    }

    // Expanded: bars
    setBar('ep-ctx',   cp, 'ctx');
    setBar('ep-daily', mp, 'daily');
    // Show exact/estimate indicator next to the token count
    const exactLabel = S.hasExactData ? ' ● exact' : ' ~ est';
    setText('ep-ctx-v',   `${fmt(total)} / ${Math.round(ctx / 1000)}k${exactLabel}`);
    setText('ep-daily-v', `${msgs} / ${msgLimit}`);

    if (S.budgetLimit > 0) {
      const bp = pct(total, S.budgetLimit);
      PS('ep-budget-row')?.classList.remove('hidden');
      setBar('ep-bdgt', bp, 'bdgt');
      setText('ep-bdgt-v', `${fmt(total)} / ${fmt(S.budgetLimit)}`);
    }
  }

  function onBudgetChange(e) {
    const v = parseInt(e.target.value, 10);
    S.budgetLimit = isNaN(v) || v <= 0 ? 0 : v;
    chrome.storage.local.set({ ts_budget: S.budgetLimit }).catch(() => {});
    updatePill();
  }

  function resetConversation() {
    S.conv         = { input: 0, output: 0 };
    S.streamBuf    = '';
    S.streamTokAcc = 0;
    S.isStreaming  = false;
    S.exactTotal   = 0;
    S.hasExactData = false;
    clearTimeout(S.streamTimeout);
    updatePill();
    const btn = PS('ts-reset-conv');
    if (btn) {
      btn.textContent = '✅ Done!';
      btn.style.color = '#34d399';
      setTimeout(() => { btn.textContent = '↺ Reset conversation counter'; btn.style.color = ''; }, 1500);
    }
  }

  // ── Draggable ─────────────────────────────────────────────────────────────
  const PILL_POS_KEY = 'ts_pill_pos';

  function savePillPos(right, bottom) {
    try { localStorage.setItem(PILL_POS_KEY, JSON.stringify({ right, bottom })); } catch (_) {}
  }

  function restorePillPos() {
    try {
      const p = JSON.parse(localStorage.getItem(PILL_POS_KEY) || 'null');
      if (p && typeof p.right === 'number' && typeof p.bottom === 'number') {
        S.pillHost.style.right  = p.right  + 'px';
        S.pillHost.style.bottom = p.bottom + 'px';
      }
    } catch (_) {}
  }

  function makeDraggable(host, handle) {
    if (!handle) return;
    let ox, oy, oR, oB;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      handle.style.cursor = 'grabbing';
      const r = host.getBoundingClientRect();
      ox = e.clientX; oy = e.clientY;
      oR = window.innerWidth  - r.right;
      oB = window.innerHeight - r.bottom;
      const move = (ev) => {
        const nr = Math.max(4, Math.min(window.innerWidth  - 60, oR + (ox - ev.clientX)));
        const nb = Math.max(4, Math.min(window.innerHeight - 40, oB + (oy - ev.clientY)));
        host.style.right  = nr + 'px';
        host.style.bottom = nb + 'px';
        host.style.left = host.style.top = 'auto';
      };
      const up = () => {
        handle.style.cursor = 'grab';
        // Save position so it survives page reloads
        const r2 = host.getBoundingClientRect();
        savePillPos(
          Math.round(window.innerWidth  - r2.right),
          Math.round(window.innerHeight - r2.bottom)
        );
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup',   up);
      };
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup',   up);
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPONENT 2: Prompt Coach  (anchored above ChatGPT input)
  // ─────────────────────────────────────────────────────────────────────────
  function buildCoach() {
    const host = document.createElement('div');
    host.id = 'ts-coach-root';
    Object.assign(host.style, {
      position: 'fixed',
      zIndex:   '2147483646',
      pointerEvents: 'none',     // pass-through until shown
    });
    document.body.appendChild(host);
    S.coachHost   = host;
    S.coachShadow = host.attachShadow({ mode: 'open' });

    S.coachShadow.innerHTML = `
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:host{font-family:'Inter',-apple-system,BlinkMacSystemFont,sans-serif;font-size:12px}

.coach{
  display:flex;flex-direction:column;gap:6px;
  pointer-events:all;
}
.coach.hidden{display:none}

/* ── Score bar ── */
.score-bar{
  display:inline-flex;align-items:center;gap:8px;
  background:rgba(10,14,26,0.93);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border:1px solid rgba(255,255,255,.1);
  border-radius:40px;
  padding:5px 12px 5px 10px;
  color:#f1f5f9;
  box-shadow:0 4px 20px rgba(0,0,0,.4);
  cursor:pointer;user-select:none;
  transition:border-color .2s;
  white-space:nowrap;
  width:fit-content;
}
.score-bar:hover{border-color:rgba(255,255,255,.22)}

.s-dot{width:7px;height:7px;border-radius:50%;flex-shrink:0}
.s-dot.excellent{background:#34d399;box-shadow:0 0 6px rgba(52,211,153,.5)}
.s-dot.good     {background:#818cf8;box-shadow:0 0 6px rgba(129,140,248,.5)}
.s-dot.fair     {background:#f59e0b;box-shadow:0 0 6px rgba(245,158,11,.5)}
.s-dot.poor     {background:#ef4444;box-shadow:0 0 6px rgba(239,68,68,.5)}

.s-num{font-size:13px;font-weight:800;letter-spacing:-.5px}
.s-num.excellent{color:#34d399}
.s-num.good     {color:#818cf8}
.s-num.fair     {color:#f59e0b}
.s-num.poor     {color:#ef4444}

.s-sep{color:rgba(255,255,255,.2)}
.s-lbl{font-size:11px;color:#94a3b8;font-weight:600}
.s-count{
  font-size:10px;font-weight:700;border-radius:20px;padding:1px 7px;
  background:rgba(239,68,68,.15);color:#f87171;
}
.s-count.ok{background:rgba(52,211,153,.12);color:#34d399}
.s-count.good{background:rgba(129,140,248,.12);color:#818cf8}

.apply-mini{
  font-size:10px;font-weight:700;
  background:linear-gradient(135deg,rgba(129,140,248,.25),rgba(52,211,153,.25));
  border:1px solid rgba(129,140,248,.35);border-radius:20px;padding:2px 9px;
  color:#c7d2fe;cursor:pointer;transition:all .15s;font-family:inherit;
}
.apply-mini:hover{background:linear-gradient(135deg,rgba(129,140,248,.4),rgba(52,211,153,.4));
  border-color:rgba(129,140,248,.6)}

/* ── Tips panel ── */
.tips-wrap{
  background:rgba(10,14,26,0.95);
  backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border:1px solid rgba(255,255,255,.1);
  border-radius:14px;
  padding:10px;
  color:#f1f5f9;
  box-shadow:0 16px 48px rgba(0,0,0,.55);
  display:none;
  flex-direction:column;
  gap:5px;
  max-height:260px;overflow-y:auto;
}
.tips-wrap.open{display:flex;animation:up .18s ease}
@keyframes up{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}

.tip{border-left:2px solid;border-radius:0 7px 7px 0;padding:7px 9px}
.tip.high  {border-color:#ef4444;background:rgba(239,68,68,.06)}
.tip.medium{border-color:#f59e0b;background:rgba(245,158,11,.06)}
.tip.low   {border-color:#818cf8;background:rgba(129,140,248,.06)}
.tip-title {font-weight:700;font-size:11px;color:#e2e8f0;margin-bottom:2px}
.tip-fix   {font-size:10px;color:#6ee7b7;font-style:italic;line-height:1.5}

.apply-big{
  width:100%;
  background:linear-gradient(135deg,rgba(129,140,248,.22),rgba(52,211,153,.22));
  border:1px solid rgba(129,140,248,.35);border-radius:8px;padding:6px 10px;
  color:#c7d2fe;font-size:11px;font-weight:700;cursor:pointer;
  margin-top:5px;transition:all .2s;font-family:inherit;
}
.apply-big:hover{background:linear-gradient(135deg,rgba(129,140,248,.38),rgba(52,211,153,.38));
  transform:translateY(-1px)}
.apply-big:active{transform:translateY(0)}

/* scrollbar */
.tips-wrap::-webkit-scrollbar{width:3px}
.tips-wrap::-webkit-scrollbar-thumb{background:rgba(255,255,255,.1);border-radius:2px}
</style>

<div class="coach hidden" id="ts-coach">
  <!-- Dismiss button -->
  <div style="display:flex;justify-content:flex-end;margin-bottom:-2px">
    <button id="ts-coach-dismiss" style="background:none;border:none;color:rgba(255,255,255,.25);
      cursor:pointer;font-size:13px;line-height:1;padding:2px 4px;border-radius:4px;
      transition:color .15s;font-family:inherit" title="Dismiss (you can re-open by typing)">&times;</button>
  </div>
  <!-- Tips panel slides up above score bar -->
  <div class="tips-wrap" id="ts-tips-wrap">
    <div id="ts-tips-content"></div>
    <button class="apply-big hidden" id="ts-apply-big">✨ Apply Improved Prompt</button>
  </div>

  <!-- Score bar: always visible when typing -->
  <div class="score-bar" id="ts-score-bar">
    <div class="s-dot" id="ts-s-dot"></div>
    <span class="s-num" id="ts-s-num">—</span>
    <span class="s-sep">|</span>
    <span class="s-lbl" id="ts-s-lbl">0 tok</span>
    <span class="s-count ok" id="ts-s-count">—</span>
    <button class="apply-mini hidden" id="ts-apply-mini">✨</button>
  </div>
</div>`;

    // Events
    CS('ts-score-bar').addEventListener('click', toggleCoachTips);
    CS('ts-apply-big').addEventListener('click',  applyImproved);
    CS('ts-apply-mini').addEventListener('click', (e) => { e.stopPropagation(); applyImproved(); });
    CS('ts-coach-dismiss').addEventListener('click', (e) => {
      e.stopPropagation();
      S.coachDismissed = true;
      S.coachHovered   = false;
      hideCoach();
    });

    // ─ Hover protection ───────────────────────────────────────
    // Keep the coach visible while the user's cursor is over it.
    // Without this, moving the mouse from the textarea toward the Apply
    // button fires blur/focus events that call hideCoach before the user
    // can interact with it.
    S.coachHost.addEventListener('mouseenter', () => {
      S.coachHovered = true;
    });
    S.coachHost.addEventListener('mouseleave', () => {
      S.coachHovered = false;
      // If the input is now empty (user cleared it while hovering coach)
      // give them 600ms to potentially interact before hiding
      const ta = findInput();
      const txt = (ta?.textContent || ta?.value || '').trim();
      if (!txt && !S.coachDismissed) {
        setTimeout(() => { if (!S.coachHovered) hideCoach(); }, 600);
      }
    });
  }

  function positionCoach() {
    if (!S.coachHost) return;
    const input = findInput();
    if (!input) return;

    const anchor =
      input.closest('form')                                              ||
      input.closest('[class*="ProseMirror"]')?.parentElement?.parentElement ||
      input.closest('[class*="composer"]')                              ||
      input.closest('[class*="Composer"]')                              ||
      input.closest('[class*="input"]')                                 ||
      input.parentElement?.parentElement                                ||
      input.parentElement;

    const rect   = (anchor || input).getBoundingClientRect();
    const coachH = S.coachHost.getBoundingClientRect().height || 80;
    const rawBottom = window.innerHeight - rect.top + 10;

    // U7: Clamp so tips panel doesn't overflow past the top of the viewport
    const bottom = Math.min(rawBottom, window.innerHeight - coachH - 8);
    const left   = Math.max(8, rect.left);
    const width  = Math.min(rect.width || 520, window.innerWidth - 24);

    Object.assign(S.coachHost.style, {
      bottom: bottom + 'px',
      left:   left   + 'px',
      width:  width  + 'px',
      top:    'auto',
    });
  }

  function showCoach(analysis) {
    S.coachHost.style.pointerEvents = 'all';
    const coach = CS('ts-coach');
    if (coach) coach.classList.remove('hidden');
    positionCoach();

    // Dot + score
    const dot = CS('ts-s-dot');
    const num = CS('ts-s-num');
    if (dot) { dot.className = ''; dot.classList.add('s-dot', analysis.grade); }
    if (num) { num.textContent = analysis.score; num.className = `s-num ${analysis.grade}`; }

    // Show live token count in the label area
    const lbl = CS('ts-s-lbl');
    if (lbl) {
      const ta  = findInput();
      const txt = ta ? (ta.textContent || ta.value || '') : '';
      const toks = TokenizerEngine.countTokens(txt);
      lbl.textContent = `${toks} tok`;
    }

    // Tips count chip
    const chip = CS('ts-s-count');
    if (chip) {
      const n  = analysis.suggestions.length;
      const hi = analysis.suggestions.filter(s => s.priority === 'high').length;
      chip.textContent = n === 0 ? '✓ Great!' : `${n} tip${n > 1 ? 's' : ''} ›`;
      chip.className   = `s-count${hi > 0 ? '' : n === 0 ? ' ok' : ' good'}`;
    }

    // Mini apply button
    const mini = CS('ts-apply-mini');
    if (mini) mini.classList.toggle('hidden', !analysis.improvedPrompt);

    // Tips content (includes 'why' for better learning)
    const content = CS('ts-tips-content');
    if (content) {
      content.innerHTML = analysis.suggestions.slice(0, 5).map(s => `
        <div class="tip ${s.priority}">
          <div class="tip-title">${s.icon} ${s.title}</div>
          <div class="tip-fix">→ ${s.fix}</div>
        </div>
      `).join('');
    }

    // Big apply button
    const big = CS('ts-apply-big');
    if (big) big.classList.toggle('hidden', !analysis.improvedPrompt);
  }

  function hideCoach() {
    // Don't hide if the user's mouse is currently over the coach
    // (they may be moving toward the Apply button or tips)
    if (S.coachHovered) return;

    clearTimeout(S.promptTimer);
    S.promptTimer = null;
    if (!S.coachHost) return;
    S.coachHost.style.pointerEvents = 'none';
    const coach = CS('ts-coach');
    if (coach) coach.classList.add('hidden');
    S.coachTipsOpen = false;
    CS('ts-tips-wrap')?.classList.remove('open');
  }

  function toggleCoachTips() {
    S.coachTipsOpen = !S.coachTipsOpen;
    CS('ts-tips-wrap')?.classList.toggle('open', S.coachTipsOpen);
    positionCoach(); // re-anchor since height changed
  }

  function applyImproved() {
    if (!S.analysis?.improvedPrompt) return;
    const ta = findInput();
    if (!ta) return;
    const text = S.analysis.improvedPrompt;

    if (ta.getAttribute('contenteditable') != null) {
      // ── Lexical / ProseMirror editor fix ──────────────────────────────────
      // DO NOT use ta.textContent = text.
      //
      // Lexical stores content in its own internal state tree. Setting textContent
      // directly changes the DOM visually but Lexical doesn't know about it.
      // On the very next keystroke, Lexical re-renders from its shadow state,
      // wiping the improved text and restoring the original — so amendments
      // are "not considered" by the coach.
      //
      // The correct approach: go through the browser's native editing pipeline
      // (select-all + insertText). Lexical actively intercepts these execCommand
      // calls and updates its own state accordingly, just like a real paste.
      try {
        ta.focus();
        document.execCommand('selectAll');
        document.execCommand('insertText', false, text);
      } catch (_) {
        // Fallback: clipboard paste simulation (works in most frameworks)
        try {
          ta.focus();
          const dt = new DataTransfer();
          dt.setData('text/plain', text);
          ta.dispatchEvent(new ClipboardEvent('paste', {
            clipboardData: dt, bubbles: true, cancelable: true,
          }));
        } catch (__) {
          // Last resort: direct assignment (visual only, state may not sync)
          ta.textContent = text;
          ta.dispatchEvent(new InputEvent('input', { bubbles: true }));
        }
      }

      // Move cursor to end so user can continue typing naturally
      requestAnimationFrame(() => {
        try {
          const r = document.createRange();
          r.selectNodeContents(ta); r.collapse(false);
          const sel = window.getSelection();
          sel?.removeAllRanges(); sel?.addRange(r);
        } catch (_) {}
      });

    } else {
      // Plain <textarea>: React synthetic onChange needs the native setter
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(ta, text);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Collapse tips panel
    S.coachTipsOpen = false;
    CS('ts-tips-wrap')?.classList.remove('open');

    // Button feedback
    const applyBig  = CS('ts-apply-big');
    const applyMini = CS('ts-apply-mini');
    const showFeedback = (btn) => {
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = '\u2705 Applied!';
      setTimeout(() => { btn.textContent = orig; }, 1800);
    };
    showFeedback(applyBig);
    showFeedback(applyMini);

    // Re-analyse the improved text and update the coach score.
    // execCommand fires native input events so onInput() will also run,
    // but we do an explicit pass here for immediate feedback (no 260ms wait).
    setTimeout(() => {
      const newText = (ta.textContent || ta.value || '').trim();
      if (!newText) return;
      const newAnalysis = PromptEngineer.analyze(newText);
      S.analysis = newAnalysis;
      showCoach(newAnalysis);
    }, 150);
  }


  // ── Input Watcher ─────────────────────────────────────────────────────────
  function findInput() {
    return (
      document.querySelector('#prompt-textarea')                                ||
      document.querySelector('div[contenteditable="true"][data-lexical-editor]') ||
      document.querySelector('div[contenteditable="true"][aria-label]')          ||
      document.querySelector('div[contenteditable="true"]')                      ||
      document.querySelector('textarea[placeholder]')
    );
  }

  function watchInput() {
    let lastText = '';
    let attached = null;
    let observer = null;

    function onInput() {
      const ta = findInput();
      if (!ta) return;
      const text = (ta.textContent || ta.value || '').trim();
      if (text === lastText) return;
      lastText = text;

      clearTimeout(S.promptTimer);

      // Re-enable coach if user types again after dismiss
      if (text) S.coachDismissed = false;

      if (!text) {
        // Only hide coach if user isn't hovering over it
        // (they might be reading the tips while the box is empty)
        if (!S.coachHovered) hideCoach();
        return;
      }

      S.promptTimer = setTimeout(() => {
        if (!S.coachDismissed) {
          const analysis = PromptEngineer.analyze(text);
          S.analysis = analysis;
          showCoach(analysis);
        }
      }, 260);
    }

    // onPaste: paste/drop events fire BEFORE the DOM is updated on contenteditable,
    // so we wait 60 ms for the browser to commit the new content, then run analysis.
    function onPaste() { setTimeout(onInput, 60); }

    function attach(el) {
      if (!el || el === attached) return;

      // Clean up old listeners
      if (attached) {
        attached.removeEventListener('input',  onInput);
        attached.removeEventListener('focus',  onInput);
        attached.removeEventListener('paste',  onPaste);
        attached.removeEventListener('drop',   onPaste);
      }

      // 'input'  — keyboard strokes
      // 'focus'  — user clicks in / switches back (catches pre-existing text)
      // 'paste'  — Ctrl+V or right-click paste (delayed so DOM is updated)
      // 'drop'   — drag-and-drop text into the box (same delay)
      el.addEventListener('input',  onInput);
      el.addEventListener('focus',  onInput);
      el.addEventListener('paste',  onPaste);
      el.addEventListener('drop',   onPaste);
      attached = el;

      // P2: Disconnect observer once we have a stable input element
      if (observer) {
        observer.disconnect();
        observer = null;
      }

      // Immediately check if there is already text in the box
      // (e.g. user navigated back to a partially-typed message)
      onInput();
    }

    attach(findInput());

    if (!attached) {
      // P2: Only observe DOM if we haven't found the input yet
      observer = new MutationObserver(() => {
        const ta = findInput();
        if (ta && ta !== attached) attach(ta);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }

    window.addEventListener('scroll', positionCoach, { passive: true });
    window.addEventListener('resize', positionCoach, { passive: true });
  }


  // ── Background Communication ──────────────────────────────────────────────
  function fetchStats() {
    chrome.runtime.sendMessage({ action: 'GET_STATS' }, (data) => {
      if (chrome.runtime.lastError || !data) return;
      S.msgStats = data;
      updatePill();
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.action === 'STATS_PUSH') { S.msgStats = msg.data; updatePill(); }
  });

  // ── Model Detection ───────────────────────────────────────────────────────
  function detectModel() {
    const el = document.querySelector(
      '[data-testid="model-switcher-dropdown-button"] span,' +
      'button[aria-haspopup] span, nav button span'
    );
    if (!el) return;
    const t = el.textContent.toLowerCase();
    if      (t.includes('4o mini')) S.model = 'gpt-4o-mini';
    else if (t.includes('4o'))      S.model = 'gpt-4o';
    else if (t.includes('o1'))      S.model = 'o1';
    else if (t.includes('o3'))      S.model = 'o3-mini';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────
  function setBar(id, p, cls) {
    const el = PS(id);
    if (!el) return;
    el.style.width = p + '%';
    el.className = `pbar ${cls}${p >= 90 ? ' danger' : p >= 70 ? ' warn' : ''}`;
  }
  function setText(id, v) {
    const el = PS(id);
    if (el) el.textContent = String(v);
  }

  // ── Conversation Change Detection ─────────────────────────────────────────
  // P1: Use pushState intercept + popstate for instant detection (no polling)
  function watchConversationChange() {
    let lastPath = location.pathname;

    function onNav() {
      if (location.pathname !== lastPath) {
        lastPath       = location.pathname;
        S.conv         = { input: 0, output: 0 };
        S.streamBuf    = '';
        S.streamTokAcc = 0;
        S.isStreaming  = false;
        S.exactTotal   = 0;
        S.hasExactData = false;
        clearTimeout(S.streamTimeout);
        hideCoach();
        updatePill();
      }
    }

    // Intercept History API (ChatGPT uses pushState for navigation)
    const origPush    = history.pushState.bind(history);
    const origReplace = history.replaceState.bind(history);
    history.pushState    = (...a) => { origPush(...a);    onNav(); };
    history.replaceState = (...a) => { origReplace(...a); onNav(); };
    window.addEventListener('popstate', onNav);
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    buildPill();
    restorePillPos();  // U2: remember where user dragged the pill
    buildCoach();
    detectModel();
    watchInput();
    watchConversationChange();
    fetchStats();

    chrome.storage.local.get('ts_budget', ({ ts_budget }) => {
      if (ts_budget > 0) {
        S.budgetLimit = ts_budget;
        const inp = PS('ts-budget-inp');
        if (inp) inp.value = ts_budget;
        PS('ep-budget-row')?.classList.remove('hidden');
      }
    });

    setInterval(detectModel, 5000);
    setInterval(fetchStats,  15000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else setTimeout(init, 600);
})();
