// src/lib/components/kiosk/kioskNumpad.ts
// File 11 §5 — helper berbasis promise untuk memasang KioskNumpad.svelte secara dinamis,
// pola sama kioskConfirm.ts. Balikan `null` berarti operator membatalkan (nilai lama dipakai).

import { mount, unmount } from 'svelte';
import KioskNumpad from './KioskNumpad.svelte';

export interface KioskNumpadOptions {
	judul: string;
	nilaiAwal?: string;
	desimal?: boolean;
	satuan?: string;
	masked?: boolean;
	maxLength?: number;
}

export function openKioskNumpad(opts: KioskNumpadOptions): Promise<string | null> {
	return new Promise((resolve) => {
		const target = document.createElement('div');
		document.body.appendChild(target);

		const cleanup = (result: string | null) => {
			unmount(instance);
			target.remove();
			resolve(result);
		};

		const instance = mount(KioskNumpad, {
			target,
			props: {
				...opts,
				onSelesai: (nilai: string) => cleanup(nilai),
				onBatal: () => cleanup(null)
			}
		});
	});
}

/** Satuan yang butuh input desimal (koma). Default di kode, bisa dioverride via setelan
 *  `kiosk.satuan_desimal` (system_settings, array string, dibaca lewat modul pembaca --
 *  jangan query Directus langsung dari komponen, sesuai aturan pemisahan settings). */
export const SATUAN_DESIMAL_DEFAULT = ['kg', 'liter', 'l', 'm', 'meter', 'gram', 'g', 'ton'];

export function isSatuanDesimal(satuan: string | null | undefined, daftar: string[] = SATUAN_DESIMAL_DEFAULT): boolean {
	if (!satuan) return false;
	return daftar.includes(satuan.trim().toLowerCase());
}
