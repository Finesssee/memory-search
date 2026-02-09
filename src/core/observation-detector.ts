import type { ObservationType } from '../types.js';

interface PatternRule {
  type: ObservationType;
  patterns: RegExp[];
  weight: number;
}

const RULES: PatternRule[] = [
  {
    type: 'bugfix',
    patterns: [/\bfix(ed|es|ing)?\b/i, /\bbug\b/i, /\bissue\b/i, /\berror\b/i, /\bcrash(ed|es|ing)?\b/i, /\bpatch(ed|es|ing)?\b/i, /\bresolv(e|ed|es|ing)\b/i, /\bdebug(ged|ging)?\b/i],
    weight: 1.0,
  },
  {
    type: 'feature',
    patterns: [/\bfeature\b/i, /\bimplement(ed|s|ing|ation)?\b/i, /\badd(ed|s|ing)?\b/i, /\bnew\b/i, /\bintroduc(e|ed|es|ing)\b/i, /\bcreate[ds]?\b/i],
    weight: 0.8,
  },
  {
    type: 'decision',
    patterns: [/\bdecid(e|ed|es|ing)\b/i, /\bchos(e|en)\b/i, /\bdecision\b/i, /\brationale\b/i, /\btrade-?off\b/i, /\bwhy we\b/i],
    weight: 1.0,
  },
  {
    type: 'preference',
    patterns: [/\bprefer(s|red|ring|ence)?\b/i, /\bfavorite\b/i, /\balways use\b/i, /\bsettings?\b/i],
    weight: 0.9,
  },
  {
    type: 'config',
    patterns: [/\bconfig(uration|ure|ured|uring)?\b/i, /\bsetting\b/i, /\benv(ironment)?\b/i, /\bparameter\b/i, /\boption\b/i, /\.env\b/i, /\byaml\b/i, /\btoml\b/i],
    weight: 0.7,
  },
  {
    type: 'architecture',
    patterns: [/\barchitect(ure|ural)?\b/i, /\bdesign(ed|ing|s)?\b/i, /\bpattern\b/i, /\bstructure[ds]?\b/i, /\blayer(ed|s|ing)?\b/i, /\bmodule\b/i, /\bsystem design\b/i],
    weight: 0.9,
  },
  {
    type: 'reference',
    patterns: [/\breference\b/i, /\bdoc(umentation|s)?\b/i, /\bguide\b/i, /\bmanual\b/i, /\bspec(ification)?\b/i, /\bapi\b/i, /\breadme\b/i],
    weight: 0.6,
  },
  {
    type: 'learning',
    patterns: [/\blearn(ed|ing|s)?\b/i, /\btil\b/i, /\bdiscover(ed|ing|s|y)?\b/i, /\brealize[ds]?\b/i, /\binsight\b/i, /\bfound out\b/i],
    weight: 0.9,
  },
];

const MIN_SCORE = 2; // Minimum pattern matches * weight to trigger categorization

export function detectObservationType(content: string): ObservationType | null {
  const scores = new Map<ObservationType, number>();

  for (const rule of RULES) {
    let matchCount = 0;
    for (const pattern of rule.patterns) {
      const matches = content.match(new RegExp(pattern.source, 'gi'));
      if (matches) matchCount += matches.length;
    }
    if (matchCount > 0) {
      const score = matchCount * rule.weight;
      scores.set(rule.type, (scores.get(rule.type) ?? 0) + score);
    }
  }

  if (scores.size === 0) return null;

  // Find highest scoring type
  let best: ObservationType | null = null;
  let bestScore = 0;
  for (const [type, score] of scores) {
    if (score > bestScore) {
      bestScore = score;
      best = type;
    }
  }

  return bestScore >= MIN_SCORE ? best : null;
}
