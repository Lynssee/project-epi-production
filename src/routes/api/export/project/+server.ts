// src/routes/api/export/project/+server.ts
// Fase "Export Universal — Dashboard Lapangan" (§5.2 + §5.4 rencana).
//
// Satu-satunya jalur PDF untuk export lapangan (Q3: Gotenberg server saja, tanpa
// fallback klien). Klien sudah meratakan data lewat flattener lapangan (TANPA
// kolom harga — §5.4 poin 3) lalu POST { projectId, section, title, columns, rows }.
// Endpoint ini:
//   1. Autentikasi (Firebase → karyawan).
//   2. Tolak `section` di luar DAFTAR PUTIH lapangan (403 + log) — walau payload
//      direkayasa dari klien (§5.4 poin 2).
//   3. "Akses proyek sendiri saja" (P1): pemanggil WAJIB Project Leader / Manpower
//      Leader / Wakil di proyek yang diminta — kalau tidak, 403.
//   4. Render HTML ringan → Gotenberg → balas PDF stream.
//   5. Gotenberg mati → 502 dengan pesan jelas + saran "unduh Excel".

import { error, type RequestEvent } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { resolveManpowerByEmail } from '$lib/server/manpowerLeaderGuard';
import { directusServerJson, directusServerFetch } from '$lib/server/directus';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { FIELD_EXPORT_SECTION_KEYS } from '$lib/config/fieldExportRegistry';
import QRCode from 'qrcode';

const MAX_ROWS = 5000;
const MAX_PHOTOS = 60;
const FOTO_SECTION = 'laporan-harian-foto';
const idOf = (v: any) => (v && typeof v === 'object' ? v.id : v);

/** Ambil 1 aset Directus → data URI (server-side; klien tak pernah pegang token). */
async function assetDataUri(fileId: string): Promise<string | null> {
	try {
		const res = await directusServerFetch(
			`/assets/${encodeURIComponent(fileId)}?width=560&quality=62&fit=inside`
		);
		if (!res.ok) return null;
		const ct = res.headers.get('content-type') || 'image/jpeg';
		const buf = Buffer.from(await res.arrayBuffer());
		if (buf.length === 0 || buf.length > 2_500_000) return null;
		return `data:${ct};base64,${buf.toString('base64')}`;
	} catch {
		return null;
	}
}

function buildPhotoGridHtml(opts: {
	title: string;
	projectName: string;
	printedBy: string;
	photos: Array<{ tanggal: string; kategori: string; keterangan: string; src: string }>;
	qrDataUrl?: string;
}): string {
	const { title, projectName, printedBy, photos, qrDataUrl } = opts;
	const now = new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
	const cells = photos
		.map(
			(p) => `<figure>
<img src="${esc(p.src)}" alt="foto">
<figcaption><b>${esc(p.tanggal)}</b> · ${esc(p.kategori)}<br>${esc(p.keterangan)}</figcaption>
</figure>`
		)
		.join('');
	return `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:10px;color:#111;padding:22px}
h1{font-size:15px}.sub{font-size:10px;color:#555;margin-bottom:10px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
figure{border:1px solid #cbd5e1;border-radius:4px;overflow:hidden;page-break-inside:avoid}
figure img{width:100%;height:150px;object-fit:cover;display:block;background:#f1f5f9}
figcaption{padding:4px 6px;font-size:8px;line-height:1.3;color:#475569}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.qr img{width:70px;height:70px}
.foot{margin-top:12px;font-size:8px;color:#64748b}
</style></head><body>
<div class="hdr"><div><h1>${esc(title)}</h1>
<div class="sub">Proyek: ${esc(projectName)} · ${esc(photos.length)} foto · Dibuat: ${esc(now)}</div></div>
${qrDataUrl ? `<div class="qr"><img src="${esc(qrDataUrl)}" alt="QR"></div>` : ''}</div>
<div class="grid">${cells || '<p>Tidak ada foto pada rentang yang dipilih.</p>'}</div>
<div class="foot">Dicetak oleh ${esc(printedBy)} — ${esc(now)} · PT Eltama Prima Indo · dokumen lapangan.</div>
</body></html>`;
}

function esc(v: unknown): string {
	return String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

function buildHtml(opts: {
	title: string;
	projectName: string;
	printedBy: string;
	columns: Array<{ header: string; key: string }>;
	rows: Array<Record<string, unknown>>;
	qrDataUrl?: string;
	verifyUrl?: string;
}): string {
	const { title, projectName, printedBy, columns, rows, qrDataUrl, verifyUrl } = opts;
	const now = new Date().toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
	const thead = columns.map((c) => `<th>${esc(c.header)}</th>`).join('');
	const tbody = rows
		.map(
			(r) =>
				`<tr>${columns.map((c) => `<td>${esc(r?.[c.key])}</td>`).join('')}</tr>`
		)
		.join('');
	// Gaya selaras dengan pdf-templates/laporanHarianLapangan.ts (ringkas, hemat).
	return `<!doctype html><html lang="id"><head><meta charset="utf-8"><style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,"Segoe UI",Roboto,Arial,sans-serif;font-size:10px;color:#111;padding:24px}
h1{font-size:15px;margin-bottom:2px}
.sub{font-size:10px;color:#555;margin-bottom:12px}
table{width:100%;border-collapse:collapse;margin-top:6px}
th,td{border:1px solid #cbd5e1;padding:4px 6px;text-align:left;vertical-align:top}
th{background:#f1f5f9;font-weight:700;font-size:9px;text-transform:uppercase;letter-spacing:.02em}
tr:nth-child(even) td{background:#f8fafc}
.foot{margin-top:14px;font-size:8px;color:#64748b}
.hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:16px}
.qr{text-align:center;flex-shrink:0}
.qr img{width:74px;height:74px}
.qr span{display:block;font-size:6.5px;color:#94a3b8;max-width:90px;line-height:1.2;margin-top:2px}
</style></head><body>
<div class="hdr">
<div>
<h1>${esc(title)}</h1>
<div class="sub">Proyek: ${esc(projectName)} &nbsp;•&nbsp; ${esc(rows.length)} baris &nbsp;•&nbsp; Dibuat: ${esc(now)}</div>
</div>
${
	qrDataUrl
		? `<div class="qr"><img src="${esc(qrDataUrl)}" alt="QR verifikasi"><span>Pindai untuk buka proyek. Data dapat berubah setelah verifikasi.</span></div>`
		: ''
}
</div>
<table><thead><tr>${thead}</tr></thead><tbody>${tbody || `<tr><td colspan="${columns.length}">Tidak ada data.</td></tr>`}</tbody></table>
<div class="foot">Dicetak oleh ${esc(printedBy)} — ${esc(now)} · PT Eltama Prima Indo · dokumen lapangan, angka dapat berubah setelah verifikasi.${verifyUrl ? ` · ${esc(verifyUrl)}` : ''}</div>
</body></html>`;
}

export async function POST(event: RequestEvent) {
	const { user, karyawan } = await authenticateEss(event);

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Body harus JSON.');
	}

	const projectId = Number(body?.projectId);
	const section = String(body?.section || '');
	const title = String(body?.title || 'Laporan Proyek').slice(0, 120);
	const columns: Array<{ header: string; key: string }> = Array.isArray(body?.columns)
		? body.columns
				.filter((c: any) => c && typeof c.header === 'string' && typeof c.key === 'string')
				.slice(0, 40)
				.map((c: any) => ({ header: String(c.header), key: String(c.key) }))
		: [];
	const rows: Array<Record<string, unknown>> = Array.isArray(body?.rows)
		? body.rows.slice(0, MAX_ROWS)
		: [];

	if (!Number.isFinite(projectId) || projectId <= 0) throw error(400, 'projectId tidak valid.');
	if (columns.length === 0) throw error(400, 'Definisi kolom kosong.');

	// (2) DAFTAR PUTIH — tolak section sensitif walau dikirim paksa dari klien.
	if (!FIELD_EXPORT_SECTION_KEYS.includes(section)) {
		console.warn(
			`[export/project] TOLAK section "${section}" (di luar daftar putih lapangan) — user=${user.email} project=${projectId}`
		);
		throw error(403, 'Jenis laporan ini tidak tersedia untuk dashboard lapangan.');
	}

	// (3) Akses proyek sendiri saja.
	const project = await directusServerJson<{ data: any }>(
		`/items/projects/${projectId}?fields=id,name,leader,leader_id,manpower_leader_id,manpower_leader_wakil_id`
	)
		.then((r) => r?.data)
		.catch(() => null);
	if (!project) throw error(404, 'Proyek tidak ditemukan.');

	const namaKry = (karyawan.nama_karyawan || '').trim().toUpperCase();
	let boleh =
		(project.leader_id != null && String(idOf(project.leader_id)) === String(karyawan.id)) ||
		(namaKry.length > 0 && String(project.leader || '').toUpperCase().includes(namaKry));

	if (!boleh) {
		// Cadangan: kursi Manpower Leader / Wakil (tertaut ke tabel `manpower`, bukan `karyawan`).
		const manpower = await resolveManpowerByEmail(user.email).catch(() => null);
		if (manpower) {
			boleh =
				String(idOf(project.manpower_leader_id)) === String(manpower.id) ||
				String(idOf(project.manpower_leader_wakil_id)) === String(manpower.id);
		}
	}
	if (!boleh) {
		console.warn(
			`[export/project] TOLAK akses — user=${user.email} bukan leader proyek ${projectId}`
		);
		throw error(403, 'Anda hanya bisa mengekspor data proyek yang Anda pegang.');
	}

	// (4) Render → Gotenberg. QR di header → tautan verifikasi ke halaman proyek
	// (B2 §7): mencegah PDF kedaluwarsa beredar di grup WA sebagai data terkini.
	const verifyUrl = `${event.url.origin}/proyek/${projectId}`;
	let qrDataUrl: string | undefined;
	try {
		qrDataUrl = await QRCode.toDataURL(verifyUrl, { width: 148, margin: 0 });
	} catch {
		qrDataUrl = undefined; // QR gagal ≠ gagal PDF
	}

	const projName = project.name || `Proyek #${projectId}`;
	const printedBy = karyawan.nama_karyawan || user.email || 'pengguna';

	let html: string;
	if (section === FOTO_SECTION) {
		// B3 §7 — grid foto: resolve fileId → gambar DI SERVER (hemat memori HP).
		const wanted = rows
			.filter((r) => r && typeof r.fileId === 'string' && (r.fileId as string).length > 0)
			.slice(0, MAX_PHOTOS);
		const photos: Array<{ tanggal: string; kategori: string; keterangan: string; src: string }> = [];
		for (const r of wanted) {
			const src = await assetDataUri(String(r.fileId));
			if (src) {
				photos.push({
					tanggal: String(r.tanggal ?? ''),
					kategori: String(r.kategori ?? ''),
					keterangan: String(r.keterangan ?? ''),
					src
				});
			}
		}
		html = buildPhotoGridHtml({ title, projectName: projName, printedBy, photos, qrDataUrl });
	} else {
		html = buildHtml({ title, projectName: projName, printedBy, columns, rows, qrDataUrl, verifyUrl });
	}

	let pdf: Buffer;
	try {
		pdf = await htmlToPdf(html, {
			landscape: section !== FOTO_SECTION && columns.length > 6,
			filename: `${section}.html`
		});
	} catch (e: any) {
		console.error('[export/project] Gotenberg gagal:', e?.message);
		throw error(502, 'Layanan PDF sedang tidak tersedia. Silakan unduh versi Excel.');
	}

	const safeName = `${section}-${projectId}-${new Date().toISOString().slice(0, 10)}.pdf`;
	return new Response(Uint8Array.from(pdf), {
		headers: {
			'Content-Type': 'application/pdf',
			'Content-Disposition': `attachment; filename="${safeName}"`
		}
	});
}
