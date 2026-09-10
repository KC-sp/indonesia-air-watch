import { describe, expect, it } from 'vitest';
import { createTrendGraph } from '../src/services/trend-graph.js';

describe('trend graph', () => {
  it('creates a valid PNG from stored observations', () => {
    const image = createTrendGraph([{ observedAt: new Date('2026-01-01T00:00:00Z'), value: 80 }, { observedAt: new Date('2026-01-01T01:00:00Z'), value: 160 }]);
    expect([...image.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(image.length).toBeGreaterThan(1_000);
  });
});
