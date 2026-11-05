// src/routes/(app)/panduan/alur/gatePrep.ts
// "Simulasi pra-periksa syarat gate": tim lapangan mencentang checklist gate SEBELUM menekan tombol form, supaya pengajuan tidak ditolak.
// Murni + penyimpanan di perangkat (localStorage, aman bila tak tersedia). BUKAN pengganti pemeriksaan sistem — hanya pengingat pribadi,
// tidak dikirim ke server (0 kuota). Dites.
import type { FieldGateInfo } from './fieldGateApi';

type StorageLike = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const KEY = (flowId: string) => `epi_gate_prep_v1_${flowId}`;
const MAX_ITEMS = 300;

/** Kunci stabil satu butir checklist (gate + teks), tahan terhadap urutan berubah. */
export const prepItemKey = (gateKey: string, label: string): string => `${gateKey}::${label}`;

/** Hanya gate yang mengikat (Wajib / Perlu alasan) yang diberi simulasi; Peringatan & Dipantau cukup dibaca. */
export const isPrepGate = (info: FieldGateInfo | null | undefined): info is FieldGateInfo => !!info && (info.mode === 'hard' || info.mode === 'soft') && info.checklist.length > 0;

export function loadPrep(flowId: string, storage: StorageLike | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null): Set<string> {
	try {
		const raw = storage?.getItem(KEY(flowId));
		const arr = raw ? JSON.parse(raw) : [];
		return new Set(Array.isArray(arr) ? arr.filter((x) => typeof x === 'string').slice(0, MAX_ITEMS) : []);
	} catch {
		return new Set();
	}
}

export function savePrep(flowId: string, checked: Set<string>, storage: StorageLike | null | undefined = typeof localStorage !== 'undefined' ? localStorage : null): void {
	try {
		if (!checked.size) storage?.removeItem(KEY(flowId));
		else storage?.setItem(KEY(flowId), JSON.stringify([...checked].slice(0, MAX_ITEMS)));
	} catch {
		/* kuota penuh / mode privat: hanya kenyamanan */
	}
}

export interface PrepProgress {
	total: number;
	done: number;
	wajibTotal: number;
	wajibDone: number;
	/** Semua butir WAJIB tercentang (bila tak ada yang wajib: semua butir). */
	ready: boolean;
}

export function prepProgress(gateKey: string, info: FieldGateInfo | null | undefined, checked: Set<string>): PrepProgress {
	const list = info?.checklist ?? [];
	const isDone = (label: string) => checked.has(prepItemKey(gateKey, label));
	const wajib = list.filter((c) => c.wajib);
	const total = list.length;
	const done = list.filter((c) => isDone(c.label)).length;
	const wajibDone = wajib.filter((c) => isDone(c.label)).length;
	return { total, done, wajibTotal: wajib.length, wajibDone, ready: total > 0 && (wajib.length > 0 ? wajibDone === wajib.length : done === total) };
}
