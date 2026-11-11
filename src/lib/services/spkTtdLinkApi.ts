// src/lib/services/spkTtdLinkApi.ts
// Klien tipis route lapangan TTD SPK via tautan (api/manpower/spk-link, spk-ttd-dispensasi).
// Galat dikembalikan sebagai { success:false, error } (tidak melempar) agar UI menampilkan pesan server apa adanya.
import { auth } from '$lib/firebase';

async function panggil(method: string, path: string, body?: any): Promise<any> {
	try {
		const idToken = await auth.currentUser?.getIdToken();
		if (!idToken) return { success: false, error: 'Sesi login tidak ditemukan. Login ulang.' };
		const res = await fetch(path, {
			method,
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
			body: body ? JSON.stringify(body) : undefined
		});
		const json: any = await res.json().catch(() => ({}));
		if (!res.ok && json.success !== false) return { success: false, error: json.message || `HTTP ${res.status}` };
		return json;
	} catch (e) {
		console.error('[spkTtdLinkApi]', method, path, e);
		return { success: false, error: 'Koneksi bermasalah. Coba lagi.' };
	}
}

export const buatLinkSpk = ({ assignmentId, mode = 'link', varian = 'lengkap', manpowerId }: { assignmentId: number; mode?: 'link' | 'kiosk_pl'; varian?: 'lengkap' | 'tanpa_harga'; manpowerId?: number; kirimWa?: boolean }) =>
	panggil('POST', '/api/manpower/spk-link', { assignment_id: assignmentId, mode, varian, manpower_id: manpowerId });
export const daftarLinkSpk = (assignmentId: number) => panggil('GET', `/api/manpower/spk-link?assignment_id=${encodeURIComponent(String(assignmentId))}`);
export const cabutLinkSpk = (assignmentId: number) => panggil('POST', '/api/manpower/spk-link/cabut', { assignment_id: assignmentId });
export const dispensasiSpk = (assignmentId: number, alasan: string) => panggil('POST', '/api/manpower/spk-ttd-dispensasi', { assignment_id: assignmentId, alasan });
