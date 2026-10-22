// Cloud sync: the whole state is one JSON document per user in Supabase, with the phone copy
// staying the source of truth offline. Conflicts (both sides changed) are never merged silently.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { migrate } from './logic';
import type { Store } from './store';
import type { State } from './types';

export type SyncAction = 'none' | 'push' | 'pull' | 'conflict';

export interface SyncPlanInput {
  /** updated_at of the cloud copy, or null when the cloud has nothing yet. */
  remote: string | null;
  /** updated_at of the cloud copy as of our last successful sync. */
  knownRemote: string | null;
  /** This device changed since the last sync. */
  dirty: boolean;
  /** Nothing set up on this device yet. */
  localEmpty: boolean;
}

/** Pure decision: what to do given what each side knows. */
export function planSync({ remote, knownRemote, dirty, localEmpty }: SyncPlanInput): SyncAction {
  if (remote === null) return localEmpty ? 'none' : 'push';
  if (localEmpty) return 'pull';
  if (remote === knownRemote) return dirty ? 'push' : 'none';
  if (knownRemote === null || dirty) return 'conflict';
  return 'pull';
}

export type SyncStatus = 'signedOut' | 'idle' | 'syncing' | 'error' | 'conflict';

export interface SyncView {
  status: SyncStatus;
  email: string | null;
  lastSynced: number | null;
  message: string;
  conflict: { cloudSessions: number; phoneSessions: number } | null;
}

export interface SyncConfig {
  url: string;
  publishableKey: string;
  dirtyKey: string;
  remoteTsKey: string;
  lastSyncKey: string;
  pushDelayMs: number;
}

interface RemoteRow {
  state: unknown;
  updated_at: string;
}

export interface CloudSync {
  view(): SyncView;
  client(): SupabaseClient;
  userId(): string | null;
  init(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  syncNow(): Promise<void>;
  resolve(choice: 'cloud' | 'phone'): Promise<void>;
}

export function createSync({ store, config, onChange }: { store: Store; config: SyncConfig; onChange: () => void }): CloudSync {
  const client = createClient(config.url, config.publishableKey);
  const view: SyncView = { status: 'signedOut', email: null, lastSynced: null, message: '', conflict: null };
  let uid: string | null = null;
  let applying = false;
  let busy = false;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pendingRemote: RemoteRow | null = null;

  const set = (patch: Partial<SyncView>): void => {
    Object.assign(view, patch);
    onChange();
  };
  const isDirty = (): boolean => store.getFlag(config.dirtyKey) !== '0';
  const markClean = (remoteTs: string): void => {
    store.setFlag(config.dirtyKey, '0');
    store.setFlag(config.remoteTsKey, remoteTs);
    store.setFlag(config.lastSyncKey, String(Date.now()));
    set({ status: 'idle', message: '', lastSynced: Date.now(), conflict: null });
  };
  const localEmpty = (): boolean => store.state.exercises.length === 0;

  // Any local change marks the device dirty and schedules an upload.
  store.subscribe(() => {
    if (applying) return;
    store.setFlag(config.dirtyKey, '1');
    if (uid) {
      clearTimeout(timer);
      timer = setTimeout(() => void syncNow(), config.pushDelayMs);
    }
  });

  async function fetchRemote(): Promise<RemoteRow | null> {
    const { data, error } = await client.from('wt_state').select('state, updated_at').maybeSingle();
    if (error) throw new Error(error.message);
    return data as RemoteRow | null;
  }

  async function push(knownRemote: string | null): Promise<boolean> {
    if (!uid) return false;
    const state = store.state;
    if (knownRemote === null) {
      const { data, error } = await client.from('wt_state').insert({ user_id: uid, state }).select('updated_at').single();
      if (error) return false; // a row appeared meanwhile: re-plan
      markClean((data as { updated_at: string }).updated_at);
      return true;
    }
    const { data, error } = await client.from('wt_state').update({ state }).eq('user_id', uid).eq('updated_at', knownRemote).select('updated_at');
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) return false; // cloud changed since we looked: re-plan
    markClean((data[0] as { updated_at: string }).updated_at);
    return true;
  }

  function pull(row: RemoteRow): void {
    const next: State = migrate(row.state);
    applying = true;
    try {
      store.replace(next, 'syncing from the cloud');
    } finally {
      applying = false;
    }
    markClean(row.updated_at);
  }

  async function syncNow(): Promise<void> {
    if (!uid) return;
    if (busy) {
      again = true;
      return;
    }
    busy = true;
    set({ status: 'syncing', message: '' });
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await fetchRemote();
        const action = planSync({
          remote: remote?.updated_at ?? null,
          knownRemote: store.getFlag(config.remoteTsKey),
          dirty: isDirty(),
          localEmpty: localEmpty(),
        });
        if (action === 'none') {
          if (remote) markClean(remote.updated_at);
          else set({ status: 'idle', message: '' });
          return;
        }
        if (action === 'pull' && remote) return pull(remote);
        if (action === 'conflict' && remote) {
          pendingRemote = remote;
          const cloud = migrate(remote.state);
          set({ status: 'conflict', conflict: { cloudSessions: cloud.log.length, phoneSessions: store.state.log.length } });
          return;
        }
        if (await push(remote?.updated_at ?? null)) return;
      }
      throw new Error('Could not settle with the cloud copy. Try again.');
    } catch (err) {
      set({ status: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      busy = false;
      if (again) {
        again = false;
        void syncNow();
      }
    }
  }

  async function resolve(choice: 'cloud' | 'phone'): Promise<void> {
    if (!pendingRemote) return;
    const remote = pendingRemote;
    pendingRemote = null;
    if (choice === 'cloud') {
      pull(remote);
      return;
    }
    // Keep this phone: adopt the cloud timestamp so the upload counts as a clean overwrite.
    store.setFlag(config.remoteTsKey, remote.updated_at);
    store.setFlag(config.dirtyKey, '1');
    await syncNow();
  }

  async function adoptSession(): Promise<void> {
    const { data } = await client.auth.getSession();
    const user = data.session?.user;
    uid = user?.id ?? null;
    if (!user) {
      set({ status: 'signedOut', email: null, message: '', conflict: null });
      return;
    }
    const last = Number(store.getFlag(config.lastSyncKey));
    set({ email: user.email ?? null, status: 'idle', lastSynced: last || null });
    await syncNow();
  }

  client.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      uid = null;
      set({ status: 'signedOut', email: null, message: '', conflict: null });
    }
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void syncNow();
  });
  window.addEventListener('online', () => void syncNow());

  return {
    view: () => view,
    client: () => client,
    userId: () => uid,
    init: adoptSession,
    async signIn(email, password) {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      await adoptSession();
    },
    async signUp(email, password) {
      const { data, error } = await client.auth.signUp({ email, password });
      if (error) throw new Error(error.message);
      if (!data.session) throw new Error('Account created. Confirm the email we sent, then sign in.');
      await adoptSession();
    },
    async signOut() {
      await client.auth.signOut();
      uid = null;
      set({ status: 'signedOut', email: null, message: '', conflict: null });
    },
    syncNow,
    resolve,
  };
}
