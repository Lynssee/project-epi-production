// src/lib/stores/asistenStore.ts
// Fase 1 — Rencana Implementasi Asisten Eltama v2.0 §13/§19.2: state global
// buka/tutup + prefill untuk AsistenSheet.svelte (dashboard lapangan).
// Pola sama seperti chatbotStore.js di erp-epi-1 (writable klasik, bukan
// .svelte.ts runes — ikut konvensi store lintas-file yang sudah dipakai di
// repo ini, lihat lib/stores/ui.ts).

import { writable } from 'svelte/store';

export const asistenOpen = writable(false);
export const asistenPrefill = writable('');
