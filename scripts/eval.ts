import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { basename } from 'node:path';

interface BenchmarkQuery {
    id: string;
    query: string;
    expected: string[];
    notes?: string;
    category?: string;
    difficulty?: string;
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
    precision: number;
    relevantFound: number;
    expectedTotal: number;
    latencyMs: number;
    tokensUsed: number;
}

interface CategoryMetrics {
    category: string;
    avgNDCG: number;
    avgMRR: number;
    avgRecall: number;
    avgPrecision: number;
    avgLatencyMs: number;
    avgTokens: number;
    queryCount: number;
}

interface ConfigSummary {
    config: string;
    avgNDCG: number;
    avgMRR: number;
    avgRecall: number;
    avgPrecision: number;
    avgLatencyMs: number;
    totalTokens: number;
    avgTokensPerQuery: number;
    queryCount: number;
    categories: CategoryMetrics[];
    perQuery?: { id: string; metrics: QueryMetrics }[];
}

interface EvalOutput {
    benchmark: string;
    k: number;
    timestamp: string;
    configs: ConfigSummary[];
    summary: {
        avgNDCG: number;
        avgMRR: number;
        avgRecall: number;
        avgPrecision: number;
        totalQueries: number;
        totalTokens: number;
        avgLatencyMs: number;
    };
}

interface BaselineComparison {
    config: string;
    metric: string;
    before: number;
    after: number;
    delta: number;
    regression: boolean;
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
    const normalized = value.replace(/\\/g, '/').replace(/[\uE000-\uF8FF]/g, '');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function matchesExpected(resultFile: string, expected: string): boolean {
    const resultNorm = normalizePath(resultFile);
    const expectedNorm = normalizePath(expected);

    const hasSeparator = expectedNorm.includes('/');
    if (!hasSeparator) {
        if (basename(resultNorm) === expectedNorm) return true;
        return resultNorm.includes('/' + expectedNorm + '/');
    }
    if (resultNorm.endsWith(expectedNorm)) return true;
    const expectedFolder = expectedNorm.split('/').slice(0, -1).join('/');
    if (expectedFolder && resultNorm.includes('/' + expectedFolder + '/')) return true;
    return false;
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
}

function computeMetrics(
    results: CliResult[],
    expected: string[],
    k: number,
    latencyMs: number,
): QueryMetrics {
    const topResults = results.slice(0, k);
    const relevances: number[] = [];
    const matchedExpected = new Set<string>();

    for (const result of topResults) {
        let isRel = false;
        for (const exp of expected) {
            if (matchesExpected(result.file, exp)) {
                isRel = true;
                matchedExpected.add(normalizePath(exp));
            }
        }
        relevances.push(isRel ? 1 : 0);
    }

    // nDCG
    let dcg = 0;
    for (let i = 0; i < relevances.length; i++) {
        if (relevances[i] > 0) dcg += relevances[i] / Math.log2(i + 2);
    }
    const idealCount = Math.min(expected.length, k);
    let idcg = 0;
    for (let i = 0; i < idealCount; i++) idcg += 1 / Math.log2(i + 2);
    const nDCG = idcg === 0 ? 0 : dcg / idcg;

    // MRR
    let mrr = 0;
    for (let i = 0; i < relevances.length; i++) {
        if (relevances[i] > 0) { mrr = 1 / (i + 1); break; }
    }

    // Recall
    const recall = expected.length === 0 ? 0 : matchedExpected.size / expected.length;

    // Precision
    const relevant = relevances.reduce((a, b) => a + b, 0);
    const precision = topResults.length === 0 ? 0 : relevant / topResults.length;

    // Tokens
    const tokensUsed = topResults.reduce((sum, r) => sum + estimateTokens(r.snippet), 0);

    return { nDCG, mrr, recall, precision, relevantFound: matchedExpected.size, expectedTotal: expected.length, latencyMs, tokensUsed };
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

async function runSearch(query: string, k: number, config: EvalConfig): Promise<{ response: CliResponse; latencyMs: number }> {
    const safeQuery = query.replace(/"/g, '\\"');
    const args = ['dev', 'search', `"${safeQuery}"`, '--format', 'json', '--limit', String(k)];
    if (config.expand) args.push('--expand');

    const env = { ...process.env };
    if (!config.rerank) env.MEMORY_SEARCH_DISABLE_RERANK = '1';

    const start = performance.now();

    const response = await new Promise<CliResponse>((resolve, reject) => {
        const child = spawn('pnpm', args, {
            shell: true,
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', chunk => { stdout += chunk.toString(); });
        child.stderr.on('data', chunk => { stderr += chunk.toString(); });

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
                resolve(JSON.parse(trimmed) as CliResponse);
            } catch {
                const first = trimmed.indexOf('{');
                const last = trimmed.lastIndexOf('}');
                if (first >= 0 && last > first) {
                    try {
                        resolve(JSON.parse(trimmed.slice(first, last + 1)) as CliResponse);
                        return;
                    } catch { /* fall through */ }
                }
                reject(new Error(`Failed to parse JSON output. Raw output:\n${trimmed}`));
            }
        });
    });

    const latencyMs = Math.round(performance.now() - start);
    return { response, latencyMs };
}

function computeCategoryMetrics(
    perQuery: { id: string; category: string; metrics: QueryMetrics }[],
): CategoryMetrics[] {
    const groups = new Map<string, QueryMetrics[]>();
    for (const q of perQuery) {
        const cat = q.category || 'uncategorized';
        if (!groups.has(cat)) groups.set(cat, []);
        groups.get(cat)!.push(q.metrics);
    }

    const result: CategoryMetrics[] = [];
    for (const [category, metrics] of groups) {
        const n = metrics.length;
        result.push({
            category,
            avgNDCG: metrics.reduce((s, m) => s + m.nDCG, 0) / n,
            avgMRR: metrics.reduce((s, m) => s + m.mrr, 0) / n,
            avgRecall: metrics.reduce((s, m) => s + m.recall, 0) / n,
            avgPrecision: metrics.reduce((s, m) => s + m.precision, 0) / n,
            avgLatencyMs: metrics.reduce((s, m) => s + m.latencyMs, 0) / n,
            avgTokens: metrics.reduce((s, m) => s + m.tokensUsed, 0) / n,
            queryCount: n,
        });
    }
    return result.sort((a, b) => b.avgNDCG - a.avgNDCG);
}

function compareBaseline(baseline: EvalOutput, current: EvalOutput): BaselineComparison[] {
    const comparisons: BaselineComparison[] = [];
    const metricKeys: (keyof Pick<ConfigSummary, 'avgNDCG' | 'avgMRR' | 'avgRecall' | 'avgPrecision'>)[] =
        ['avgNDCG', 'avgMRR', 'avgRecall', 'avgPrecision'];

    for (const curr of current.configs) {
        const base = baseline.configs.find(b => b.config === curr.config);
        if (!base) continue;

        for (const key of metricKeys) {
            const before = base[key];
            const after = curr[key];
            const delta = after - before;
            comparisons.push({
                config: curr.config,
                metric: key.replace('avg', ''),
                before,
                after,
                delta,
                regression: delta < -0.01, // > 1% drop = regression
            });
        }
    }
    return comparisons;
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (args['help']) {
        console.log(`Usage: pnpm tsx scripts/eval.ts [options]

Options:
  --benchmark <path>    Benchmark file path (default: scripts/benchmark.json)
  --k <n>               Number of results to evaluate (default: from benchmark or 5)
  --configs <list>      Comma-separated config names (default: all)
  --verbose             Show per-query breakdown
  --json                Output machine-readable JSON
  --baseline <path>     Save results as baseline JSON
  --compare <path>      Compare against a saved baseline
  --help                Show this help`);
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

    const isJson = args['json'] === true;
    const isVerbose = args['verbose'] === true;

    if (!isJson) {
        console.log(`Benchmark: ${benchmark.name ?? 'unnamed'} | Queries: ${benchmark.queries.length} | K=${k}`);
        console.log('Running configs:', configs.map(c => c.name).join(', '));
        console.log('');
    }

    const evalOutput: EvalOutput = {
        benchmark: benchmark.name ?? basename(benchmarkPath),
        k,
        timestamp: new Date().toISOString(),
        configs: [],
        summary: { avgNDCG: 0, avgMRR: 0, avgRecall: 0, avgPrecision: 0, totalQueries: 0, totalTokens: 0, avgLatencyMs: 0 },
    };

    const summaryRows: string[][] = [
        ['Config', 'nDCG@K', 'MRR', 'Recall@K', 'Prec@K', 'Latency', 'Tokens', 'Queries'],
    ];

    for (const config of configs) {
        const perQueryData: { id: string; category: string; metrics: QueryMetrics }[] = [];
        const perQueryRows: string[][] = [
            ['Query', 'nDCG@K', 'MRR', 'Recall@K', 'Prec@K', 'Latency', 'Tokens', 'Found/Expected'],
        ];

        let ndcgSum = 0, mrrSum = 0, recallSum = 0, precisionSum = 0;
        let latencySum = 0, tokenSum = 0;

        for (const q of benchmark.queries) {
            const { response, latencyMs } = await runSearch(q.query, k, config);
            const metrics = computeMetrics(response.results, q.expected, k, latencyMs);

            ndcgSum += metrics.nDCG;
            mrrSum += metrics.mrr;
            recallSum += metrics.recall;
            precisionSum += metrics.precision;
            latencySum += metrics.latencyMs;
            tokenSum += metrics.tokensUsed;

            const category = q.category || q.notes || 'uncategorized';
            perQueryData.push({ id: q.id, category, metrics });

            if (isVerbose) {
                perQueryRows.push([
                    q.id,
                    formatNumber(metrics.nDCG),
                    formatNumber(metrics.mrr),
                    formatNumber(metrics.recall),
                    formatNumber(metrics.precision),
                    `${metrics.latencyMs}ms`,
                    String(metrics.tokensUsed),
                    `${metrics.relevantFound}/${metrics.expectedTotal}`,
                ]);
            }
        }

        const count = benchmark.queries.length || 1;
        const avgNDCG = ndcgSum / count;
        const avgMRR = mrrSum / count;
        const avgRecall = recallSum / count;
        const avgPrecision = precisionSum / count;
        const avgLatencyMs = Math.round(latencySum / count);

        const categories = computeCategoryMetrics(perQueryData);

        const configSummary: ConfigSummary = {
            config: config.name,
            avgNDCG,
            avgMRR,
            avgRecall,
            avgPrecision,
            avgLatencyMs,
            totalTokens: tokenSum,
            avgTokensPerQuery: Math.round(tokenSum / count),
            queryCount: count,
            categories,
            ...(isVerbose ? { perQuery: perQueryData.map(d => ({ id: d.id, metrics: d.metrics })) } : {}),
        };
        evalOutput.configs.push(configSummary);

        summaryRows.push([
            config.name,
            formatNumber(avgNDCG),
            formatNumber(avgMRR),
            formatNumber(avgRecall),
            formatNumber(avgPrecision),
            `${avgLatencyMs}ms`,
            String(tokenSum),
            String(count),
        ]);

        if (!isJson) {
            console.log(`Config: ${config.name}`);
            console.log(formatTable(summaryRows.slice(0, 1).concat(summaryRows.slice(-1))));

            if (isVerbose) {
                console.log('');
                console.log(formatTable(perQueryRows));
            }

            // Category breakdown
            if (categories.length > 1) {
                console.log('');
                console.log('  Category breakdown:');
                const catRows: string[][] = [['  Category', 'nDCG', 'MRR', 'Recall', 'Prec', 'Queries']];
                for (const cat of categories) {
                    catRows.push([
                        `  ${cat.category}`,
                        formatNumber(cat.avgNDCG),
                        formatNumber(cat.avgMRR),
                        formatNumber(cat.avgRecall),
                        formatNumber(cat.avgPrecision),
                        String(cat.queryCount),
                    ]);
                }
                console.log(formatTable(catRows));
            }
            console.log('');
        }
    }

    // Compute overall summary (average across configs)
    const numConfigs = evalOutput.configs.length || 1;
    evalOutput.summary = {
        avgNDCG: evalOutput.configs.reduce((s, c) => s + c.avgNDCG, 0) / numConfigs,
        avgMRR: evalOutput.configs.reduce((s, c) => s + c.avgMRR, 0) / numConfigs,
        avgRecall: evalOutput.configs.reduce((s, c) => s + c.avgRecall, 0) / numConfigs,
        avgPrecision: evalOutput.configs.reduce((s, c) => s + c.avgPrecision, 0) / numConfigs,
        totalQueries: evalOutput.configs.reduce((s, c) => s + c.queryCount, 0),
        totalTokens: evalOutput.configs.reduce((s, c) => s + c.totalTokens, 0),
        avgLatencyMs: Math.round(evalOutput.configs.reduce((s, c) => s + c.avgLatencyMs, 0) / numConfigs),
    };

    // JSON output
    if (isJson) {
        console.log(JSON.stringify(evalOutput, null, 2));
    } else {
        console.log('Summary');
        console.log(formatTable(summaryRows));
    }

    // Save baseline
    if (typeof args['baseline'] === 'string') {
        await writeFile(args['baseline'], JSON.stringify(evalOutput, null, 2));
        if (!isJson) console.log(`\nBaseline saved to ${args['baseline']}`);
    }

    // Compare against baseline
    if (typeof args['compare'] === 'string') {
        try {
            const baselineRaw = await readFile(args['compare'], 'utf-8');
            const baseline = JSON.parse(baselineRaw) as EvalOutput;
            const comparisons = compareBaseline(baseline, evalOutput);

            if (isJson) {
                // Already included in output, add comparisons
                console.log(JSON.stringify({ ...evalOutput, comparisons }, null, 2));
            } else {
                console.log('\nRegression Detection:');
                const hasRegression = comparisons.some(c => c.regression);
                for (const c of comparisons) {
                    const sign = c.delta >= 0 ? '+' : '';
                    const icon = c.regression ? '⚠️' : '✓';
                    console.log(`  ${c.config}: ${c.metric} ${formatNumber(c.before)} → ${formatNumber(c.after)} (${sign}${formatNumber(c.delta)}) ${icon}`);
                }
                if (hasRegression) {
                    console.log('\n⚠️  Regressions detected! Review changes before merging.');
                } else {
                    console.log('\n✓ No regressions detected.');
                }
            }
        } catch (err) {
            console.error(`Failed to load baseline from ${args['compare']}:`, err instanceof Error ? err.message : err);
        }
    }
}

main().catch(err => {
    console.error('Evaluation failed:', err instanceof Error ? err.message : err);
    process.exit(1);
});
