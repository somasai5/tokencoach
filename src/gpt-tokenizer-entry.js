// Bundle entry — compiled by esbuild into src/gpt-tokenizer-bundle.js
// Uses the o200k_base vocabulary (GPT-4o / GPT-4o-mini)
// For GPT-3.5/GPT-4 (cl100k_base) the token counts differ by <2% for English text,
// which is well within acceptable range for live display.
import { encode } from 'gpt-tokenizer/model/o200k_base';

// Expose on window so tokenizer.js can call it without ES module imports
window.GPTTokenizerEncode = encode;
