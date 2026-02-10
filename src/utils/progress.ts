export class ProgressDisplay {
  private startTime: number;
  private isTTY: boolean;
  constructor() {
    this.startTime = Date.now();
    this.isTTY = !!process.stderr.isTTY;
  }
  update(phase: string, current: number, total: number, suffix?: string): void {
    if (!this.isTTY) return;
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const elapsed = this.formatElapsed();
    const parts = [`[${phase}] ${current}/${total} (${pct}%) ${elapsed}`];
    if (suffix) parts.push(suffix);
    process.stderr.write(`\r\x1b[K${parts.join(' ')}`);
    this.emitOsc(pct);
  }
  clear(): void {
    if (!this.isTTY) return;
    process.stderr.write('\r\x1b[K');
    this.clearOsc();
  }
  done(message: string): void { this.clear(); process.stderr.write(message + '\n'); }
  formatElapsed(): string {
    const ms = Date.now() - this.startTime;
    if (ms < 1000) return `${ms}ms`;
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    return `${Math.floor(s / 60)}m${s % 60}s`;
  }
  resetTimer(): void { this.startTime = Date.now(); }
  private emitOsc(percent: number): void {
    if (!this.isTTY) return;
    const pct = Math.max(0, Math.min(100, Math.round(percent)));
    process.stderr.write(`\x1b]9;4;1;${pct}\x1b\\`);
  }
  private clearOsc(): void {
    if (!this.isTTY) return;
    process.stderr.write(`\x1b]9;4;0;0\x1b\\`);
  }
}
