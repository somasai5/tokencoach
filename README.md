# ⚡ TokenSense — ChatGPT Token & Prompt Pro

A privacy-first Chrome extension that gives you **real-time token counting**, **free-tier usage tracking**, and an **expert prompt engineering assistant** — all running 100% locally in your browser.

---

## Features

| Feature | Description |
|---|---|
| 🔢 **Live Token Counter** | Counts input + output tokens as ChatGPT streams its response |
| 📊 **Context Window Bar** | Visual progress bar showing how full the 128k context window is |
| 📅 **Daily Usage Tracker** | Tracks messages sent today vs your free-tier limit (~80/day for GPT-4o) |
| 💰 **Token Budget Mode** | Set a custom token budget — get warned as you approach it |
| 🧠 **Expert Prompt Engineer** | Analyzes your prompt across 7 dimensions and gives actionable suggestions |
| ✨ **One-Click Rewrite** | Auto-rewrites your prompt applying all engineering best practices |
| 🔒 **100% Local** | Zero network calls, zero data sent anywhere |

---

## Installation (Chrome Developer Mode)

1. **Clone or download** this repository
2. Open Chrome and navigate to `chrome://extensions`
3. Toggle **Developer mode** ON (top-right)
4. Click **"Load unpacked"**
5. Select the `token counter` folder (the one containing `manifest.json`)
6. Navigate to [chatgpt.com](https://chatgpt.com) — the HUD will appear!

---

## How It Works

```
chatgpt.com page
    │
    ├── inject.js  (MAIN world)
    │   └── Monkey-patches window.fetch
    │   └── Tees streaming response — one copy for ChatGPT, one for us
    │   └── Sends chunks via window.postMessage
    │
    ├── content.js  (Isolated world)
    │   └── Receives postMessage from inject.js
    │   └── Runs tokenizer on each chunk
    │   └── Manages the floating glassmorphism HUD
    │   └── Watches input box for real-time prompt analysis
    │
    └── background.js  (Service Worker)
        └── Accumulates daily stats in chrome.storage.local
        └── Daily reset at midnight via chrome.alarms
        └── Pushes live updates to all ChatGPT tabs
```

---

## Prompt Engineer — 7 Analysis Dimensions

The prompt analyzer checks every prompt for:

1. **Role/Persona** — Does it assign an expert identity?
2. **Specificity** — Is the task clearly defined?
3. **Output Format** — Is the expected format specified?
4. **Constraints** — Are limits and requirements defined?
5. **Filler Words** — Are wasteful phrases removed?
6. **Chain-of-Thought** — For reasoning tasks, is step-by-step thinking triggered?
7. **Examples** — For complex tasks, are few-shot examples included?

---

## Project Structure

```
token counter/
├── manifest.json           ← Chrome MV3 manifest
├── icons/                  ← Extension icons
├── src/
│   ├── inject.js           ← Fetch interceptor (MAIN world)
│   ├── tokenizer.js        ← BPE token estimator
│   ├── prompt-engineer.js  ← Prompt analysis engine
│   ├── content.js          ← HUD + orchestrator
│   ├── background.js       ← Service worker
│   └── popup/
│       ├── popup.html      ← Extension popup
│       ├── popup.css       ← Popup styles
│       └── popup.js        ← Popup logic
```

---

## Privacy

- ✅ All tokenization runs in your browser
- ✅ No API keys required
- ✅ No analytics, no tracking, no external servers
- ✅ Data stored only in `chrome.storage.local`

---

## Notes

- Token counts are **estimates** (~±10% vs OpenAI's tiktoken) — treat as guidance, not billing metrics
- ChatGPT's free-tier limits (~80 GPT-4o msgs / 3h) are approximate and may change
- The extension uses `world: "MAIN"` (Chrome 111+) for fetch interception — requires Chrome 111 or newer
