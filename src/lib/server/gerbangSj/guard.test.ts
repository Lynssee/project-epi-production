// GSP-01 §4.5 — aturan "satu pintu" sebagai test: HANYA actions.ts yang boleh menulis jejak lolos-gerbang
// (security_verified_at / security_verified_by) ke surat_jalan. Menggantikan aturan CI berbasis grep, karena
// .github/workflows/ dilindungi (butuh izin Lead). Jalankan: npx vitest run src/lib/server/gerbangSj/guard
//
// Catatan: PATCH `status: 'shipped'` TIDAK dipakai sebagai penanda, karena ada jalur sah non-gerbang
// (kiosk muat-sj untuk kategori tanpa satpam: sjMuatRule; driver POD peminjaman). Jejak satpam itulah yang
// membedakan "diloloskan di gerbang".
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const SRC = join(process.cwd(), 'src');
// legacy: dihapus setelah 7 hari tanpa panggilan di produksi (GSP-01 §4.5). Tidak boleh bertambah.
// workshop.ts (WSK-35 4b) = pintu gerbang untuk SJ Keluar WORKSHOP (koleksi ciketing_/balaraja_surat_jalan_keluar) — masih di dalam modul gerbangSj.
// retur.ts (RSM-04) = pintu gerbang MASUK untuk dokumen retur_gudang (koleksi retur_gudang, bukan surat_jalan) — tetap di dalam modul gerbangSj.
// mutasi.ts (RSM-13) = pintu gerbang untuk e-SJ Mutasi rute via_gudang (koleksi mutasi_barang) — tetap di dalam modul gerbangSj.
const ALLOW = new Set(['lib/server/gerbangSj/actions.ts', 'lib/server/gerbangSj/workshop.ts', 'lib/server/gerbangSj/retur.ts', 'lib/server/gerbangSj/mutasi.ts', 'lib/server/sjGerbang.ts']);
const EXT = /\.(ts|js|svelte)$/;

function walk(dir: string, out: string[] = []): string[] {
	for (const name of readdirSync(dir)) {
		const p = join(dir, name);
		const st = statSync(p);
		if (st.isDirectory()) walk(p, out);
		else if (EXT.test(name) && !/\.test\.(ts|js)$/.test(name)) out.push(p);
	}
	return out;
}

describe('GSP-01 §4.5 — satu pintu penulisan lolos-gerbang', () => {
	it('security_verified_at/by hanya ditulis oleh gerbangSj/actions.ts (+ legacy sjGerbang.ts)', () => {
		const pelanggar: string[] = [];
		for (const f of walk(SRC)) {
			const rel = relative(SRC, f).split(sep).join('/');
			if (ALLOW.has(rel)) continue;
			const teks = readFileSync(f, 'utf8');
			// penulisan = menyebut kunci DAN ada PATCH di berkas yang sama (membaca/mengetik kolom tidak dihitung)
			if (/security_verified_(at|by)\s*:/.test(teks) && /method:\s*['"]PATCH['"]/.test(teks)) pelanggar.push(rel);
		}
		expect(pelanggar, `File ini menulis jejak lolos-gerbang di luar modul gerbangSj: ${pelanggar.join(', ')}`).toEqual([]);
	}, 30000);

	it('route /api/kiosk/gerbang-sj/* dan sj-security-check tidak menulis Directus sendiri', () => {
		const route = [
			'routes/api/kiosk/gerbang-sj/loloskan/+server.ts', 'routes/api/kiosk/gerbang-sj/tahan/+server.ts',
			'routes/api/kiosk/gerbang-sj/lookup/+server.ts', 'routes/api/kiosk/gerbang-sj/antrian/+server.ts',
			'routes/api/kiosk/gerbang-sj/foto/+server.ts', 'routes/api/sj-security-check/+server.ts'
		];
		for (const r of route) {
			const teks = readFileSync(join(SRC, r), 'utf8');
			expect(teks, `${r} tidak boleh memanggil directusServerJson langsung`).not.toMatch(/directusServerJson|directusServerFetch/);
		}
	});
});
