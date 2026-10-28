// src/lib/components/kiosk/kioskConfirm.ts
// File 11 §4 — helper berbasis promise untuk memasang KioskConfirm.svelte secara dinamis,
// dipakai seperti `confirm()` bawaan tapi async: `if (!(await kioskConfirm({...}))) return;`

import { mount, unmount } from 'svelte';
import KioskConfirm from './KioskConfirm.svelte';

export interface KioskConfirmOptions {
	judul: string;
	isi: string;
	ya?: string;
	tidak?: string;
	warna?: 'hijau' | 'merah' | 'oranye';
}

export function kioskConfirm(opts: KioskConfirmOptions): Promise<boolean> {
	return new Promise((resolve) => {
		const target = document.createElement('div');
		document.body.appendChild(target);

		const cleanup = (result: boolean) => {
			unmount(instance);
			target.remove();
			resolve(result);
		};

		const instance = mount(KioskConfirm, {
			target,
			props: {
				...opts,
				onYa: () => cleanup(true),
				onTidak: () => cleanup(false)
			}
		});
	});
}
