import directus from './directus';
import { readActivities } from '@directus/sdk';

export interface AuditEntry {
	id: number;
	action: string;
	user: string | null;
	timestamp: string;
	collection: string;
	item: string;
	comment: string | null;
}

const ACTION_LABEL: Record<string, string> = {
	create: 'Dibuat',
	update: 'Diperbarui',
	delete: 'Dihapus',
	login: 'Login',
	logout: 'Logout',
};

export function getActionLabel(action: string): string {
	return ACTION_LABEL[action] ?? action;
}

export function getActionIcon(action: string): string {
	if (action === 'create') return '✅';
	if (action === 'update') return '✏️';
	if (action === 'delete') return '🗑️';
	return '📋';
}

export async function getItemActivity(collection: string, itemId: string | number, limit = 30) {
	try {
		const result = await directus.request(
			readActivities({
				filter: {
					collection: { _eq: collection },
					item: { _eq: String(itemId) }
				} as any,
				sort: ['-timestamp'],
				limit,
				fields: ['id', 'action', 'user', 'timestamp', 'collection', 'item', 'comment'] as any
			})
		);
		return { success: true, data: (result as any[]) ?? [] };
	} catch (error) {
		console.error('getItemActivity error:', error);
		return { success: false, data: [] };
	}
}

export async function getProjectActivity(projectId: string | number, limit = 30) {
	return getItemActivity('proyek', projectId, limit);
}

export async function getBudgetActivity(budgetId: string | number, limit = 30) {
	return getItemActivity('pengajuan_anggaran', budgetId, limit);
}
