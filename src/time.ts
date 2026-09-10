const formatter = (timeZone: string) => new Intl.DateTimeFormat('en-GB', {
  timeZone,
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

export function formatObservationTime(date: Date): string {
  return `${formatter('Asia/Jakarta').format(date)} WIB (${formatter('Asia/Singapore').format(date)} SGT)`;
}

export function formatSingaporeTime(date: Date): string {
  return `${formatter('Asia/Singapore').format(date)} SGT`;
}

export function nextUtcHour(now = new Date()): Date {
  return new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000);
}
