// SJ-06 / SJH-19 Layar C — logika murni form "Cek Barang Sebelum Kirim" (validasi + ringkasan konfirmasi).
// Aturan SAMA dengan server (sjVerifikasiFisik.ts + endpoint verifikasi-fisik): server tetap menegakkan, ini hanya UX.

export const MIN_CATATAN = 5;

export type ItemSj = { id: number | string; nama_barang?: string | null; qty_required?: number | null; qty_delivered?: number | null; unit?: string | null };
export type BarisVerif = { status: '' | 'sesuai' | 'qty_dikoreksi' | 'tidak_dimuat'; qty: string; alasan: string; note: string };

export const qtyDiSj = (it: ItemSj) => Number(it.qty_delivered) || Number(it.qty_required) || 0;
const nama = (it: ItemSj) => it.nama_barang || `Item #${it.id}`;

/** Satu entri per item yang BELUM valid. Kosong = boleh simpan. */
export function validasiVerifikasi(items: ItemSj[], rows: Record<string, BarisVerif>): { id: string; pesan: string }[] {
	const out: { id: string; pesan: string }[] = [];
	for (const it of items) {
		const id = String(it.id);
		const r = rows[id];
		if (!r || !r.status) { out.push({ id, pesan: `Tandai "${nama(it)}" dulu.` }); continue; }
		if (r.status === 'sesuai') continue;
		if (r.status === 'qty_dikoreksi') {
			const q = Number(r.qty);
			if (r.qty === '' || !Number.isFinite(q) || q < 0) { out.push({ id, pesan: 'Isi jumlah yang benar-benar ada.' }); continue; }
			if (q >= qtyDiSj(it)) { out.push({ id, pesan: `Jumlah harus kurang dari ${qtyDiSj(it)} — kalau sama, pilih "Sesuai".` }); continue; }
		}
		if ((r.note || '').trim().length < MIN_CATATAN) out.push({ id, pesan: `Isi alasan min. ${MIN_CATATAN} huruf.` });
	}
	return out;
}

/** Teks ringkasan untuk dialog konfirmasi: "8 barang: 7 sesuai, 1 jumlah beda (Thinner A: 10 → 8 L)." */
export function ringkasVerifikasi(items: ItemSj[], rows: Record<string, BarisVerif>): { teks: string; selisih: number } {
	let sesuai = 0;
	const beda: string[] = [];
	const hilang: string[] = [];
	for (const it of items) {
		const r = rows[String(it.id)];
		if (!r || !r.status) continue;
		if (r.status === 'sesuai') sesuai++;
		else if (r.status === 'qty_dikoreksi') beda.push(`${nama(it)}: ${qtyDiSj(it)} → ${Number(r.qty) || 0}${it.unit ? ' ' + it.unit : ''}`);
		else hilang.push(nama(it));
	}
	const bagian = [`${sesuai} sesuai`];
	if (beda.length) bagian.push(`${beda.length} jumlah beda (${beda.join('; ')})`);
	if (hilang.length) bagian.push(`${hilang.length} tidak ada (${hilang.join('; ')})`);
	return { teks: `${items.length} barang: ${bagian.join(', ')}.`, selisih: beda.length + hilang.length };
}

/** Nilai tombol −/+ jumlah: bulat → langkah 1, pecahan → 0.01; selalu 0 ≤ n < qty SJ. */
export function geserQty(qtySj: number, sekarang: number, delta: number): number {
	const langkahMax = Number.isInteger(qtySj) ? 1 : 0.01;
	const maxQ = Math.max(0, qtySj - langkahMax);
	const n = Math.min(maxQ, Math.max(0, (Number.isFinite(sekarang) ? sekarang : 0) + delta));
	return Math.round(n * 100) / 100;
}
