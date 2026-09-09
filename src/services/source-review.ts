import type { PrismaClient } from '@prisma/client';
import OpenAI from 'openai';
import { z } from 'zod';

const Candidate = z.object({ agency: z.string().min(1), domain: z.string().min(1), metric: z.string().min(1), period: z.string().min(1), coverage: z.string().min(1), updateFrequency: z.string().min(1), latestTimestamp: z.string().min(1), endpoint: z.string().url(), permission: z.string().min(1), confidenceScore: z.number().int().min(0).max(100), recommendation: z.enum(['approve', 'reject', 'review']) });
const Discovery = z.object({ candidates: z.array(Candidate).max(5) });
export type SourceCandidateResult = z.infer<typeof Candidate> & { id?: string };

/** AI may assess sources, but deterministic approved adapters alone can retrieve operational readings. */
export class SourceReviewService {
  constructor(private readonly db: PrismaClient, private readonly client: OpenAI | undefined, private readonly model: string | undefined, private readonly allowedDomains: string[]) {}
  async discover(): Promise<SourceCandidateResult[]> {
    if (!this.client || !this.model) return [];
    const response = await this.client.responses.create({ model: this.model, store: false, tools: [{ type: 'web_search', filters: { allowed_domains: this.allowedDomains } }], include: ['web_search_call.action.sources' as never], input: 'Assess only official Indonesian-government, public, documented, permitted, machine-readable ISPU sources. Return JSON {"candidates":[{"agency":"","domain":"","metric":"","period":"","coverage":"","updateFrequency":"","latestTimestamp":"","endpoint":"https://","permission":"","confidenceScore":0,"recommendation":"approve|reject|review"}]}. Reject ambiguous timestamps, unofficial sources, AQI/PSI misuse, access-control bypasses, and brittle scraping.' });
    const parsed = Discovery.safeParse(JSON.parse(response.output_text || '{"candidates":[]}'));
    if (!parsed.success) return [];
    const safe = parsed.data.candidates.filter((candidate) => this.isAllowed(candidate.domain) && this.isAllowed(candidate.endpoint));
    return Promise.all(safe.map(async (candidate) => {
      const stored = await this.db.sourceCandidate.create({ data: { agency: candidate.agency, domain: candidate.domain, confidenceScore: candidate.confidenceScore, recommendation: candidate.recommendation, details: candidate } });
      return { ...candidate, id: stored.id };
    }));
  }
  async approve(candidateId: string, confirmation: string, ownerId: string): Promise<'approved' | 'confirm' | 'missing'> {
    if (confirmation !== 'CONFIRM') return 'confirm';
    const candidate = await this.db.sourceCandidate.findUnique({ where: { id: candidateId } });
    if (!candidate) return 'missing';
    await this.db.approvedSource.upsert({ where: { candidateId }, create: { candidateId, approvedBy: ownerId, config: { enabled: false, note: 'Approval records review only; a deterministic adapter must still be configured.' } }, update: { approvedBy: ownerId, approvedAt: new Date() } });
    return 'approved';
  }
  private isAllowed(value: string) { try { const host = value.includes('://') ? new URL(value).hostname : value; return this.allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`)); } catch { return false; } }
}
