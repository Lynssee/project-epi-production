// src/lib/stores/tourStore.svelte.ts
// State tur aktif (guided tour) — port ringkas dari erp-epi-1 tourStore.js,
// disederhanakan untuk Svelte 5 runes (module-level $state, tanpa dependency
// Firestore untuk toggle aktif/nonaktif — Fase 2 lapangan: tur selalu
// tersedia, hanya status "sudah dilihat" yang dilacak per-browser + progress
// ke tutorial_progress). Fase 2, implementation_plan_tutorial aplikasi per role.md.

import { getTour } from '$lib/data/tours';

interface ActiveTour {
  moduleId: string;
  label: string;
  steps: any[];
}

let activeTourState = $state<ActiveTour | null>(null);

export const tourState = {
  get active() {
    return activeTourState;
  },
};

const SEEN_PREFIX = 'tour_seen_';

/** Tandai tur modul sudah pernah dilihat user ini (per-browser). */
export function markTourSeen(moduleId: string) {
  if (typeof localStorage === 'undefined' || !moduleId) return;
  try {
    localStorage.setItem(SEEN_PREFIX + moduleId, '1');
  } catch (err) {
    console.error('[tourStore] Gagal menandai tour seen:', err);
  }
}

/** Apakah user sudah pernah melihat tur modul ini? */
export function hasTourSeen(moduleId: string): boolean {
  if (typeof localStorage === 'undefined' || !moduleId) return false;
  return localStorage.getItem(SEEN_PREFIX + moduleId) === '1';
}

/** Mulai tur sebuah modul. @returns true bila tur tersedia & dimulai */
export function startTour(moduleId: string): boolean {
  const tour = getTour(moduleId);
  if (!tour || !tour.steps?.length) return false;
  activeTourState = { moduleId, label: tour.label, steps: tour.steps };
  return true;
}

/** Tutup tur aktif tanpa mencatat progress (dipakai jika ingin batal diam-diam). */
export function closeTour() {
  activeTourState = null;
}

/**
 * Tur selesai ditonton user (dipanggil dari onFinish GuidedTour): tandai
 * "seen" per-browser + catat progress 'selesai' ke tutorial_progress. Gagal
 * mencatat progress tidak boleh mengganggu penutupan tur (fire-and-forget).
 */
export async function finishTour() {
  const tour = activeTourState;
  if (tour?.moduleId) {
    markTourSeen(tour.moduleId);
    try {
      const { recordTutorialProgress } = await import('$lib/services/tutorialApi');
      recordTutorialProgress({ tutorialRef: tour.moduleId, jenis: 'tour', persen: 100, status: 'selesai' });
    } catch (err) {
      console.error('[tourStore] Gagal mencatat progress tur:', err);
    }
  }
  activeTourState = null;
}
