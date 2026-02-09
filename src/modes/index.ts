// Mode-Based Capture - Contextual filtering based on detected activity type

export interface CaptureMode {
  name: string;
  recording_focus: string;
  skip_patterns: string[];
}

const GAMING_MODE: CaptureMode = {
  name: 'gaming',
  recording_focus: 'Game settings, preferences, strategies, keybinds, sensitivity values',
  skip_patterns: ['match result', 'score:', 'round '],
};

const CODE_MODE: CaptureMode = {
  name: 'code',
  recording_focus: 'Architectural decisions, bug fixes, implementations, configurations',
  skip_patterns: ['npm install', 'git status', 'ls -la'],
};

const GENERAL_MODE: CaptureMode = {
  name: 'general',
  recording_focus: 'Preferences, decisions, learnings, important outcomes',
  skip_patterns: [],
};

/**
 * Detect the capture mode based on content keywords
 */
export function detectMode(content: string): CaptureMode {
  const lowerContent = content.toLowerCase();

  // Gaming mode detection
  if (/valorant|csgo|cs2|apex|overwatch|gaming|dpi|edpi|sens|crosshair/i.test(lowerContent)) {
    return GAMING_MODE;
  }

  // Code mode detection
  if (/git|npm|pnpm|yarn|function|class|import|export|const |let |var |async |await /i.test(lowerContent)) {
    return CODE_MODE;
  }

  return GENERAL_MODE;
}

/**
 * Check if content matches any skip patterns for the current mode
 */
export function shouldSkipForMode(content: string, mode: CaptureMode): boolean {
  const lowerContent = content.toLowerCase();
  return mode.skip_patterns.some((pattern) => lowerContent.includes(pattern.toLowerCase()));
}
