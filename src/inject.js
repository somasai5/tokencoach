// src/inject.js
// Runs in MAIN world — intercepts ChatGPT's native fetch API
// This file CANNOT use chrome.* APIs — only window.postMessage

(function () {
  'use strict';

  if (window.__tokenSenseInjected) return;
  window.__tokenSenseInjected = true;

  const origFetch = window.fetch;

  window.fetch = async function (...args) {
    const url = (typeof args[0] === 'string' ? args[0] : args[0]?.url) || '';

    const isConversation =
      url.includes('/backend-api/conversation') ||
      url.includes('/backend-api/f/conversation') ||
      url.includes('chatgpt.com/backend-api');

    if (!isConversation) {
      return origFetch.apply(this, args);
    }

    // Extract user message from POST body before the request is sent
    const method = (args[1]?.method || 'GET').toUpperCase();
    if (method === 'POST') {
      try {
        const bodyRaw = args[1]?.body;
        // CRITICAL: Only read the body if it is a plain string or ArrayBuffer.
        // Reading a ReadableStream here would CONSUME it, causing ChatGPT's
        // actual request to fail with an empty body. In practice ChatGPT always
        // sends JSON as a string, so this branch always fires correctly.
        if (bodyRaw && (typeof bodyRaw === 'string' ||
                        bodyRaw instanceof ArrayBuffer ||
                        bodyRaw instanceof Uint8Array)) {
          const bodyStr = typeof bodyRaw === 'string'
            ? bodyRaw
            : new TextDecoder().decode(bodyRaw);
          const body = JSON.parse(bodyStr);
          const userText = extractUserText(body);
          if (userText) {
            window.postMessage(
              { source: 'tokensense-inject', type: 'USER_MESSAGE', text: userText },
              '*'
            );
          }
        }
      } catch (_) {}
    }

    let response;
    try {
      response = await origFetch.apply(this, args);
    } catch (err) {
      throw err;
    }

    if (!response.body) return response;

    // Tee the stream: one copy for us, one for ChatGPT
    let ourStream, chatStream;
    try {
      [ourStream, chatStream] = response.body.tee();
    } catch (_) {
      return response;
    }

    // Read our copy asynchronously without blocking ChatGPT
    readStream(ourStream).catch(() => {});

    return new Response(chatStream, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  async function readStream(stream) {
    const reader = stream.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let prevParts = ''; // Track Format-C accumulated text to extract deltas only

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          window.postMessage({ source: 'tokensense-inject', type: 'STREAM_END' }, '*');
          break;
        }

        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const raw = line.slice(6).trim();
          if (raw === '[DONE]') continue;
          try {
            const json = JSON.parse(raw);

            // ── Extract exact token counts from OpenAI's usage field ─────────
            // The final chunk of every response includes usage.prompt_tokens and
            // usage.completion_tokens — these are the server's own billing counts,
            // more accurate than any client-side tokenizer (includes system prompt,
            // conversation history formatting, and all hidden overhead).
            if (json.usage &&
                typeof json.usage.prompt_tokens     === 'number' &&
                typeof json.usage.completion_tokens === 'number') {
              window.postMessage({
                source:           'tokensense-inject',
                type:             'USAGE_DATA',
                promptTokens:     json.usage.prompt_tokens,
                completionTokens: json.usage.completion_tokens,
              }, '*');
            }

            const delta = parseDelta(json, prevParts);
            if (delta && delta.text) {
              prevParts = delta.prevParts ?? prevParts;
              window.postMessage(
                { source: 'tokensense-inject', type: 'STREAM_CHUNK', text: delta.text },
                '*'
              );
            }
          } catch (_) {}
        }
      }
    } catch (_) {
      window.postMessage({ source: 'tokensense-inject', type: 'STREAM_END' }, '*');
    }
  }

  /**
   * Parses a streaming JSON delta from various ChatGPT response formats.
   * Returns { text, prevParts } or null.
   *
   * IMPORTANT: Format C (message.content.parts) sends the FULL accumulated
   * text on each event — NOT a delta. We pass `prevParts` to extract only
   * the new characters since the last event, preventing double-counting.
   */
  function parseDelta(json, prevParts) {
    // Format A: {"v":"text"} — newer ChatGPT streaming (post-2024)
    if (typeof json?.v === 'string' && json.v.length > 0)
      return { text: json.v };

    // Format B: OpenAI-style choices delta
    const content = json?.choices?.[0]?.delta?.content;
    if (typeof content === 'string' && content.length > 0)
      return { text: content };

    // Format C: message object with parts — SENDS FULL TEXT EACH TIME
    // Extract only the new delta by diffing against previous accumulated text
    const parts = json?.message?.content?.parts;
    if (Array.isArray(parts)) {
      const fullText = parts.filter(p => typeof p === 'string').join('');
      if (fullText.length > (prevParts || '').length) {
        const delta = fullText.slice((prevParts || '').length);
        return { text: delta, prevParts: fullText };
      }
      return null;
    }

    // Format D: raw content string
    if (typeof json?.content === 'string' && json.content.length > 0)
      return { text: json.content };

    return null;
  }

  function extractUserText(body) {
    const msgs = body?.messages;
    if (!Array.isArray(msgs) || msgs.length === 0) return null;

    // Get the last user message
    const last = msgs.findLast ? msgs.findLast(m => m.role === 'user') : [...msgs].reverse().find(m => m.role === 'user');
    if (!last) return null;

    const c = last?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(p => p?.text || p?.content || '').filter(Boolean).join(' ');
    return null;
  }
})();
