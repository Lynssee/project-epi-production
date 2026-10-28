import { db } from '$lib/firebase';
import {
	collection, doc, getDocs, getDoc, setDoc, updateDoc, deleteDoc,
	query, where, orderBy, Timestamp
} from 'firebase/firestore';

// Matches the existing Firestore structure from your screenshot
export interface AppUser {
	id?: string;        // Document ID (Firebase Auth UID)
	email: string;
	firstName: string;
	lastName: string;
	role: string;
	roleId: string;
	roleIds?: string[]; // Semua role yang dimiliki user (multi-role)
	department: string;
	departmentId: string;
	phone: string;
	isSuperAdmin?: boolean;
	// jabatanId = ID posisi di Directus (field numeric disimpan admin erp-epi saat assign jabatan)
	jabatanId?: number | string | null;
	// karyawanId = ID record karyawan di Directus (FK, string atau number)
	karyawanId?: number | string | null;
	createdAt?: any;
	updatedAt?: any;
}


// Collection name in Firestore — change if yours is different
const COLLECTION_NAME = 'users';

// Rencana RBAC v2, Bagian 7 (Anti-Hardcode): daftar email Super Admin dulu
// ditulis keras di sini (2x, salah satunya dengan ejaan domain salah ketik --
// lubang keamanan). Sekarang dibaca dari rbac_config.superAdminEmails, sama
// dengan yang dipakai erp-epi-1/src/lib/firebase.js (koleksi Firestore dibagi
// berdua). Cache in-memory pendek supaya tidak baca ulang di setiap panggilan.
const BOOTSTRAP_SUPER_ADMIN_EMAILS = [
	'vionda@eltamaprimaindo.com',
	'viorda@eltamaprimaindo.com',
	'vionda@eltamaprimeindo.com',
	'viorda@eltamaprimeindo.com',
	'mviondanovrian@gmail.com',
	'joe.eltama@gmail.com'
];

let superAdminEmailsCache: { emails: string[]; exp: number } | null = null;
async function getSuperAdminEmails(): Promise<string[]> {
	if (superAdminEmailsCache && superAdminEmailsCache.exp > Date.now()) return superAdminEmailsCache.emails;
	try {
		const snap = await getDoc(doc(db, 'rbac_config', 'main'));
		const remoteEmails = snap.exists() && Array.isArray(snap.data().superAdminEmails)
			? snap.data().superAdminEmails.map((e: string) => String(e).toLowerCase())
			: [];
		const emails = Array.from(new Set([...BOOTSTRAP_SUPER_ADMIN_EMAILS, ...remoteEmails]));
		superAdminEmailsCache = { emails, exp: Date.now() + 60_000 };
		return emails;
	} catch (e) {
		console.warn('Gagal memuat rbac_config.superAdminEmails:', e);
		return BOOTSTRAP_SUPER_ADMIN_EMAILS;
	}
}

export async function getAppUsers(): Promise<AppUser[]> {
	try {
		const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'desc'));
		const snapshot = await getDocs(q);
		return snapshot.docs.map(d => ({ id: d.id, ...d.data() } as AppUser));
	} catch (error) {
		console.error('Gagal memuat users dari Firestore:', error);
		return [];
	}
}

export async function getAppUserById(uid: string): Promise<AppUser | null> {
	try {
		const docRef = doc(db, COLLECTION_NAME, uid);
		const docSnap = await getDoc(docRef);
		if (docSnap.exists()) {
			const u = { id: docSnap.id, ...docSnap.data() } as AppUser;
			const emailLower = (u.email || '').toLowerCase();
			if (u.isSuperAdmin === true || (await getSuperAdminEmails()).includes(emailLower)) {
				u.role = 'Super Admin';
				u.roleId = 'super_admin';
			}
			return u;
		}
		return null;
	} catch (error: any) {
		console.error('[getAppUserById] Gagal memuat user:', error);
		return null;
	}
}

export async function getAppUserByEmail(email: string): Promise<AppUser | null> {
	try {
		const q = query(
			collection(db, COLLECTION_NAME),
			where('email', '==', email.toLowerCase())
		);
		const snapshot = await getDocs(q);
		if (!snapshot.empty) {
			const d = snapshot.docs[0];
			const u = { id: d.id, ...d.data() } as AppUser;
			const emailLower = (u.email || '').toLowerCase();
			if (u.isSuperAdmin === true || (await getSuperAdminEmails()).includes(emailLower)) {
				u.role = 'Super Admin';
				u.roleId = 'super_admin';
			}
			return u;
		}
		return null;
	} catch (error) {
		console.error('Gagal mencari user by email:', error);
		return null;
	}
}

export async function createAppUser(uid: string, data: Partial<AppUser>): Promise<boolean> {
	try {
		const now = Timestamp.now();
		const payload: Record<string, any> = {
			email: data.email?.toLowerCase() || '',
			firstName: data.firstName || '',
			lastName: data.lastName || '',
			role: data.role || 'staff',
			roleId: data.roleId || data.role || 'staff',
			department: data.department || '',
			departmentId: data.departmentId || '',
			phone: data.phone || '',
			createdAt: now,
			updatedAt: now
		};
		await setDoc(doc(db, COLLECTION_NAME, uid), payload);
		return true;
	} catch (error) {
		console.error('Gagal membuat user di Firestore:', error);
		return false;
	}
}

export async function updateAppUser(uid: string, data: Partial<AppUser>): Promise<boolean> {
	try {
		const updateData: Record<string, any> = { updatedAt: Timestamp.now() };
		if (data.firstName !== undefined) updateData.firstName = data.firstName;
		if (data.lastName !== undefined) updateData.lastName = data.lastName;
		if (data.role !== undefined) {
			updateData.role = data.role;
			updateData.roleId = data.roleId || data.role;
		}
		if (data.department !== undefined) updateData.department = data.department;
		if (data.departmentId !== undefined) updateData.departmentId = data.departmentId;
		if (data.phone !== undefined) updateData.phone = data.phone;
		if (data.email !== undefined) updateData.email = data.email.toLowerCase();

		await updateDoc(doc(db, COLLECTION_NAME, uid), updateData);
		return true;
	} catch (error) {
		console.error('Gagal update user:', error);
		return false;
	}
}

export async function deleteAppUser(uid: string): Promise<boolean> {
	try {
		await deleteDoc(doc(db, COLLECTION_NAME, uid));
		return true;
	} catch (error) {
		console.error('Gagal hapus user:', error);
		return false;
	}
}

// Helper: get display name from Firestore user
export function getDisplayName(user: AppUser): string {
	const first = user.firstName || '';
	const last = user.lastName || '';
	return `${first} ${last}`.trim() || user.email || '-';
}
