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
