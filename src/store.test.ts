import { describe, expect, it, vi } from 'vitest';
import * as T from './logic';
import { createStore, type KeyValueStorage } from './store';

const config = { storageKey: 'k', snapshotKey: 'k-snaps', maxSnapshots: 3 };

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

function setup(storage = memoryStorage(), onError: (m: string) => void = () => {}) {
  const store = createStore({ storage, config, now: () => 1000, onError });
  store.mutate((s) => T.setupFromOnboarding(s, { rows: [{ name: 'A', start: 5 }, { name: 'B', start: 5 }] }));
  return { store, storage };
}

const logA = (store: ReturnType<typeof setup>['store'], date: string) =>
  store.mutate((s) => T.logSession(s, { exId: T.nextExercise(s)!.id, date, actual: 5 }));

describe('store', () => {
  it('persists and reloads', () => {
    const { store, storage } = setup();
    logA(store, '2026-10-01');
    const again = createStore({ storage, config });
    expect(again.state.log).toHaveLength(1);
  });

  it('a mutation that throws leaves state untouched', () => {
    const { store } = setup();
    expect(() => store.mutate((s) => { T.logSession(s, { exId: 999, actual: 1 }); })).toThrow();
    expect(store.state.log).toHaveLength(0);
  });

  it('keeps only the newest snapshots', () => {
    const { store } = setup();
    for (let i = 1; i <= 6; i++) logA(store, `2026-10-0${i}`);
    expect(store.snapshots()).toHaveLength(3);
  });

  it('restores a snapshot', () => {
    const { store } = setup();
    logA(store, '2026-10-01');
    logA(store, '2026-10-02');
    store.restoreSnapshot(0); // state before the last change
    expect(store.state.log).toHaveLength(1);
  });

  it('preserves corrupt data instead of discarding it', () => {
    const storage = memoryStorage({ k: '{not json' });
    const store = createStore({ storage, config, now: () => 42 });
    expect(store.state.exercises).toHaveLength(0);
    expect(storage.data['k-corrupt-42']).toBe('{not json');
  });

  it('exports and imports', () => {
    const { store } = setup();
    logA(store, '2026-10-01');
    const text = store.exportJSON();
    const other = createStore({ storage: memoryStorage(), config });
    other.importJSON(text);
    expect(other.state.log).toHaveLength(1);
    expect(() => other.importJSON('nope')).toThrow();
  });

  it('reports write failures', () => {
    const onError = vi.fn();
    const storage = memoryStorage();
    const { store } = setup(storage, onError);
    storage.setItem = () => {
      throw new Error('full');
    };
    logA(store, '2026-10-01');
    expect(onError).toHaveBeenCalled();
  });

  it('notifies subscribers', () => {
    const { store } = setup();
    const fn = vi.fn();
    store.subscribe(fn);
    logA(store, '2026-10-01');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('labels snapshots with what was about to change', () => {
    const { store } = setup();
    store.mutate((s) => T.logSession(s, { exId: T.nextExercise(s)!.id, date: '2026-10-01', actual: 5 }), 'finishing a session');
    expect(store.snapshots()[0]!.label).toBe('finishing a session');
  });
});
