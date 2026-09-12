import { describe, expect, it } from 'vitest';
import { classifyOpenAiError } from '../src/services/diagnostics.js';

describe('OpenAI diagnostics', () => {
  it('distinguishes authentication, model, and quota failures', () => {
    expect(classifyOpenAiError({ status: 401 })).toBe('Authentication failed');
    expect(classifyOpenAiError({ status: 404 })).toBe('Model unavailable');
    expect(classifyOpenAiError({ status: 429 })).toBe('Quota or rate limit reached');
  });
});
