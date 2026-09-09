import OpenAI from 'openai';
import { z } from 'zod';

const Item = z.object({ title: z.string(), date: z.string(), domain: z.string(), url: z.string().url(), summary: z.string().max(600) });
const Result = z.object({ items: z.array(Item).min(0).max(5) });
export type NewsItem = z.infer<typeof Item>;

export class OfficialNewsService {
  constructor(private readonly client: OpenAI | undefined, private readonly model: string | undefined, private readonly allowedDomains: string[]) {}
  async latest(topic = 'environment'): Promise<NewsItem[]> {
    if (!this.client || !this.model) return [];
    const response = await this.client.responses.create({
      model: this.model, store: false, tools: [{ type: 'web_search', filters: { allowed_domains: this.allowedDomains } }],
      include: ['web_search_call.action.sources' as never],
      input: `Find 3 to 5 recent official Indonesian-government news items about ${topic}. Return JSON only: {"items":[{"title":"","date":"","domain":"","url":"","summary":"short English summary"}]}. Do not use any non-official source.`,
    });
    const parsed = Result.safeParse(JSON.parse(response.output_text || '{"items":[]}'));
    if (!parsed.success) return [];
    return parsed.data.items.filter((item) => this.isAllowed(item.url) && this.allowedDomains.includes(item.domain));
  }
  private isAllowed(url: string) { try { const host = new URL(url).hostname.toLowerCase(); return this.allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`)); } catch { return false; } }
}
