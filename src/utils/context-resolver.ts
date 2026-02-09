// Resolves path context for queries
// Finds the most specific context for a given path or global context

import type { PathContext } from '../types.js';
import path from 'path';

/**
 * Resolve relevant context strings for a given project path.
 * Returns global context (path='/') + any parent path contexts.
 */
export function resolveContextForPath(
  projectPath: string,
  contexts: PathContext[] = []
): string[] {
  if (!contexts || contexts.length === 0) {
    return [];
  }

  const resolved: string[] = [];
  const normalizedProject = path.resolve(projectPath);

  // 1. Always include global context
  const globalContext = contexts.find(c => c.path === '/' || c.path === '\\');
  if (globalContext) {
    resolved.push(globalContext.description);
  }

  // 2. Find other contexts that are parents of (or equal to) projectPath
  // Sort by length desc to get most specific first if we needed to limit,
  // but for now we'll just gather all relevant ones.
  const relevantContexts = contexts
    .filter(c => {
      // Skip global as we already added it
      if (c.path === '/' || c.path === '\\') return false;

      const contextPath = path.resolve(c.path);

      // Check if projectPath is inside contextPath
      // e.g. project=D:\Code\Project, context=D:\Code
      return !path.relative(contextPath, normalizedProject).startsWith('..');
    })
    .sort((a, b) => b.path.length - a.path.length); // Deepest first

  for (const ctx of relevantContexts) {
    resolved.push(ctx.description);
  }

  return resolved;
}
