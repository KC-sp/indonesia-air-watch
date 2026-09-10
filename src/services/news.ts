import OpenAI from 'openai';
import { z } from 'zod';

const Item = z.object({
  title: z.string().min(1),
  date: z.string().min(1),
  publisher: z.string().min(1),
  domain: z.string().min(1),
  url: z.string().url(),
  summary: z.string().min(1).max(600),
});
const Result = z.object({ items: z.array(Item).min(0).max(5) });
export type NewsItem = z.infer<typeof Item>;

export function formatNewsItem(item: NewsItem): string {
  return `${item.title}\nPublished: ${item.date}\nPublisher: ${item.publisher} (${item.domain})\n${item.summary}\nOriginal source: ${item.url}`;
}

export class OfficialNewsService {
  constructor(private readonly client: OpenAI | undefined, private readonly model: string | undefined, private readonly allowedDomains: string[]) {}
  async latest(topic = 'environment'): Promise<NewsItem[]> {
    if (!this.client || !this.model) return [];
    const response = await this.client.responses.create({
      model: this.model, store: false, tools: [{ type: 'web_search', filters: { allowed_domains: this.allowedDomains } }],
      include: ['web_search_call.action.sources' as never],
      input: `Find 3 to 5 recent official Indonesian-government news articles about ${topic}. Open and inspect each original article before including it. The URL must be the direct canonical page where the named government agency originally published the article. Exclude search-result pages, category pages, homepages, social-media posts, aggregators, mirrors, and articles that merely quote an original source. Use the publication date displayed on the original page; do not guess. Summarize only claims supported by that page. Return JSON only: {"items":[{"title":"","date":"","publisher":"official agency name","domain":"official-domain.go.id","url":"direct original article URL","summary":"short English summary"}]}. Do not use any non-official source.`,
    });
    const parsed = Result.safeParse(JSON.parse(response.output_text || '{"items":[]}'));
    if (!parsed.success) return [];
    return parsed.data.items.filter((item) => this.isDirectAllowedArticle(item.url, item.domain));
  }
  private isDirectAllowedArticle(url: string, reportedDomain: string) {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.toLowerCase();
      const domainAllowed = this.allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`));
      const reportedHostMatches = host === reportedDomain.toLowerCase() || host.endsWith(`.${reportedDomain.toLowerCase()}`);
      return parsed.protocol === 'https:' && parsed.pathname !== '/' && domainAllowed && reportedHostMatches;
    } catch {
      return false;
    }
  }
}
