/** One way to say when a look was made: «4 ноября, 18:07», the year only when it isn't this one. */
export function formatLookDate(timestamp: number, locale?: string, now = Date.now()): string {
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleString(locale, { day: 'numeric', month: 'long', ...(sameYear ? {} : { year: 'numeric' }), hour: '2-digit', minute: '2-digit' });
}
