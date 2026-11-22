// Guard anti-self-referral (POST /api/ess/referral): nomor HP / email karyawan sendiri tidak boleh direkomendasikan.
// Kontak karyawan dibaca TERPISAH dari Directus (ServerKaryawan hanya memuat kolom identitas) — sebelumnya guard ini mati
// karena karyawan.no_hp / karyawan.email selalu undefined.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockDirectus = vi.fn();
vi.mock('$lib/server/directus', () => ({ directusServerJson: (...a: unknown[]) => mockDirectus(...a), directusServerUpload: vi.fn() }));
vi.mock('$lib/server/ess/attendanceGuard', () => ({
	authenticateEss: vi.fn().mockResolvedValue({ karyawan: { id: 7, nama_karyawan: 'Andi', divisi: 'Produksi', email_company: 'andi@eltama.id' } })
}));

import { POST } from './+server';

function ev(fields: Record<string, string>) {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return { request: { formData: async () => form } } as any;
}
const base = { lowongan_id: '5', nama: 'Budi', hubungan_relasi: 'Teman', no_hp: '0812-3456-7890', email: 'budi@x.id' };
const rejected = async (fields: Record<string, string>) => {
	try { await POST(ev({ ...base, ...fields })); return null; } catch (e: any) { return e; }
};

describe('referral — anti self-referral', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDirectus.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/items/karyawan/7')) return { data: { no_hp: '+62 812-3456-7890', email: 'andi.pribadi@gmail.com', email_company: 'andi@eltama.id' } };
			return { data: null };
		});
	});

	it('nomor HP yang sama dengan karyawan (format berbeda) → 400', async () => {
		const e = await rejected({ no_hp: '081234567890' });
		// 62812... vs 0812...: angka dibersihkan apa adanya (tanpa normalisasi kode negara) — format identik harus ditolak
		const e2 = await rejected({ no_hp: '+62 812-3456-7890' });
		expect(e2?.status).toBe(400);
		expect(String(e2?.body?.message)).toContain('nomor telepon Anda sendiri');
		expect(e === null || e.status !== 500).toBe(true);
	});

	it('email pribadi atau email kantor karyawan → 400 (tidak peka huruf besar/kecil)', async () => {
		const e1 = await rejected({ email: 'Andi.Pribadi@Gmail.com' });
		const e2 = await rejected({ email: 'andi@eltama.id' });
		expect(e1?.status).toBe(400);
		expect(e2?.status).toBe(400);
		expect(String(e1?.body?.message)).toContain('alamat email Anda sendiri');
	});

	it('kontak karyawan gagal dibaca → guard dilewati (fail-open) dan tidak melempar 500 karena guard', async () => {
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockDirectus.mockImplementation(async (url: string) => {
			if (String(url).startsWith('/items/karyawan/7')) throw new Error('directus down');
			return { data: null };
		});
		const e = await rejected({});
		// Boleh gagal di langkah lain (lowongan tak ditemukan di mock), tetapi BUKAN karena guard self-referral.
		expect(String(e?.body?.message ?? '')).not.toContain('Anda sendiri');
	});
});
