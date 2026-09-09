export interface QuotaStore {
  increment(provider: string, bucket: Date): Promise<number>;
  count(provider: string, bucket: Date): Promise<number>;
}

const dayBucket = (date: Date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
const minuteBucket = (date: Date) => new Date(Math.floor(date.getTime() / 60_000) * 60_000);

/** Persistent limiter; callers reserve before every external iQAir request. */
export class IqAirQuota {
  constructor(private readonly store: QuotaStore, private readonly now: () => Date = () => new Date()) {}
  async reserve(): Promise<boolean> {
    const now = this.now();
    if (await this.store.count('iqair:daily', dayBucket(now)) >= 400) return false;
    if (await this.store.count('iqair:minute', minuteBucket(now)) >= 5) return false;
    await this.store.increment('iqair:daily', dayBucket(now));
    await this.store.increment('iqair:minute', minuteBucket(now));
    return true;
  }
}
