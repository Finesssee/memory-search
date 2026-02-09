export function extractConcepts(content: string): string[] {
  const concepts = new Set<string>();

  // Extract from markdown headings
  const headingMatches = content.matchAll(/^#{1,6}\s+(.+)$/gm);
  for (const match of headingMatches) {
    const heading = match[1].trim().toLowerCase();
    if (heading.length > 2 && heading.length < 60) {
      concepts.add(heading);
    }
  }

  // Extract code identifiers (camelCase, PascalCase, snake_case patterns)
  const codeMatches = content.matchAll(/\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\b/g); // PascalCase
  for (const match of codeMatches) {
    concepts.add(match[1].toLowerCase());
  }

  const camelMatches = content.matchAll(/\b([a-z]+(?:[A-Z][a-z]+)+)\b/g); // camelCase
  for (const match of camelMatches) {
    concepts.add(match[1].toLowerCase());
  }

  // Extract backtick-quoted terms (common in markdown)
  const backtickMatches = content.matchAll(/`([^`]{2,40})`/g);
  for (const match of backtickMatches) {
    const term = match[1].trim().toLowerCase();
    if (!term.includes(' ') || term.split(' ').length <= 3) {
      concepts.add(term);
    }
  }

  // Extract technology/framework names (capitalized proper nouns)
  const properNouns = content.matchAll(/\b([A-Z][a-z]{2,}(?:\s[A-Z][a-z]{2,})?)\b/g);
  const commonWords = new Set(['The', 'This', 'That', 'These', 'Those', 'When', 'Where', 'What', 'How', 'Why', 'Which', 'There', 'Here', 'Then', 'Some', 'Any', 'All', 'Most', 'Each', 'Every', 'Other', 'After', 'Before', 'About', 'Into', 'Through', 'During', 'Without', 'Between', 'Under', 'Over', 'While', 'Since', 'Until', 'Also', 'Just', 'Only', 'Very', 'Still', 'Already', 'Even', 'Back', 'Well', 'Much', 'Many', 'Such']);
  for (const match of properNouns) {
    if (!commonWords.has(match[1])) {
      concepts.add(match[1].toLowerCase());
    }
  }

  return Array.from(concepts).slice(0, 20); // Cap at 20 concepts
}
