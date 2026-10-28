import { writable } from 'svelte/store';

export type DeviceView = 'responsive' | 'mobile' | 'tablet' | 'pc';
export const deviceView = writable<DeviceView>('responsive');
