// src/lib/utils/offlineProjectCache.ts
// Cache data master proyek (RAB material, timeline subtask, penugasan manpower, budget)
// di IndexedDB agar form Laporan Harian tetap bisa dibuka dan diisi di area blank spot / sinyal lemah.

import { openDB, type IDBPDatabase } from 'idb';

export interface ProjectMasterCache {
	projectId: string | number;
	cachedAt: number;
	project: any;
	soCustomer?: any;
	soDetails?: any[];
	timelineCategories: any[];
	availableSubtasks: any[];
	actualMaterials: any[];
	availableManpower: any[];
	budgetExpenses: any[];
	allReportsForProgress: any[];
	previousSpentMap: Record<string | number, number>;
}

const DB_NAME = 'epi_project_master_cache';
const STORE_NAME = 'project_cache';

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDb(): Promise<IDBPDatabase> {
	if (typeof indexedDB === 'undefined') {
		throw new Error('IndexedDB tidak tersedia di perangkat ini');
	}
	if (!dbPromise) {
		dbPromise = openDB(DB_NAME, 1, {
			upgrade(db) {
				if (!db.objectStoreNames.contains(STORE_NAME)) {
					db.createObjectStore(STORE_NAME, { keyPath: 'projectId' });
				}
			}
		});
	}
	return dbPromise;
}

export async function saveProjectMasterCache(data: ProjectMasterCache): Promise<void> {
	try {
		const db = await getDb();
		await db.put(STORE_NAME, data);
	} catch (e) {
		console.warn('Gagal menyimpan cache master proyek ke IndexedDB:', e);
	}
}

export async function loadProjectMasterCache(projectId: string | number): Promise<ProjectMasterCache | null> {
	try {
		const db = await getDb();
		const cached = await db.get(STORE_NAME, String(projectId));
		if (!cached) {
			return (await db.get(STORE_NAME, Number(projectId))) || null;
		}
		return cached;
	} catch (e) {
		console.warn('Gagal membaca cache master proyek dari IndexedDB:', e);
		return null;
	}
}

/** Hapus cache master satu proyek (mis. akses dicabut/dipindahkan) — gagal-lunak. */
export async function clearProjectMasterCache(projectId: string | number): Promise<void> {
  try {
    const db = await getDb();
    await db.delete(STORE_NAME, String(projectId));
    await db.delete(STORE_NAME, Number(projectId));
  } catch (e) {
    console.warn('Gagal menghapus cache master proyek:', e);
  }
}
