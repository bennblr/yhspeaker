import fs from 'node:fs';
import path from 'node:path';
import {
  STATS_BUCKET_MS,
  STATS_SAMPLE_MS,
  statsDateKey,
  summarizeOnlineStats,
  type OnlineStatsDay,
  type OnlineStatsFile,
  type OnlineStatsSummary,
} from '@tsds/shared';
import type { SessionService } from './session.js';

const RETENTION_DAYS = 180;

function emptyFile(): OnlineStatsFile {
  return { version: 1, days: {} };
}

export class StatsRecorder {
  private readonly file: string;
  private data: OnlineStatsFile = emptyFile();
  private timer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private present = new Set<string>();
  private lastSampleAt = Date.now();
  private dirty = false;

  constructor(
    private readonly sessions: SessionService,
    dataDir: string,
  ) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.file = path.join(dataDir, 'stats.json');
    if (fs.existsSync(this.file)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8')) as OnlineStatsFile;
        if (parsed && parsed.version === 1 && parsed.days) this.data = parsed;
      } catch (error) {
        console.warn(`[stats] не удалось прочитать ${this.file}: ${(error as Error).message}`);
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.lastSampleAt = Date.now();
    this.sample();
    this.timer = setInterval(() => this.sample(), STATS_SAMPLE_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.saveNow();
  }

  private ensureDay(ts: number): OnlineStatsDay {
    const date = statsDateKey(ts);
    let day = this.data.days[date];
    if (!day) {
      day = { date, buckets: [], users: {} };
      this.data.days[date] = day;
    }
    return day;
  }

  private sample(): void {
    const now = Date.now();
    const elapsed = Math.max(0, Math.min(STATS_SAMPLE_MS * 2, now - this.lastSampleAt));
    this.lastSampleAt = now;

    const online = this.sessions.list();
    // Считаем людей, а не подключения: несколько устройств — один человек.
    const unique = new Map<string, (typeof online)[number]>();
    for (const user of online) {
      if (!unique.has(user.id)) unique.set(user.id, user);
    }
    const day = this.ensureDay(now);
    const bucketT = Math.floor(now / STATS_BUCKET_MS) * STATS_BUCKET_MS;
    let bucket = day.buckets.find((item) => item.t === bucketT);
    if (!bucket) {
      bucket = { t: bucketT, sum: 0, samples: 0, peak: 0 };
      day.buckets.push(bucket);
    }
    bucket.sum += unique.size;
    bucket.samples += 1;
    bucket.peak = Math.max(bucket.peak, unique.size);

    const current = new Set<string>();
    for (const user of unique.values()) {
      current.add(user.id);
      const entry = (day.users[user.id] ??= {
        userId: user.id,
        displayName: user.displayName,
        guest: user.isGuest,
        seconds: 0,
        sessions: 0,
        lastSeen: now,
      });
      entry.displayName = user.displayName;
      entry.guest = user.isGuest;
      entry.seconds += elapsed / 1000;
      entry.lastSeen = now;
      if (!this.present.has(user.id)) entry.sessions += 1;
    }
    this.present = current;

    this.dirty = true;
    this.saveSoon();
  }

  private saveSoon(): void {
    if (this.saveTimer || !this.dirty) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, 5_000);
    this.saveTimer.unref();
  }

  private saveNow(): void {
    if (!this.dirty) return;
    this.prune();
    this.dirty = false;
    const tmp = `${this.file}.tmp`;
    try {
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (error) {
      console.warn(`[stats] не удалось сохранить ${this.file}: ${(error as Error).message}`);
    }
  }

  private prune(): void {
    const cutoff = statsDateKey(Date.now() - RETENTION_DAYS * 86_400_000);
    for (const date of Object.keys(this.data.days)) {
      if (date < cutoff) delete this.data.days[date];
    }
  }

  summary(days: number): OnlineStatsSummary {
    const now = Date.now();
    const from = now - days * 86_400_000;
    const cutoff = statsDateKey(from);
    const list = Object.values(this.data.days).filter((day) => day.date >= cutoff);
    return summarizeOnlineStats(list, from, now);
  }

  snapshot(): OnlineStatsFile {
    return this.data;
  }
}
