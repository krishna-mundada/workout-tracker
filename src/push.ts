// Daily reminder: a Web Push subscription stored in the cloud. A scheduled function checks each hour
// and sends a notification if nothing has been logged today.
import type { SupabaseClient } from '@supabase/supabase-js';

export const pushSupported = (): boolean => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function keyBytes(base64Url: string): Uint8Array {
  const pad = '='.repeat((4 - (base64Url.length % 4)) % 4);
  const raw = atob((base64Url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export async function enableReminders(client: SupabaseClient, userId: string, vapidPublicKey: string, hour: number): Promise<void> {
  if (!pushSupported()) throw new Error('This browser cannot receive reminders.');
  if ((await Notification.requestPermission()) !== 'granted') throw new Error('Notifications are blocked for this site.');
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapidPublicKey) as BufferSource }));
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys.auth) throw new Error('Could not read the push subscription.');
  const { error } = await client.from('wt_push_subscriptions').upsert({
    endpoint: json.endpoint,
    user_id: userId,
    p256dh: json.keys.p256dh,
    auth: json.keys.auth,
    remind_hour: hour,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    last_sent_on: null,
  });
  if (error) throw new Error(error.message);
}

export async function disableReminders(client: SupabaseClient): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  await client.from('wt_push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}
