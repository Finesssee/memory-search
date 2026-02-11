// Spell corrector — fixes typos in search queries using the indexed vocabulary.
// Uses Levenshtein distance to find closest matches from FTS content.

import type { MemoryDB } from '../storage/db.js';

/**
 * Compute Levenshtein (edit) distance between two strings.
 * Optimized with early termination when distance exceeds maxDist.
 */
function levenshtein(a: string, b: string, maxDist = 3): number {
    if (a === b) return 0;
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;

    const la = a.length;
    const lb = b.length;

    // Use two rows instead of full matrix for memory efficiency
    let prev = new Array(lb + 1);
    let curr = new Array(lb + 1);

    for (let j = 0; j <= lb; j++) prev[j] = j;

    for (let i = 1; i <= la; i++) {
        curr[0] = i;
        let minInRow = curr[0];

        for (let j = 1; j <= lb; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            curr[j] = Math.min(
                prev[j] + 1,     // deletion
                curr[j - 1] + 1, // insertion
                prev[j - 1] + cost // substitution
            );
            if (curr[j] < minInRow) minInRow = curr[j];
        }

        // Early termination: if minimum in this row exceeds maxDist, we can stop
        if (minInRow > maxDist) return maxDist + 1;

        [prev, curr] = [curr, prev];
    }

    return prev[lb];
}

/**
 * Build a vocabulary set from the FTS index.
 * Extracts unique words from content, filename, and headings columns.
 * Cached per call — the caller should cache the result for the session.
 */
export function buildVocabulary(db: MemoryDB): Set<string> {
    const vocab = new Set<string>();
    const words = db.getFtsVocabulary();
    for (const word of words) {
        if (word.length >= 2 && word.length <= 30) {
            vocab.add(word.toLowerCase());
        }
    }
    return vocab;
}

/**
 * Find the best match for a single word in the vocabulary.
 * Returns the original word if it's already in vocab or no close match found.
 */
function findBestMatch(
    word: string,
    vocab: Set<string>,
    maxDistance = 2
): { corrected: string; distance: number } {
    const lower = word.toLowerCase();

    // Already in vocabulary — no correction needed
    if (vocab.has(lower)) {
        return { corrected: word, distance: 0 };
    }

    let bestMatch = word;
    let bestDist = maxDistance + 1;

    for (const candidate of vocab) {
        // Quick length filter — edit distance can't be less than length difference
        if (Math.abs(candidate.length - lower.length) > maxDistance) continue;

        // Quick first-char filter — most typos preserve the first character
        // Skip this for very short words where first char typo is common
        if (lower.length > 3 && candidate.length > 3 && lower[0] !== candidate[0]) continue;

        const dist = levenshtein(lower, candidate, maxDistance);
        if (dist < bestDist) {
            bestDist = dist;
            bestMatch = candidate;
            if (dist === 1) break; // Distance 1 is good enough, no need to keep looking
        }
    }

    return { corrected: bestMatch, distance: bestDist };
}

/**
 * Correct spelling in a query string using the indexed vocabulary.
 * Returns the corrected query and a list of corrections made.
 *
 * Only corrects words that are NOT in the vocabulary and have a close match.
 * Preserves quoted phrases and special characters.
 */
export function correctQuery(
    query: string,
    db: MemoryDB
): { corrected: string; corrections: Array<{ original: string; replacement: string }> } {
    // Extract quoted phrases to preserve them
    const phrases: string[] = [];
    const withoutPhrases = query.replace(/"([^"]+)"/g, (_match, phrase) => {
        phrases.push(phrase);
        return `__PHRASE_${phrases.length - 1}__`;
    });

    const vocab = buildVocabulary(db);

    // If vocabulary is too small, skip correction (not enough data to be reliable)
    if (vocab.size < 100) {
        return { corrected: query, corrections: [] };
    }

    const words = withoutPhrases.split(/\s+/);
    const corrections: Array<{ original: string; replacement: string }> = [];
    const correctedWords: string[] = [];

    for (const word of words) {
        // Skip placeholders, short words, numbers, paths
        if (word.startsWith('__PHRASE_') ||
            word.length <= 2 ||
            /^\d+$/.test(word) ||
            /[/\\.]/.test(word)) {
            correctedWords.push(word);
            continue;
        }

        const { corrected, distance } = findBestMatch(word, vocab);
        if (distance > 0 && distance <= 2) {
            corrections.push({ original: word, replacement: corrected });
            correctedWords.push(corrected);
        } else {
            correctedWords.push(word);
        }
    }

    // Restore quoted phrases
    let result = correctedWords.join(' ');
    for (let i = 0; i < phrases.length; i++) {
        result = result.replace(`__PHRASE_${i}__`, `"${phrases[i]}"`);
    }

    return { corrected: result, corrections };
}
