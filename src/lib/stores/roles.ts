import { writable, get } from 'svelte/store';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '$lib/firebase';
import { getAppRoles, createAppRole, type AppRole } from '$lib/services/roles';
import { DEFAULT_ROLE_PERMISSIONS, DEFAULT_ROLE_OPTIONS } from '$lib/constants/permissions';

export const rolesStore = writable<AppRole[]>([]);

// Rencana RBAC v2, Bagian 6/8.2: fitur wajib (mis. access_ess) berlaku untuk
// SEMUA pengguna aktif terlepas dari role. Dibaca dari koleksi rbac_config
// yang dibagi dengan erp-epi-1 (bukan hardcode) — lihat hasPermission() di
// $lib/constants/permissions.ts yang mengecek store ini lebih dulu.
export const mandatoryFeaturesStore = writable<string[]>([]);

export async function loadMandatoryFeatures() {
	try {
		const snap = await getDoc(doc(db, 'rbac_config', 'main'));
		const list = snap.exists() ? snap.data().mandatoryFeatures : null;
		mandatoryFeaturesStore.set(Array.isArray(list) ? list : []);
	} catch (e) {
		console.warn('Gagal memuat rbac_config (fitur wajib dilewati):', e);
		mandatoryFeaturesStore.set([]);
	}
}

export async function loadRoles() {
	let roles = await getAppRoles();


	// Auto-migration if no roles found
	if (roles.length === 0) {
		console.log('No roles found in Firestore, migrating defaults...');
		for (const opt of DEFAULT_ROLE_OPTIONS) {
			const perms = DEFAULT_ROLE_PERMISSIONS[opt.id] || [];
			const newRole: AppRole = {
				id: opt.id,
				label: opt.label,
				desc: opt.desc,
				permissions: perms,
				isSystem: ['super_admin'].includes(opt.id)
			};
			await createAppRole(opt.id, newRole);
			roles.push(newRole);
		}
		roles.sort((a, b) => a.label.localeCompare(b.label));
	}

	rolesStore.set(roles);
	loadMandatoryFeatures();
	return roles;
}

export function getRoleById(id: string | null): AppRole | undefined {
	if (!id) return undefined;
	return get(rolesStore).find(r => r.id === id);
}

export function getRoleLabel(id: string | null): string {
	const role = getRoleById(id);
	return role ? (role.label || role.name || id || '-') : (id || '-');
}
