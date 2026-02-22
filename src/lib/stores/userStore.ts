import { writable } from 'svelte/store';

export const currentUser = writable<any>(null);

export function getUserKey(key: string, userId: number | string | null): string {
  return `${key}_${userId || 'guest'}`;
}
