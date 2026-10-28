import { secureDirectusFetch } from './secureDirectus';

const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_API_URL;

/**
 * Login ke Directus dengan email + password user.
 * Mengembalikan access_token jika berhasil, null jika gagal.
 */
export async function loginDirectus(email: string, password: string): Promise<string | null> {
	try {
		const res = await fetch(`${DIRECTUS_URL}/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password })
		});
		if (!res.ok) return null;
		const data = await res.json();
		return data.data?.access_token ?? null;
	} catch {
		return null;
	}
}

/**
 * Logout dari Directus — invalidasi token user.
 */
export async function logoutDirectus(token: string): Promise<void> {
	try {
		await fetch(`${DIRECTUS_URL}/auth/logout`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${token}`,
				'Content-Type': 'application/json'
			}
		});
	} catch { /* abaikan error logout */ }
}

/**
 * Buat akun Directus untuk seorang leader baru.
 * Dipanggil saat admin membuat user baru via /admin/users/baru.
 * Directus user dibuat dengan role "Leader" jika roleId tersedia.
 */
export async function createDirectusLeaderAccount(
	email: string,
	firstName: string,
	lastName: string,
	password: string,
	directusRoleId?: string
): Promise<boolean> {
	try {
		const payload: Record<string, string> = {
			email: email.toLowerCase(),
			password,
			first_name: firstName,
			last_name: lastName,
			status: 'active'
		};
		if (directusRoleId) {
			payload.role = directusRoleId;
		}

		const res = await secureDirectusFetch(`/users`, {
			method: 'POST',
			body: JSON.stringify(payload)
		});

		// 400 bisa berarti user sudah ada — anggap berhasil
		return res.ok || res.status === 400;
	} catch {
		return false;
	}
}

/**
 * Ambil Directus role ID berdasarkan nama role.
 * Berguna untuk mendapatkan ID role "Leader" secara dinamis.
 */
export async function getDirectusRoleId(roleName: string): Promise<string | null> {
	try {
		const res = await secureDirectusFetch(
			`/roles?filter[name][_eq]=${encodeURIComponent(roleName)}&fields=id&limit=1`
		);
		if (!res.ok) return null;
		const data = await res.json();
		return data.data?.[0]?.id ?? null;
	} catch {
		return null;
	}
}
