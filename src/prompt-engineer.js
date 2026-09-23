// src/prompt-engineer.js
// Expert Prompt Analysis Engine
// Evaluates prompts across 7 dimensions and returns actionable,
// prompt-engineer-quality suggestions with an improved rewrite.

/* global PromptEngineer */
const PromptEngineer = (() => {
  'use strict';

  // ── Pattern Libraries ───────────────────────────────────────────────────────

  const FILLER_PATTERNS = [
    { re: /\bcan you\b/gi,          label: '"can you"' },
    { re: /\bcould you\b/gi,        label: '"could you"' },
    { re: /\bwould you\b/gi,        label: '"would you"' },
    { re: /\bplease\b/gi,           label: '"please"' },
    { re: /\bi want you to\b/gi,    label: '"I want you to"' },
    { re: /\bi need you to\b/gi,    label: '"I need you to"' },
    { re: /\bi would like( you to)?\b/gi, label: '"I would like"' },
    { re: /\bi'd like( you to)?\b/gi,    label: '"I\'d like"' },
    { re: /\bkindly\b/gi,           label: '"kindly"' },
    { re: /\bjust\b/gi,             label: '"just"' },
    { re: /\bbasically\b/gi,        label: '"basically"' },
    { re: /\bhelp me( to)?\b/gi,    label: '"help me"' },
    { re: /\btry to\b/gi,           label: '"try to"' },
    { re: /\bif you can\b/gi,       label: '"if you can"' },
  ];

  const ROLE_PATTERNS = [
    /you are (a|an|the)\b/i,
    /act as (a|an|the|an?)\b/i,
    /pretend (to be|you('re| are))\b/i,
    /imagine you('re| are)\b/i,
    /take on the role\b/i,
    /as (a|an) (senior|expert|professional|experienced|skilled|seasoned)\b/i,
    /you('re| are) (a|an) (senior|expert|professional|experienced)\b/i,
    /role[- ]?play\b/i,
    /\b(persona|character):/i,
  ];

  const FORMAT_PATTERNS = [
    /\b(bullet points?|bulleted list|numbered list|step[- ]by[- ]step)\b/i,
    /\b(in json|as json|json format|formatted as json)\b/i,
    /\b(in markdown|as markdown|use markdown)\b/i,
    /\b(in a table|as a table|tabular format)\b/i,
    /\bformat(ted)? (as|like|with|it as)\b/i,
    /\brespond (in|with|using)\b/i,
    /\b(provide|give( me)?|output) (a )?(structured|formatted|organized)\b/i,
    /\buse (headers?|sections?|paragraphs?)\b/i,
    /\bin plain (text|english)\b/i,
  ];

  const CONSTRAINT_PATTERNS = [
    /\b(under|within|less than|no more than|at most|max(imum)?|limit(ed)? to) \d+\b/i,
    /\b(keep it|be|stay) (brief|concise|short|detailed|thorough|comprehensive|focused)\b/i,
    /\b(don'?t|do not|avoid|without|exclude|no)\b/i,
    /\b(only|exclusively|solely|strictly)\b/i,
    /\b(for a? )?(beginner|novice|expert|advanced|technical|non-?technical|junior|senior)\b/i,
    /\b(target audience|aimed at|written for)\b/i,
  ];

  const REASONING_PATTERNS = [
    /\b(calculate|solve|compute|figure out|work out)\b/i,
    /\b(analyze|analyse|evaluate|compare|contrast|assess)\b/i,
    /\b(debug|troubleshoot|diagnose|find (the )?bug|fix (the )?error)\b/i,
    /\b(why (does|is|did|do)|how does|what (causes|makes))\b/i,
    /\b(pros and cons|trade[- ]?offs?|advantages? (and|vs) disadvantages?)\b/i,
    /\b(best (way|approach|method|option|strategy) (to|for))\b/i,
    /\b(optimize|improve|refactor|refine)\b/i,
  ];

  const COT_PATTERNS = [
    /step[- ]by[- ]step/i, /think.*through/i, /work.*through/i,
    /methodically/i, /carefully/i, /reason.*through/i,
    /think.*before/i, /let'?s think/i,
  ];

  const EXAMPLE_PATTERNS = [
    /\bfor example[,:]?/i, /\be\.g\./i, /\bsuch as\b/i,
    /\blike[,:]?\s+["'`]/i, /\bexample[,:]?\s*$/mi,
    /\binput[,:]?\s+["'`]/i, /\bsample[,:]?\s/i,
  ];

  // ── Domain Inference ────────────────────────────────────────────────────────
  const DOMAIN_MAP = [
    [/\b(code|function|class|bug|error|script|programming|developer|api|backend|frontend|react|python|javascript|typescript|sql|database)\b/i, 'software engineer', 'with 10+ years of experience'],
    [/\b(essay|write|writing|blog|article|content|copy|marketing|copywriting|newsletter)\b/i, 'professional writer and content strategist', ''],
    [/\b(data|analysis|dataset|csv|excel|statistics|chart|graph|visualization|pandas|numpy)\b/i, 'senior data analyst', ''],
    [/\b(design|ui|ux|layout|color|visual|figma|wireframe|user interface|user experience)\b/i, 'senior UI/UX designer', ''],
    [/\b(teach|explain|learn|understand|study|course|education|tutorial|lesson)\b/i, 'expert educator and technical communicator', ''],
    [/\b(legal|law|contract|rights|liability|compliance|gdpr|regulation)\b/i, 'legal expert', '(note: not legal advice)'],
    [/\b(medical|health|symptom|disease|treatment|clinical|pharmacy|diagnosis)\b/i, 'medical information specialist', '(note: not medical advice)'],
    [/\b(finance|money|investment|stock|budget|tax|accounting|revenue|profit)\b/i, 'senior financial analyst', ''],
    [/\b(marketing|seo|growth|conversion|funnel|campaign|ads|social media)\b/i, 'growth marketing expert', ''],
    [/\b(product|roadmap|feature|stakeholder|agile|sprint|scrum|backlog)\b/i, 'senior product manager', ''],
  ];

  function inferDomain(text) {
    for (const [pattern, role, note] of DOMAIN_MAP) {
      if (pattern.test(text)) return { role, note };
    }
    return { role: 'domain expert', note: '' };
  }

  function hasPattern(text, patterns) {
    return patterns.some(p => p.test(text));
  }

  function countFillers(text) {
    let total = 0;
    const found = [];
    for (const { re, label } of FILLER_PATTERNS) {
      const matches = text.match(re) || [];
      if (matches.length > 0) {
        total += matches.length;
        found.push(label);
      }
    }
    return { count: total, found };
  }

  // ── Prompt Rewriter ─────────────────────────────────────────────────────────
  // Produces a clean, expert-level prompt a professional prompt engineer would write.
  function rewritePrompt(text, flags) {

    // Step 1: Strip ALL filler phrases
    let core = text.trim();

    // Leading filler openers (longest patterns first to avoid partial matches)
    const leadingFillers = [
      /^i would like you to\s+/i,
      /^i'd like you to\s+/i,
      /^i need you to\s+/i,
      /^i want you to\s+/i,
      /^can you please\s+/i,
      /^could you please\s+/i,
      /^please can you\s+/i,
      /^would you please\s+/i,
      /^can you\s+/i,
      /^could you\s+/i,
      /^would you\s+/i,
      /^please\s+/i,
      /^help me to\s+/i,
      /^help me\s+/i,
      /^i'd like to\s+/i,
      /^i want to\s+/i,
    ];
    for (const re of leadingFillers) {
      core = core.replace(re, '');
    }

    // Inline fillers — safe to strip anywhere in the sentence
    core = core
      .replace(/\bplease\b\s*/gi,     '')
      .replace(/\bkindly\b\s*/gi,     '')
      .replace(/\bjust\s+/gi,         '')
      .replace(/\bbasically\b\s*/gi,  '')
      .replace(/\btry to\s+/gi,       '')
      .replace(/\bif you can\b\s*/gi, '');

    // Step 2: Clean whitespace and fix capitalisation
    core = core.replace(/\s{2,}/g, ' ').trim();
    if (core.length > 0) {
      core = core.charAt(0).toUpperCase() + core.slice(1);
    }
    if (core.length > 0 && !/[.!?]$/.test(core)) {
      core += '.';
    }

    // Step 3: Build the improved prompt section by section
    const sections = [];

    // Role / persona
    if (!flags.hasRole) {
      const { role, note } = inferDomain(text);
      const noteStr = note ? ` ${note}` : '';
      sections.push(`You are an experienced ${role}${noteStr}.`);
    }

    // Core task (cleaned)
    sections.push(core);

    // Format directive — domain-aware, not generic boilerplate
    if (!flags.hasFormat) {
      sections.push(getDomainFormat(text));
    }

    // Constraints block — added when none exist and prompt is substantive
    if (!flags.hasConstraints && core.split(' ').length >= 5) {
      sections.push(getConstraintBlock(text));
    }

    // Chain-of-thought trigger for reasoning tasks
    if (flags.isReasoningTask && !flags.hasCoT) {
      sections.push('Think through this step by step, showing your reasoning before stating the final answer.');
    }

    return sections.join('\n\n').trim();
  }

  /**
   * Returns a domain-aware format directive — specific and actionable.
   */
  function getDomainFormat(text) {
    const t = text.toLowerCase();

    if (/\b(code|function|class|bug|script|refactor|debug|implement|api|backend|frontend)\b/.test(t)) {
      return 'Format your response as follows:\n' +
             '1. A brief explanation of the approach (2-3 sentences).\n' +
             '2. The complete, working code in a clearly labelled code block.\n' +
             '3. A concise explanation of key implementation decisions.';
    }

    if (/\b(data|analysis|dataset|csv|statistics|metrics|report)\b/.test(t)) {
      return 'Present your findings with:\n' +
             '- A summary of key insights (3-5 bullet points).\n' +
             '- Supporting data or calculations, clearly labelled.\n' +
             '- A concise recommendation or conclusion.';
    }

    if (/\b(essay|blog|article|write|content|copy|newsletter|draft)\b/.test(t)) {
      return 'Structure the output with:\n' +
             '- A compelling headline or title.\n' +
             '- Clear sections with descriptive subheadings.\n' +
             '- A strong opening hook and a clear call-to-action at the end.';
    }

    if (/\b(compare|contrast|pros|cons|versus|difference|evaluate)\b/.test(t)) {
      return 'Present the comparison using:\n' +
             '- A summary table with clear column headers.\n' +
             '- A brief narrative explaining the most important differences.\n' +
             '- A final recommendation based on the comparison.';
    }

    if (/\b(explain|teach|understand|learn|tutorial|how does|what is|what are)\b/.test(t)) {
      return 'Explain this clearly:\n' +
             '- Start with a precise one-sentence definition.\n' +
             '- Use a concrete, real-world analogy.\n' +
             '- Provide a practical example that illustrates the concept.';
    }

    return 'Structure your response with:\n' +
           '- A direct answer in the opening paragraph.\n' +
           '- Supporting detail organised under clear headings.\n' +
           '- A brief summary or recommended next steps at the end.';
  }

  /**
   * Returns a domain-appropriate constraint block.
   */
  function getConstraintBlock(text) {
    const t = text.toLowerCase();

    if (/\b(code|function|class|bug|script|implement|refactor)\b/.test(t)) {
      return 'Constraints: Keep the code clean and well-commented. Avoid unnecessary dependencies. Optimise for readability over cleverness.';
    }

    if (/\b(essay|blog|article|write|content|copy)\b/.test(t)) {
      return 'Constraints: Aim for 400-600 words. Use an engaging, professional tone. Avoid jargon unless the context demands it.';
    }

    if (/\b(explain|teach|tutorial|learn)\b/.test(t)) {
      return 'Constraints: Assume intermediate knowledge — define specialised terms but do not over-explain basics. Keep the explanation under 300 words.';
    }

    return 'Constraints: Be concise and specific. Prioritise actionable, practical output. Avoid unnecessary preamble or filler sentences.';
  }

  // ── Main Analyze Function ───────────────────────────────────────────────────
  function analyze(text) {
    if (!text || text.trim().length < 3) {
      return { score: 0, grade: 'none', suggestions: [], improvedPrompt: null, wordCount: 0, charCount: 0 };
    }

    const trimmed = text.trim();
    const wordCount = (trimmed.match(/\b\w+\b/g) || []).length;
    const charCount = trimmed.length;
    const isShort = wordCount < 7;
    const isLong = wordCount > 100;

    const flags = {
      hasRole:        hasPattern(trimmed, ROLE_PATTERNS),
      hasFormat:      hasPattern(trimmed, FORMAT_PATTERNS),
      hasConstraints: hasPattern(trimmed, CONSTRAINT_PATTERNS),
      isReasoningTask:hasPattern(trimmed, REASONING_PATTERNS),
      hasCoT:         hasPattern(trimmed, COT_PATTERNS),
      hasExamples:    hasPattern(trimmed, EXAMPLE_PATTERNS),
    };
    const { count: fillerCount, found: fillerFound } = countFillers(trimmed);

    const suggestions = [];
    let score = 100;

    // ── Rule 1: Role / Persona (−18 if missing) ─────────────────────────────
    if (!flags.hasRole) {
      score -= 18;
      const { role } = inferDomain(trimmed);
      suggestions.push({
        id: 'role',
        priority: 'high',
        icon: '🎭',
        title: 'Add a Role / Persona',
        why: "Assigning a persona anchors GPT to domain-specific training data. It's the single highest-ROI change you can make to any prompt.",
        fix: `Prefix with: "You are an experienced ${role}."`,
        example: `You are an experienced ${role}.\n\n${trimmed.slice(0, 70)}${trimmed.length > 70 ? '…' : ''}`,
      });
    }

    // ── Rule 2: Too Vague / Too Short (−22) ─────────────────────────────────
    if (isShort) {
      score -= 22;
      suggestions.push({
        id: 'specificity',
        priority: 'high',
        icon: '🎯',
        title: 'Too Vague — Add Specifics',
        why: 'Short, underspecified prompts force GPT to make assumptions about your intent, producing generic responses that rarely hit the mark.',
        fix: 'Answer: What exactly do you need? What context is relevant? What does a good answer look like? What should be avoided?',
        example: null,
      });
    }

    // ── Rule 3: Output Format (−12 if missing) ──────────────────────────────
    if (!flags.hasFormat) {
      score -= 12;
      suggestions.push({
        id: 'format',
        priority: 'medium',
        icon: '📋',
        title: 'Specify Output Format',
        why: "Without a format directive, GPT picks its own structure — which may not suit your use case. Format control is a core prompt engineering technique.",
        fix: 'Append one of: "Use numbered steps", "Format as JSON", "Respond in markdown with headers", "Use a table with columns: X, Y, Z".',
        example: null,
      });
    }

    // ── Rule 4: Constraints (−8 if missing, only for non-trivial prompts) ───
    if (!flags.hasConstraints && !isShort) {
      score -= 8;
      suggestions.push({
        id: 'constraints',
        priority: 'low',
        icon: '⚙️',
        title: 'Define Constraints',
        why: 'Constraints prevent hallucinated scope expansion. A bounded prompt produces a focused, usable response.',
        fix: 'Add: word/character limits, tone (formal/casual), audience level (beginner/expert), or what to exclude.',
        example: null,
      });
    }

    // ── Rule 5: Filler Words (−4 per filler phrase) ─────────────────────────
    if (fillerCount >= 2) {
      const deduction = Math.min(16, fillerCount * 4);
      score -= deduction;
      suggestions.push({
        id: 'fillers',
        priority: fillerCount >= 4 ? 'high' : 'medium',
        icon: '✂️',
        title: `Remove ${fillerCount} Filler Phrase${fillerCount > 1 ? 's' : ''}`,
        why: `"${fillerFound.slice(0, 2).join('", "')}" add tokens with zero information value. LLMs respond to imperatives, not polite requests.`,
        fix: 'Use direct commands: "Explain…", "List…", "Compare…", "Write…", "Summarize…"',
        example: null,
      });
    }

    // ── Rule 6: Chain-of-Thought for Reasoning Tasks (−10 if missing) ───────
    if (flags.isReasoningTask && !flags.hasCoT) {
      score -= 10;
      suggestions.push({
        id: 'cot',
        priority: 'medium',
        icon: '🧠',
        title: 'Trigger Chain-of-Thought',
        why: 'For analytical/reasoning tasks, "Think step by step" forces GPT to externalize its reasoning, reducing errors by 30–40% on complex problems (Wei et al., 2022).',
        fix: 'Append: "Think step by step before giving your final answer."',
        example: null,
      });
    }

    // ── Rule 7: Few-Shot Examples (for complex/creative prompts) ────────────
    if (!flags.hasExamples && isLong && !flags.isReasoningTask) {
      score -= 5;
      suggestions.push({
        id: 'examples',
        priority: 'low',
        icon: '💡',
        title: 'Add Examples (Few-Shot)',
        why: 'For creative or transformation tasks, showing 1-2 input→output examples is the most reliable way to calibrate style, tone, and format.',
        fix: 'Add: "For example:\\nInput: [your example]\\nExpected output: [what you want]"',
        example: null,
      });
    }

    score = Math.max(0, Math.min(100, Math.round(score)));

    const grade =
      score >= 82 ? 'excellent' :
      score >= 66 ? 'good'      :
      score >= 45 ? 'fair'      :
      'poor';

    // Sort: high → medium → low
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    suggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Generate improved prompt only if there are meaningful issues to fix
    // (don't waste the user's time with rewrites of already-good prompts)
    const hasActionableIssues = suggestions.some(s => s.priority === 'high' || s.priority === 'medium');
    const improvedPrompt = hasActionableIssues && trimmed.length >= 5
      ? rewritePrompt(trimmed, flags)
      : null;

    return {
      score,
      grade,
      suggestions,
      improvedPrompt,
      wordCount,
      charCount,
      fillerCount,
      flags,
    };
  }

  return { analyze, inferDomain };
})();
