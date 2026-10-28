import directus, { handleDirectusError } from './directus';
import { readItems } from '@directus/sdk';
import type { FeatureKey } from '$lib/constants/permissions';

export interface AppRole {
	id: string; // Document ID (e.g., 'super_admin' or numeric ID from posisi)
	label: string; // e.g., 'Super Admin'
	desc: string; // Description
	name?: string; // compatibility with erp-epi
	description?: string; // compatibility with erp-epi
	permissions: FeatureKey[];
	isSystem?: boolean; // If true, cannot be deleted (e.g., super_admin)
	landingPage?: string; // Halaman setelah login; diatur dari admin erp-epi-1 (/roles)
	createdAt?: any;
	updatedAt?: any;
}

export async function getAppRoles(): Promise<AppRole[]> {
	try {
		const result = await directus.request(
			readItems('posisi', {
				limit: -1,
				fields: ['id', 'nama_posisi', 'permissions', 'is_system_role', 'role_description']
			})
		);
		return (result || []).map((p: any) => ({
			id: String(p.id),
			label: p.nama_posisi || String(p.id),
			desc: p.role_description || '',
			permissions: Array.isArray(p.permissions) ? p.permissions : [],
			isSystem: !!p.is_system_role
		}));
	} catch (error) {
		console.error('Gagal memuat roles dari Directus posisi:', error);
		return [];
	}
}

export async function getAppRoleById(id: string): Promise<AppRole | null> {
	try {
		const roles = await getAppRoles();
		return roles.find(r => r.id === id) || null;
	} catch (error) {
		console.error('Gagal memuat role:', error);
		return null;
	}
}

export async function createAppRole(id: string, data: Partial<AppRole>): Promise<boolean> {
	// Not implemented for Project EPI (managed in ERP EPI via Directus)
	console.warn('createAppRole is not supported directly in Project EPI. Please manage roles in ERP EPI.');
	return false;
}

export async function updateAppRole(id: string, data: Partial<AppRole>): Promise<boolean> {
	// Not implemented for Project EPI (managed in ERP EPI via Directus)
	console.warn('updateAppRole is not supported directly in Project EPI. Please manage roles in ERP EPI.');
	return false;
}

export async function deleteAppRole(id: string): Promise<boolean> {
	// Not implemented for Project EPI (managed in ERP EPI via Directus)
	console.warn('deleteAppRole is not supported directly in Project EPI. Please manage roles in ERP EPI.');
	return false;
}
