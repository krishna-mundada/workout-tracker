// Small formatting helpers shared by every view.
import { r, parseISO } from './logic';

/** Escape text for safe use inside HTML. Anything the user can type goes through this. */
const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);

export const fmt = (n: number): string => r(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
export const signed = (n: number): string => (n > 0 ? '+' : '') + fmt(n);
export const amount = (value: number, unit: string): string => `${fmt(value)} ${esc(unit)}`;

export const longDate = (iso: string): string => parseISO(iso).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
export const shortDate = (iso: string): string => parseISO(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
