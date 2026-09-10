import OpenAI from 'openai';
import type { TrendSummary } from './air-service.js';

export class AirExplanationService {
  constructor(private readonly client: OpenAI | undefined, private readonly model: string | undefined) {}

  async explain(trend: TrendSummary): Promise<string | undefined> {
    if (!this.client || !this.model || !trend.count) return undefined;
    try {
      const response = await this.client.responses.create({
        model: this.model,
        store: false,
        max_output_tokens: 180,
        instructions: 'Explain only the supplied air-quality statistics. Never change, convert, estimate, or invent a number. Call the metric US AQI iQAir, never PSI or official ISPU. Do not give medical advice or claim a cause. Be concise and state that correlation is not causation.',
        input: JSON.stringify(trend),
      });
      const text = response.output_text.trim();
      return text ? `AI explanation (measurements remain provider-sourced):\n${text}` : undefined;
    } catch {
      return undefined;
    }
  }
}
