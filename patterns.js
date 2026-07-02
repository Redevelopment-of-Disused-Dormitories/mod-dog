/* mod dog — patterns.js
   Regex-based detection engine. Zero AI. Pure computation. */

// ── PII Patterns (Taiwan-specific) ──
export const PII_PATTERNS = [
  {
    name: 'TW_ID_CARD',
    regex: /[A-Z][12]\d{8}/g,
    label: '台灣身分證字號',
  },
  {
    name: 'TW_PHONE',
    regex: /09\d{8}/g,
    label: '台灣手機號碼',
  },
  {
    name: 'TW_PHONE_LANDLINE',
    regex: /0[2-8]\d{7,8}/g,
    label: '台灣市話',
  },
  {
    name: 'EMAIL',
    regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    label: '電子郵件',
  },
  {
    name: 'TW_PASSPORT',
    regex: /[A-Z][A-Z0-9]\d{8}/g,
    label: '護照號碼',
  },
  {
    name: 'CREDIT_CARD',
    regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g,
    label: '信用卡號',
  },
  {
    name: 'IP_ADDRESS',
    regex: /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    label: 'IP 位址',
  },
];

// ── Spam Detection Patterns ──
export const SPAM_PATTERNS = [
  {
    name: 'REPEATED_CHARS',
    regex: /(.)\1{5,}/g,
    label: '重複字元洗板',
  },
  {
    name: 'REPEATED_WORD',
    regex: /(\b\w+\b)(\s+\1){3,}/gi,
    label: '重複詞語洗板',
  },
  {
    name: 'ALL_CAPS_SPAM',
    regex: /^[A-Z\s!?]{10,}$/,
    label: '全大寫洗板',
  },
  {
    name: 'EMOJI_FLOOD',
    regex: /[\u{1F600}-\u{1F9FF}]{5,}/gu,
    label: '表情符號洪水',
  },
  {
    name: 'LINK_FLOOD',
    regex: /https?:\/\/\S+/gi,
    label: '連結轟炸',
  },
];

// ── URL Whitelist Matching ──
export function matchesWhitelist(text, whitelist) {
  return whitelist.some((entry) => {
    try {
      const re = new RegExp(entry.pattern, 'i');
      return re.test(text);
    } catch {
      return text.includes(entry.pattern);
    }
  });
}

// ── String Similarity (Dice Coefficient) ──
export function bigrams(str) {
  const s = str.toLowerCase().replace(/\s+/g, '');
  const bags = new Set();
  for (let i = 0; i < s.length - 1; i++) {
    bags.add(s.substring(i, i + 2));
  }
  return bags;
}

export function diceCoefficient(a, b) {
  if (a === b) return 1;
  const aBi = bigrams(a);
  const bBi = bigrams(b);
  if (aBi.size === 0 || bBi.size === 0) return 0;
  let overlap = 0;
  for (const bg of aBi) {
    if (bBi.has(bg)) overlap++;
  }
  return (2 * overlap) / (aBi.size + bBi.size);
}

// ── Levenshtein Distance ──
export function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// ── Fuzzy Spam Detection ──
export function isSpamFuzzy(messages, threshold = 0.8) {
  if (messages.length < 2) return false;
  for (let i = 0; i < messages.length; i++) {
    for (let j = i + 1; j < messages.length; j++) {
      if (diceCoefficient(messages[i].text, messages[j].text) >= threshold) {
        return true;
      }
    }
  }
  return false;
}

// ── Detect PII in text ──
export function detectPII(text) {
  const hits = [];
  for (const p of PII_PATTERNS) {
    const matches = text.match(p.regex);
    if (matches) {
      hits.push({ pattern: p.name, label: p.label, matches });
    }
  }
  return hits;
}

// ── Detect Spam patterns ──
export function detectSpam(text) {
  const hits = [];
  for (const p of SPAM_PATTERNS) {
    if (p.regex.test(text)) {
      hits.push({ pattern: p.name, label: p.label });
    }
    p.regex.lastIndex = 0;
  }
  return hits;
}

// ── Classify message risk ──
export function classifyMessage(text, recentMessages = []) {
  const pii = detectPII(text);
  if (pii.length > 0) {
    return { level: 'critical', type: 'pii', hits: pii };
  }

  const spam = detectSpam(text);
  if (spam.length > 0) {
    return { level: 'high', type: 'spam', hits: spam };
  }

  if (recentMessages.length > 0 && isSpamFuzzy([{ text }, ...recentMessages])) {
    return { level: 'medium', type: 'flood', hits: [{ pattern: 'FUZZY_MATCH', label: '相似度洗板' }] };
  }

  return { level: 'safe', type: null, hits: [] };
}
