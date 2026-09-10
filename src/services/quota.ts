export interface QuotaStore {
  increment(provider: string, bucket: Date): Promise<number>;
  count(provider: string, bucket: Date): Promise<number>;
}

const dayBucket = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const minuteBucket = (date: Date) => new Date(Math.floor(date.getTime() / 60_000) * 60_000);

/** Persistent limiter; callers reserve before every external iQAir request. */
export class IqAirQuota {
  constructor(private readonly store: QuotaStore, private readonly now: () => Date = () => new Date(), private readonly sleep: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) {}
  async reserve(): Promise<boolean> {
    const now = this.now();
    if (await this.store.count('iqair:daily', dayBucket(now)) >= 400) return false;
    if (await this.store.count('iqair:minute', minuteBucket(now)) >= 5) return false;
    await this.store.increment('iqair:daily', dayBucket(now));
    await this.store.increment('iqair:minute', minuteBucket(now));
    return true;
  }

  async reserveWhenAvailable(maxWaitMilliseconds = 185_000): Promise<boolean> {
    const deadline = this.now().getTime() + maxWaitMilliseconds;
    while (this.now().getTime() <= deadline) {
      const now = this.now();
      if (await this.store.count('iqair:daily', dayBucket(now)) >= 400) return false;
      if (await this.reserve()) return true;
      const wait = Math.min(60_050 - (now.getTime() % 60_000), Math.max(0, deadline - now.getTime()));
      if (wait <= 0) return false;
      await this.sleep(wait);
    }
    return false;
  }

  async usage(now = this.now()): Promise<{ minute: number; daily: number }> {
    return {
      minute: await this.store.count('iqair:minute', minuteBucket(now)),
      daily: await this.store.count('iqair:daily', dayBucket(now)),
    };
  }
}
