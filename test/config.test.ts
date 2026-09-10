import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('Railway configuration', () => {
  it('treats blank optional integrations as disabled', () => {
    const config = loadConfig({ OFFICIAL_ISPU_API_URL: '', OPENAI_API_KEY: '', OPENAI_MODEL: '', NODE_ENV: 'production' });
    expect(config.OFFICIAL_ISPU_API_URL).toBeUndefined();
    expect(config.OPENAI_API_KEY).toBeUndefined();
    expect(config.NODE_ENV).toBe('production');
  });
  it('supports five tracked locations by default and up to ten when configured', () => {
    expect(loadConfig({}).TRACKED_IQAIR_CITY_LIMIT).toBe(5);
    expect(loadConfig({ TRACKED_IQAIR_CITY_LIMIT: '10' }).TRACKED_IQAIR_CITY_LIMIT).toBe(10);
  });
});
