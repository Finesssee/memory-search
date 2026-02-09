export class ProgressDisplay {
  private startTime: number;
  constructor() { this.startTime = Date.now(); }
  update(phase: string, current: number, total: number, suffix?: string): void {
    if (!process.stderr.isTTY) return;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const elapsed = this.formatElapsed();
    const parts = [`[${phase}] ${current}/${total} (${pct}%) ${elapsed}`];
    if (suffix) parts.push(suffix);
    process.stderr.write(`\r\x1b[K${parts.join(' ')}`);
  }
  clear(): void { if (process.stderr.isTTY) process.stderr.write('\r\x1b[K'); }
  done(message: string): void { this.clear(); process.stderr.write(message + '\n'); }
  formatElapsed(): string {
    const ms = Date.now() - this.startTime;
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  }
  resetTimer(): void { this.startTime = Date.now(); }
}
