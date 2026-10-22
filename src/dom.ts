// DOM plumbing: lookups, form reading, toast, modal, file download.
import { esc } from './format';

export const $ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T | null => root.querySelector<T>(selector);
export const $$ = <T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T[] => [...root.querySelectorAll<T>(selector)];

/** Like $, but throws when the element is missing. For elements index.html guarantees. */
export function must<T extends HTMLElement = HTMLElement>(selector: string, root: ParentNode = document): T {
  const el = $<T>(selector, root);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export type FormValues = Record<string, string | boolean>;

/** Collect every [data-f] control inside root: { fieldName: trimmedString | boolean }. */
export function readForm(root: ParentNode): FormValues {
  const out: FormValues = {};
  for (const el of $$<HTMLInputElement>('[data-f]', root)) out[el.dataset.f ?? ''] = el.type === 'checkbox' ? el.checked : el.value.trim();
  return out;
}

/** String field from readForm values ('' when absent or a checkbox). */
export const text = (v: FormValues, key: string): string => (typeof v[key] === 'string' ? (v[key] as string) : '');

/** readForm for each row matching rowSelector, plus the row's data-id. */
export const readRows = (root: ParentNode, rowSelector: string): (FormValues & { id: string })[] =>
  $$(rowSelector, root).map((row) => ({ ...readForm(row), id: row.dataset.id ?? '' }));

let toastTimer: ReturnType<typeof setTimeout> | undefined;
/** action: { label, run } adds a button (used for Undo). */
export function toast(message: string, action?: { label: string; run: () => void }): void {
  const el = must('#toast');
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button id="toastAction">${esc(action.label)}</button>` : ''}`;
  el.classList.add('show');
  if (action) {
    must('#toastAction').onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 7000 : 3200);
}

export function openModal(html: string): void {
  const modal = must('#modal');
  modal.innerHTML = `<div class="sheet">${html}</div>`;
  modal.classList.add('open');
  modal.onclick = (e) => {
    if (e.target === modal) closeModal();
  };
}
export function closeModal(): void {
  const modal = must('#modal');
  modal.classList.remove('open');
  modal.innerHTML = '';
}

export function download(filename: string, content: string): void {
  const link = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([content], { type: 'application/json' })),
    download: filename,
  });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), 2000);
}

/** Short tap feedback where the device supports it. */
export const buzz = (ms = 15): void => {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not supported */
  }
};
