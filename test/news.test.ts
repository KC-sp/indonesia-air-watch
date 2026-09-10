import { describe, expect, it } from 'vitest';
import { formatNewsItem } from '../src/services/news.js';

describe('official news attribution', () => {
  it('identifies the publisher and direct original source', () => {
    const text = formatNewsItem({
      title: 'Air-quality programme announced',
      date: '2026-09-11',
      publisher: 'Ministry of Environment',
      domain: 'klhk.go.id',
      url: 'https://www.klhk.go.id/news/example-article',
      summary: 'The ministry announced an air-quality programme.',
    });

    expect(text).toContain('Publisher: Ministry of Environment (klhk.go.id)');
    expect(text).toContain('Original source: https://www.klhk.go.id/news/example-article');
  });
});
