// Tiny HTML building blocks. Views compose these instead of repeating markup.
// Form controls carry data-f="<name>" so dom.readForm can collect them without per-field ids.
import { esc, signed } from './format';

/** Coloured dot that tags an exercise by name. */
export const dot = (color: string): string => `<i class="d" style="--ex:${esc(color)}"></i>`;

/** Green/orange pill for a surplus or deficit. */
export function chip(n: number, unit?: string): string {
  const cls = n > 0 ? 'chip' : n < 0 ? 'chip neg' : 'chip zero';
  const suffix = unit && unit !== 'reps' ? ` ${esc(unit)}` : '';
  return `<span class="${cls}">${signed(n)}${suffix}</span>`;
}

export const field = (label: string, control: string): string => `<label>${label}</label>${control}`;

const attr = (name: string, value: string | number | undefined): string => (value === '' || value === undefined ? '' : ` ${name}="${esc(value)}"`);

/** Text input. Use mode: 'decimal' for positive numbers; leave it off where a minus sign must be typeable. */
export interface TextInputOpts {
  value?: string | number;
  placeholder?: string;
  mode?: 'decimal' | 'numeric' | '';
  maxlength?: number | '';
  extra?: string;
}
export const textInput = (f: string, { value = '', placeholder = '', mode = '', maxlength = '', extra = '' }: TextInputOpts = {}): string =>
  `<input type="text" data-f="${f}"${attr('value', value)}${attr('placeholder', placeholder)}${attr('inputmode', mode)}` +
  `${attr('maxlength', maxlength)} autocapitalize="none" autocomplete="off"${extra ? ` ${extra}` : ''}>`;

export interface Option {
  value: string | number;
  label: string;
}
export const select = (f: string, options: Option[], selected: string | number): string =>
  `<select data-f="${f}">${options
    .map((o) => `<option value="${esc(o.value)}"${String(o.value) === String(selected) ? ' selected' : ''}>${esc(o.label)}</option>`)
    .join('')}</select>`;

export const card = (body: string, { cls = '', style = '' }: { cls?: string; style?: string } = {}): string =>
  `<section class="card ${cls}"${style ? ` style="${style}"` : ''}>${body}</section>`;

/** Row of big numbers with captions. stats: [{ value, label, color? }] */
export interface Stat {
  value: string | number;
  label: string;
  color?: string;
}
export const statGrid = (stats: Stat[]): string =>
  `<div class="grid3">${stats
    .map(({ value, label, color }) => `<div><b${color ? ` style="color:${color}"` : ''}>${value}</b><span>${label}</span></div>`)
    .join('')}</div>`;

/** Label on the left, value on the right. rows: [[leftHtml, rightHtml]] */
export const listRows = (rows: [string, string][]): string => `<div class="list">${rows.map(([left, right]) => `<div><span>${left}</span>${right}</div>`).join('')}</div>`;

/** Button wired to an action in app.js via data-act. data becomes data-* attributes. */
export function button(
  label: string,
  act: string,
  { cls = 'ghost', data = {}, aria = '' }: { cls?: string; data?: Record<string, string | number>; aria?: string } = {},
): string {
  const dataAttrs = Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('');
  return `<button class="${cls}" data-act="${act}"${dataAttrs}${attr('aria-label', aria)}>${esc(label)}</button>`;
}

export const banner = (body: string, tone: 'warn' | 'ok' = 'warn'): string => `<div class="banner${tone === 'ok' ? ' ok' : ''}">${body}</div>`;
