// src/params/workshop.ts
// Pencocok parameter rute [workshop=workshop] — hanya slug workshop yang dikenal.
// Fase 7 Unifikasi Workshop (Ciketing & Balaraja). Slug lain → 404 bawaan SvelteKit.
import type { ParamMatcher } from '@sveltejs/kit';

export const match: ParamMatcher = (param) => param === 'ciketing' || param === 'balaraja';
