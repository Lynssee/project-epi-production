// RSM-13 — bagian murni klien mutasi: tombol aksi per pengguna, kunci qty, validasi form.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./secureDirectus', () => ({ getIdToken: vi.fn() }));
const { aksiUntukSaya, perluTindakanSaya, qtyBolehDimutasi, validasiFormAjukan } = await import('./mutasiApi');

const m = (o: any = {}) => ({
	aksi: ['setujui', 'tolak', 'batal'], status: 'diajukan', asal_tipe: 'project', asal_id: 1, tujuan_tipe: 'project', tujuan_id: 2,
	diajukan_oleh: 7, rute: 'langsung_site' as const, langkah: { urut: 1, total: 2, role: 'proyek_tujuan' }, ...o
});
const leaderAsal = { karyawanId: 7, projectIds: [1] };
const leaderTujuan = { karyawanId: 20, projectIds: [2] };

describe('aksiUntukSaya', () => {
	it('langkah proyek tujuan: leader tujuan melihat setujui/tolak; leader asal hanya batal', () => {
		expect(aksiUntukSaya(m(), leaderTujuan)).toEqual(['setujui', 'tolak']);
		expect(aksiUntukSaya(m(), leaderAsal)).toEqual(['batal']);
	});
	it('langkah Admin Inventory: leader tidak melihat setujui/tolak', () => {
		expect(aksiUntukSaya(m({ langkah: { urut: 2, total: 2, role: 'admin_inventory' } }), leaderTujuan)).toEqual([]);
	});
	it('kirim untuk leader asal; terima untuk leader tujuan', () => {
		expect(aksiUntukSaya(m({ status: 'disetujui_tujuan', aksi: ['kirim', 'batal'], langkah: null }), leaderAsal)).toEqual(['kirim', 'batal']);
		expect(aksiUntukSaya(m({ status: 'dikirim', aksi: ['terima'], langkah: null }), leaderTujuan)).toEqual(['terima']);
		expect(aksiUntukSaya(m({ status: 'dikirim', aksi: ['terima'], langkah: null }), leaderAsal)).toEqual([]);
	});
	it('via_gudang yang belum lolos gerbang: terima belum ditawarkan', () => {
		expect(aksiUntukSaya(m({ status: 'dikirim', rute: 'via_gudang', aksi: ['lolos_gerbang', 'terima'], langkah: null }), leaderTujuan)).toEqual([]);
		expect(aksiUntukSaya(m({ status: 'lolos_gerbang', rute: 'via_gudang', aksi: ['terima'], langkah: null }), leaderTujuan)).toEqual(['terima']);
	});
	it('perluTindakanSaya mengabaikan batal', () => {
		expect(perluTindakanSaya(m(), leaderTujuan)).toBe(true);
		expect(perluTindakanSaya(m(), leaderAsal)).toBe(false);
	});
});

describe('qtyBolehDimutasi', () => {
	it('saldo − terkunci, tidak negatif', () => {
		expect(qtyBolehDimutasi(10, 4)).toBe(6);
		expect(qtyBolehDimutasi(3, 9)).toBe(0);
	});
});

describe('validasiFormAjukan', () => {
	const ok = { asal: 1, tujuan: 2, alasan: 'Sisa scaffolding dipakai proyek B', items: [{ item_id: 10, qty: 3, maks: 5 }] };
	it('lolos untuk isian benar', () => expect(validasiFormAjukan(ok)).toBeNull());
	it('menolak: asal/tujuan kosong atau sama, tanpa barang, qty melebihi, alasan pendek', () => {
		expect(validasiFormAjukan({ ...ok, asal: '' })).toMatch(/asal/);
		expect(validasiFormAjukan({ ...ok, tujuan: '' })).toMatch(/tujuan/);
		expect(validasiFormAjukan({ ...ok, tujuan: 1 })).toMatch(/sama/);
		expect(validasiFormAjukan({ ...ok, items: [] })).toMatch(/barang/);
		expect(validasiFormAjukan({ ...ok, items: [{ item_id: 10, qty: 9, maks: 5 }] })).toMatch(/melebihi/);
		expect(validasiFormAjukan({ ...ok, alasan: 'pendek' })).toMatch(/20 karakter/);
	});
});

// ── Perpindahan non-BK (4 Nov 2026): tujuan workshop, QR tampil & pindai ──
import { qrPayloadMutasi, parseQrMutasi, bisaTampilQr, JENIS_LAPANGAN, WORKSHOP_TUJUAN, validasiFormAjukan as validasiForm } from './mutasiApi';

describe('QR e-SJ Mutasi', () => {
	it('payload = EPI:MUT:<id>:<token> dan bisa diurai kembali', () => {
		const p = qrPayloadMutasi({ id: 12, qr_token: 'abc-123' });
		expect(p).toBe('EPI:MUT:12:abc-123');
		expect(parseQrMutasi(p as string)).toEqual({ id: 12, token: 'abc-123' });
	});
	it('tanpa token = tidak ada payload; QR lain / sampah ditolak', () => {
		expect(qrPayloadMutasi({ id: 1, qr_token: null })).toBeNull();
		expect(parseQrMutasi('EPI:SJ:5:xyz')).toBeNull();
		expect(parseQrMutasi('')).toBeNull();
		expect(parseQrMutasi('EPI:MUT:abc:tok')).toBeNull();
	});
	it('QR hanya ditampilkan untuk dokumen disetujui s/d lolos gerbang', () => {
		expect(['diajukan', 'ditolak', 'batal', 'diterima', 'diterima_sebagian'].some(bisaTampilQr)).toBe(false);
		expect(['disetujui_tujuan', 'dikirim', 'lolos_gerbang'].every(bisaTampilQr)).toBe(true);
	});
});

describe('jalur lapangan & validasi ke workshop', () => {
	it('lapangan mengajukan ke proyek lain atau ke workshop; workshop Ciketing & Balaraja tersedia', () => {
		expect(JENIS_LAPANGAN.map((j) => j.value)).toEqual(['proyek_ke_proyek', 'proyek_ke_workshop']);
		expect(WORKSHOP_TUJUAN.map((w) => w.id)).toEqual([1, 2]);
	});
	const dasar = { alasan: 'Kompresor rusak dikirim ke workshop untuk servis', items: [{ item_id: 1, qty: 1, maks: 1 }] };
	it('id proyek asal boleh sama dengan id workshop tujuan (beda ruang id)', () => {
		expect(validasiForm({ jenis: 'proyek_ke_workshop', asal: 1, tujuan: 1, ...dasar })).toBeNull();
	});
	it('proyek → proyek dengan id sama tetap ditolak; tujuan kosong menyebut workshop', () => {
		expect(validasiForm({ jenis: 'proyek_ke_proyek', asal: 3, tujuan: 3, ...dasar })).toMatch(/tidak boleh sama/);
		expect(validasiForm({ jenis: 'proyek_ke_workshop', asal: 3, tujuan: '', ...dasar })).toMatch(/workshop/i);
	});
});
