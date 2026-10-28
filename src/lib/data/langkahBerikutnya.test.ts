import { describe, expect, it } from 'vitest';
import { pilihLangkah, type LangkahBooking } from './langkahBerikutnya';

const NOW = new Date('2026-09-30T05:00:00Z').getTime();
const jam = (h: number) => new Date(NOW + h * 3600 * 1000).toISOString();
const bk = (over: Partial<LangkahBooking>): LangkahBooking => ({ id: 1, status: 'diajukan', date_created: jam(-2), tanggal_mulai: jam(2), ...over });
const pilih = (l: LangkahBooking[], o: any = {}) => pilihLangkah(l, { now: NOW, adaKontakGa: true, ...o });

describe('prioritas (U8)', () => {
	it('aktif > disetujui > diajukan > ditolak', () => {
		const semua = [bk({ id: 4, status: 'ditolak' }), bk({ id: 3, status: 'diajukan' }), bk({ id: 2, status: 'disetujui', vehicle_id: 1 }), bk({ id: 1, status: 'aktif', vehicle_id: 1 })];
		expect(pilih(semua).booking?.id).toBe(1);
		expect(pilih(semua.slice(0, 3)).booking?.id).toBe(2);
		expect(pilih(semua.slice(0, 2)).booking?.id).toBe(3);
		expect(pilih(semua.slice(0, 1)).booking?.id).toBe(4);
	});
	it('tidak ada → kartu ajukan', () => {
		const k = pilih([bk({ status: 'selesai' }), bk({ status: 'dibatalkan' })]);
		expect(k.kind).toBe('kosong');
		expect(k.utama.aksi).toBe('ajukan');
		expect(pilih([]).kind).toBe('kosong');
	});
	it('beberapa disetujui → yang jadwalnya terdekat dari sekarang', () => {
		const k = pilih([bk({ id: 1, status: 'disetujui', vehicle_id: 1, tanggal_mulai: jam(48) }), bk({ id: 2, status: 'disetujui', vehicle_id: 1, tanggal_mulai: jam(3) })]);
		expect(k.booking?.id).toBe(2);
	});
});

describe('isi kartu per kondisi (tabel §3.8)', () => {
	it('diajukan: tahap & jumlah dari progres nyata', () => {
		const k = pilih([bk({ approval_progress: { current_step: 1, total_steps: 2, step_label: 'MANAGER' } })]);
		expect(k.judul).toBe('Menunggu persetujuan MANAGER (1/2)');
		expect(k.utama.aksi).toBe('detail');
		expect(pilih([bk({})]).judul).toBe('Menunggu persetujuan'); // progres tak tersedia
	});
	it('disetujui + unit ada → Mulai Pakai', () => {
		const k = pilih([bk({ status: 'disetujui', vehicle_id: 5, vehicle: { name: 'Innova', nomor_polisi: 'B 1 XY' } })]);
		expect(k.utama).toEqual({ label: 'Mulai Pakai', aksi: 'mulai_pakai' });
		expect(k.judul).toContain('B 1 XY');
	});
	it('disetujui + unit kosong → Chat GA (bila ada kontak); tanpa kontak → Lihat Detail', () => {
		expect(pilih([bk({ status: 'disetujui', vehicle_id: null })]).utama.aksi).toBe('chat_ga');
		expect(pilih([bk({ status: 'disetujui', vehicle_id: null })], { adaKontakGa: false }).utama.aksi).toBe('detail');
	});
	it('disetujui tanpa kendaraan → Mulai Kunjungan (bukan Mulai Pakai)', () => {
		const k = pilih([bk({ status: 'disetujui', butuh_kendaraan: false })]);
		expect(k.utama).toEqual({ label: 'Mulai Kunjungan', aksi: 'kunjungan' });
	});
	it('aktif site visit belum check-in → Check-in di Lokasi (Kembalikan jadi sekunder)', () => {
		const k = pilih([bk({ status: 'aktif', vehicle_id: 1, tipe_keperluan: 'site_visit', referensi_site_visit_id: null })]);
		expect(k.utama.aksi).toBe('checkin');
		expect(k.sekunder.map((s) => s.aksi)).toContain('kembalikan');
		const sudah = pilih([bk({ status: 'aktif', vehicle_id: 1, tipe_keperluan: 'site_visit', referensi_site_visit_id: 'sv1' })]);
		expect(sudah.utama.aksi).toBe('kembalikan');
	});
	it('aktif biasa → Kembalikan Kendaraan; aktif tanpa kendaraan → Selesaikan Kunjungan', () => {
		expect(pilih([bk({ status: 'aktif', vehicle_id: 1 })]).utama.label).toBe('Kembalikan Kendaraan');
		expect(pilih([bk({ status: 'aktif', butuh_kendaraan: false })]).utama.label).toBe('Selesaikan Kunjungan');
	});
	it('ditolak (≤3 hari) → alasan jujur + Ajukan Ulang; lebih dari 3 hari → diabaikan', () => {
		const baru = pilih([bk({ status: 'ditolak', approver: 'Bu Sari', alasan_tolak: 'Penuh', date_created: jam(-24) })]);
		expect(baru.judul).toBe('Ditolak oleh Bu Sari: Penuh');
		expect(baru.utama.aksi).toBe('ajukan_ulang');
		const lama = pilih([bk({ status: 'ditolak', date_created: jam(-24 * 5) })]);
		expect(lama.kind).toBe('kosong');
	});
});
