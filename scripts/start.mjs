// scripts/start.mjs — `npm start`: jalankan hasil build adapter-node (build/index.js).
//
// Memuat env dengan urutan prioritas yang SAMA seperti Vite (dulu `vite dev`):
//   .env.production.local > .env.production > .env.local > .env
// process.loadEnvFile() tidak menimpa variabel yang sudah ada, jadi file pertama yang memuat
// sebuah key yang menang; env dari shell/service tetap paling tinggi. Sebelumnya `npm start`
// hanya membaca `.env`, sehingga secret yang tersimpan di `.env.local` (terbaca saat `vite dev`)
// hilang di mode produksi → kiosk login 503 "KIOSK_SESSION_SECRET belum dikonfigurasi".
import { existsSync } from 'node:fs';

const ENV_FILES = ['.env.production.local', '.env.production', '.env.local', '.env'];
const loaded = [];
for (const file of ENV_FILES) {
	if (!existsSync(file)) continue;
	try {
		process.loadEnvFile(file);
		loaded.push(file);
	} catch (e) {
		console.warn(`[start] Gagal membaca ${file}: ${e instanceof Error ? e.message : e}`);
	}
}
console.log(`[start] Env dimuat dari: ${loaded.length ? loaded.join(', ') : '(tidak ada file .env)'}`);

// Hanya NAMA yang dicetak, tidak pernah nilainya. Tidak menghentikan server — fitur lain tetap
// jalan; endpoint yang butuh env ini sudah menolak sendiri dengan 503 yang jelas.
const REQUIRED = [
	['DIRECTUS_API_URL', 'VITE_DIRECTUS_API_URL'],
	['DIRECTUS_TOKEN', 'VITE_DIRECTUS_TOKEN'],
	['KIOSK_SESSION_SECRET'],
	['WORKSTATION_HMAC_SECRET']
];
const missing = REQUIRED.filter((keys) => !keys.some((k) => process.env[k])).map((keys) => keys[0]);
if (missing.length) {
	console.warn(`[start] ⚠ Env wajib belum diisi: ${missing.join(', ')} — lihat .env.example.`);
}

if (!existsSync(new URL('../build/index.js', import.meta.url))) {
	console.error('[start] Folder build/ tidak ditemukan — jalankan `npm run build` dulu.');
	process.exit(1);
}

process.env.PORT = process.env.PORT || '5174';
await import('../build/index.js');
