// src/lib/utils/subtaskProgressEngine.ts
// Subtask Progress Engine untuk project-epi (Dashboard Lapangan)
// Single Source of Truth untuk Laporan Workshop Ciketing & Timeline

export interface ActiveSubtask {
	id: string;
	name: string;
	category_id?: string;
	category_name?: string;
	so_detail_id?: number | null;
	target_volume: number;
	unit: string;
	days?: number;
	plan?: Record<string, number>;
}

const SYSTEM_CATEGORY_HINTS = ['mobilisasi', 'bast'];

function isSystemCategory(category: any): boolean {
	const name = String(category?.nama || category?.name || '').toLowerCase();
	return SYSTEM_CATEGORY_HINTS.some((hint) => name.includes(hint));
}

function num(v: any): number {
	const n = parseFloat(v);
	return Number.isFinite(n) ? n : 0;
}

/**
 * Mengekstrak seluruh subtask aktif dari timeline planning suatu PO.
 * @param timelinePlanning Objek timeline_planning dari tabel projects
 * @returns Daftar subtask lengkap dengan konteks kategorinya
 */
export function extractActiveSubtasks(timelinePlanning: any): ActiveSubtask[] {
	if (!timelinePlanning || !Array.isArray(timelinePlanning.categories)) return [];

	const subtasks: ActiveSubtask[] = [];
	for (const cat of timelinePlanning.categories) {
		if (isSystemCategory(cat)) continue;

		const catSubtasks = Array.isArray(cat.subtasks) ? cat.subtasks : [];
		for (const sub of catSubtasks) {
			if (!sub || !sub.id) continue;
			subtasks.push({
				id: String(sub.id),
				name: sub.name || sub.nama || 'Subtask Tanpa Nama',
				category_id: cat.id ? String(cat.id) : undefined,
				category_name: cat.nama || cat.name || '',
				so_detail_id: cat.so_detail_id || null,
				target_volume: num(sub.volume) || num(cat.volume) || 0,
				unit: sub.unit || sub.satuan || cat.satuan || 'ls',
				days: sub.days || 1,
				plan: sub.plan || {}
			});
		}
	}
	return subtasks;
}
