import { writable } from 'svelte/store';

export const nightMode = writable(true);

export const notification = writable({
  show: false,
  message: '',
  type: 'success' as 'success' | 'error' | 'warning'
});

export function showNotification(msg: string, type: 'success' | 'error' | 'warning') {
  notification.set({ show: true, message: msg, type });
  setTimeout(() => notification.update(n => ({ ...n, show: false })), 3500);
}
