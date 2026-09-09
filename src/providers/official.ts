import type { Reading } from '../domain/air.js';

export interface OfficialIspuProvider { readonly id: string; getCurrent(location: string): Promise<Reading | undefined>; }

/** No adapter is active until an owner approves a documented, permitted government source. */
export class UnavailableOfficialIspuProvider implements OfficialIspuProvider {
  readonly id = 'official-ispu-unavailable';
  async getCurrent(): Promise<Reading | undefined> { return undefined; }
}
