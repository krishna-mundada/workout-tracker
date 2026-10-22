// Persistence. Owns the state, saves it, keeps undo snapshots, handles backup import/export.
// Storage is injected so it can be swapped for a fake in tests or a server later.
import { migrate, newState } from './logic';
import type { State } from './types';

export interface StoreConfig {
  storageKey: string;
  snapshotKey: string;
  maxSnapshots: number;
}

/** The slice of localStorage the store needs. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface StoreOptions {
  storage: KeyValueStorage | null;
  config: StoreConfig;
  now?: () => number;
  /** Called when a write fails. */
  onError?: (message: string) => void;
}

export interface SnapshotInfo {
  ts: number;
  entries: number;
  /** What was about to change when this copy was taken. */
  label: string;
}

interface RawSnapshot {
  ts: number;
  data: string;
  label?: string;
}

export type Store = ReturnType<typeof createStore>;

export function createStore({ storage, config, now = Date.now, onError = () => {} }: StoreOptions) {
  const read = (key: string): string | null => {
    try {
      return storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  };
  const write = (key: string, value: string): boolean => {
    try {
      if (!storage) return false;
      storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };

  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((fn) => fn());

  function load(): State {
    const raw = read(config.storageKey);
    if (!raw) return newState();
    try {
      return migrate(JSON.parse(raw));
    } catch {
      write(`${config.storageKey}-corrupt-${now()}`, raw); // never throw away data we could not read
      return newState();
    }
  }
  let state = load();

  const persist = (): void => {
    if (!write(config.storageKey, JSON.stringify(state))) onError('Could not save. Storage may be full or blocked.');
  };

  function rawSnapshots(): RawSnapshot[] {
    try {
      return JSON.parse(read(config.snapshotKey) || '[]');
    } catch {
      return [];
    }
  }
  function takeSnapshot(label?: string) {
    if (!state.exercises.length) return; // nothing worth restoring yet
    const list = [{ ts: now(), data: JSON.stringify(state), label }, ...rawSnapshots()].slice(0, config.maxSnapshots);
    write(config.snapshotKey, JSON.stringify(list));
  }

  function commit(next: State, label?: string): void {
    takeSnapshot(label);
    state = next;
    persist();
    emit();
  }

  return {
    get state(): State {
      return state;
    },

    /** Call fn(draft) on a copy of the state. Commits only if fn does not throw; returns fn's result. */
    mutate<T>(fn: (draft: State) => T, label?: string): T {
      const draft = structuredClone(state);
      const result = fn(draft);
      commit(draft, label);
      return result;
    },

    /** Replace the whole state (setup, import, erase). */
    replace(next: State, label?: string): void {
      commit(next, label);
    },

    subscribe(fn: () => void): () => boolean {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },

    /** Undo points, newest first: [{ ts, entries }]. Restore by index. */
    snapshots(): SnapshotInfo[] {
      return rawSnapshots().map(({ ts, data, label }) => {
        let entries = 0;
        try {
          entries = JSON.parse(data).log.length;
        } catch {
          /* unreadable snapshot: show 0 */
        }
        return { ts, entries, label: label ?? '' };
      });
    },
    restoreSnapshot(index: number): void {
      const snap = rawSnapshots()[index];
      if (!snap) throw new Error('Snapshot not found.');
      commit(migrate(JSON.parse(snap.data)), 'restoring a snapshot');
    },

    exportJSON: (pretty = false): string => JSON.stringify(state, null, pretty ? 2 : 0),
    importJSON(text: string): void {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new Error('That is not valid backup text.');
      }
      commit(migrate(parsed), 'importing a backup');
    },
    markBackup(): void {
      state.settings.lastBackup = now();
      persist();
      emit();
    },

    /** Small flags that are not part of the workout data (e.g. a dismissed banner). */
    getFlag: (key: string): string | null => read(key),
    setFlag: (key: string, value: string): boolean => write(key, value),
  };
}
