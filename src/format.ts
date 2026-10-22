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

/** Minutes per unit as m:ss, e.g. 5.5 becomes "5:30". */
export function paceLabel(minPerUnit: number, unit: string): string {
  const total = Math.round(minPerUnit * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')} /${esc(unit)}`;
}

/** Duration in minutes as m:ss, or h:mm:ss past an hour. */
export function durationLabel(minutes: number): string {
  const total = Math.round(minutes * 60);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = String(total % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
