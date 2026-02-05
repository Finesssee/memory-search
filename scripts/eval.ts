import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';

interface BenchmarkQuery {
  id: string;
  query: string;
  expected: string[];
  notes?: string;
}

interface BenchmarkFile {
  name?: string;
  k?: number;
  queries: BenchmarkQuery[];
}

interface CliResult {
  file: string;
  score: number;
  lineStart: number;
  lineEnd: number;
  snippet: string;
  chunkIndex: number;
}

interface CliResponse {
  query: string;
  results: CliResult[];
}

interface EvalConfig {
  name: string;
  expand: boolean;
  rerank: boolean;
}

interface QueryMetrics {
  nDCG: number;
  mrr: number;
  recall: number;
  relevantFound: number;
  expectedTotal: number;
}

const DEFAULT_CONFIGS: EvalConfig[] = [
  { name: 'baseline', expand: false, rerank: true },
  { name: 'expand', expand: true, rerank: true },
  { name: 'no-rerank', expand: false, rerank: false },
  { name: 'expand+no-rerank', expand: true, rerank: false },
];

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const [key, inlineValue] = arg.slice(2).split('=');
    if (inlineValue !== undefined) {
      out[key] = inlineValue;
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function normalizePath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function matchesExpected(resultFile: string, expected: string): boolean {
  const resultNorm = normalizePath(resultFile);
  const expectedNorm = normalizePath(expected);

  const hasSeparator = expectedNorm.includes('/');
  if (!hasSeparator) {
    // No separator - match filename OR folder name
    if (basename(resultNorm) === expectedNorm) return true;
    // Also match if expected is a folder name in the path
    return resultNorm.includes('/' + expectedNorm + '/');
  }
  // Has separator - match as path suffix or folder prefix
  if (resultNorm.endsWith(expectedNorm)) return true;
  // Also match folder paths (e.g., "100m-offers/SKILL.md" matches "100m-offers/01-intro.md")
  const expectedFolder = expectedNorm.split('/').slice(0, -1).join('/');
  if (expectedFolder && resultNorm.includes('/' + expectedFolder + '/')) return true;
  return false;
}

function computeMetrics(results: string[], expected: string[], k: number): QueryMetrics {
  const expectedNorm = expected.map(normalizePath);
  const topResults = results.slice(0, k);
  const relevances: number[] = [];
  const matchedExpected = new Set<string>();

  for (const file of topResults) {
    let isRel = false;
    for (const exp of expected) {
      if (matchesExpected(file, exp)) {
        isRel = true;
        matchedExpected.add(normalizePath(exp));
      }
    }
    relevances.push(isRel ? 1 : 0);
  }

  let dcg = 0;
  for (let i = 0; i < relevances.length; i++) {
    const rel = relevances[i];
    if (rel > 0) {
      dcg += rel / Math.log2(i + 2);
    }
  }

  const idealCount = Math.min(expectedNorm.length, k);
  let idcg = 0;
  for (let i = 0; i < idealCount; i++) {
    idcg += 1 / Math.log2(i + 2);
  }

  const nDCG = idcg === 0 ? 0 : dcg / idcg;

  let mrr = 0;
  for (let i = 0; i < relevances.length; i++) {
    if (relevances[i] > 0) {
      mrr = 1 / (i + 1);
      break;
    }
  }

  const recall = expectedNorm.length === 0 ? 0 : matchedExpected.size / expectedNorm.length;

  return {
    nDCG,
    mrr,
    recall,
    relevantFound: matchedExpected.size,
    expectedTotal: expectedNorm.length,
  };
}

function formatNumber(value: number): string {
  return value.toFixed(3);
}

function formatTable(rows: string[][]): string {
  const widths: number[] = [];
  for (const row of rows) {
    row.forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, cell.length);
    });
  }

  return rows
    .map(row => row.map((cell, i) => cell.padEnd(widths[i])).join('  '))
    .join('\n');
}

async function runSearch(query: string, k: number, config: EvalConfig): Promise<CliResponse> {
  // Quote the query to handle multi-word searches
  const safeQuery = query.replace(/"/g, '\\"');
  const args = ['dev', 'search', `"${safeQuery}"`, '--format', 'json', '--limit', String(k)];
  if (config.expand) args.push('--expand');

  const env = { ...process.env };
  if (!config.rerank) env.MEMORY_SEARCH_DISABLE_RERANK = '1';

  return await new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      shell: true,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Search failed with code ${code}`));
        return;
      }

      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error('Search returned empty output.'));
        return;
      }

      try {
        const parsed = JSON.parse(trimmed) as CliResponse;
        resolve(parsed);
      } catch (err) {
        const first = trimmed.indexOf('{');
        const last = trimmed.lastIndexOf('}');
        if (first >= 0 && last > first) {
          try {
            const parsed = JSON.parse(trimmed.slice(first, last + 1)) as CliResponse;
            resolve(parsed);
            return;
          } catch {
            // fall through
          }
        }
        reject(new Error(`Failed to parse JSON output. Raw output:\n${trimmed}`));
      }
    });
  });
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args['help']) {
    console.log('Usage: pnpm tsx scripts/eval.ts [--benchmark path] [--k 5] [--configs baseline,expand] [--verbose]');
    return;
  }

  const benchmarkPath = typeof args['benchmark'] === 'string' ? args['benchmark'] : 'scripts/benchmark.json';
  const benchmarkRaw = await readFile(benchmarkPath, 'utf-8');
  const benchmark = JSON.parse(benchmarkRaw) as BenchmarkFile;

  const kFromArgs = typeof args['k'] === 'string' ? Number(args['k']) : undefined;
  const k = Number.isFinite(kFromArgs) ? (kFromArgs as number) : (benchmark.k ?? 5);

  const configNames = typeof args['configs'] === 'string' ? args['configs'].split(',').map(s => s.trim()) : null;
  const configs = configNames
    ? DEFAULT_CONFIGS.filter(c => configNames.includes(c.name))
    : DEFAULT_CONFIGS;

  if (configs.length === 0) {
    throw new Error('No configs selected. Check --configs values.');
  }

  console.log(`Benchmark: ${benchmark.name ?? 'unnamed'} | Queries: ${benchmark.queries.length} | K=${k}`);
  console.log('Running configs:', configs.map(c => c.name).join(', '));
  console.log('');

  const summaryRows: string[][] = [
    ['Config', 'nDCG@K', 'MRR', 'Recall@K', 'Queries'],
  ];

  for (const config of configs) {
    const perQueryRows: string[][] = [
      ['Query', 'nDCG@K', 'MRR', 'Recall@K', 'Found/Expected'],
    ];

    let ndcgSum = 0;
    let mrrSum = 0;
    let recallSum = 0;

    for (const q of benchmark.queries) {
      const response = await runSearch(q.query, k, config);
      const files = response.results.map(r => r.file);
      const metrics = computeMetrics(files, q.expected, k);

      ndcgSum += metrics.nDCG;
      mrrSum += metrics.mrr;
      recallSum += metrics.recall;

      if (args['verbose']) {
        perQueryRows.push([
          q.id,
          formatNumber(metrics.nDCG),
          formatNumber(metrics.mrr),
          formatNumber(metrics.recall),
          `${metrics.relevantFound}/${metrics.expectedTotal}`,
        ]);
      }
    }

    const count = benchmark.queries.length || 1;
    const avgNDCG = ndcgSum / count;
    const avgMRR = mrrSum / count;
    const avgRecall = recallSum / count;

    summaryRows.push([
      config.name,
      formatNumber(avgNDCG),
      formatNumber(avgMRR),
      formatNumber(avgRecall),
      String(benchmark.queries.length),
    ]);

    console.log(`Config: ${config.name}`);
    console.log(formatTable(summaryRows.slice(0, 1).concat(summaryRows.slice(-1))));
    if (args['verbose']) {
      console.log('');
      console.log(formatTable(perQueryRows));
    }
    console.log('');
  }

  console.log('Summary');
  console.log(formatTable(summaryRows));
}

main().catch(err => {
  console.error('Evaluation failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
