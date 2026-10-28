// src/lib/pdf-templates/laporanHarianLapangan.ts
// Template HTML untuk PDF "Laporan Harian" milik leader sendiri (Fase 6 & Fase 4,
// "download PDF laporan sendiri" — mencakup progress fisik, K3/HSE, QC ambient ISO 8502-4,
// downtime log, material variance, dan dokumentasi foto lapangan).

function esc(v: unknown): string {
	return String(v ?? '-').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function parseField<T>(val: unknown, fallback: T): T {
	if (!val) return fallback;
	if (typeof val === 'string') {
		try {
			return JSON.parse(val) as T;
		} catch {
			return fallback;
		}
	}
	return val as T;
}

function rows(items: any[], cols: { key: string; label: string }[]): string {
	if (!items.length) return `<tr><td colspan="${cols.length}" class="empty">Tidak ada data</td></tr>`;
	return items
		.map((item) => '<tr>' + cols.map((c) => `<td>${esc(item[c.key])}</td>`).join('') + '</tr>')
		.join('');
}

export interface LaporanHarianLapanganData {
	projectName: string;
	date: string;
	weather?: string;
	activity_status?: string;
	overall_progress?: number | null;
	issues_general?: string;
	general_notes?: string;
	tomorrow_plan_summary?: string;
	schedule?: unknown;
	progress?: unknown;
	material_used?: unknown;
	manpower?: unknown;
	tools?: unknown;
	issues?: unknown;
	tomorrow_plan?: unknown;
	photos?: Array<{ url: string; label: string; category?: string }>;
	hse_daily?: unknown;
	downtime_log?: unknown;
	qc_ambient?: unknown;
	material_variance?: unknown;
	client_instructions?: unknown;
}

export function buildLaporanHarianLapanganHtml(data: LaporanHarianLapanganData): string {
	const progress = parseField<any[]>(data.progress, []);
	const materialUsed = parseField<any[]>(data.material_used, []);
	const manpower = parseField<any[]>(data.manpower, []);
	const tools = parseField<any[]>(data.tools, []);
	const issues = parseField<any[]>(data.issues, []);
	const tomorrowPlan = parseField<any[]>(data.tomorrow_plan, []);
	const photos = data.photos || [];

	const hseDaily = parseField<any>(data.hse_daily, null);
	const downtimeLog = parseField<any[]>(data.downtime_log, []);
	const qcAmbient = parseField<any>(data.qc_ambient, null);
	const materialVariance = typeof data.material_variance === 'string' ? data.material_variance.trim() : (data.material_variance ? String(data.material_variance) : '');
	const clientInstructions = typeof data.client_instructions === 'string' ? data.client_instructions.trim() : (data.client_instructions ? String(data.client_instructions) : '');

	// HSE / K3 Section
	let hseHtml = '';
	if (hseDaily) {
		const apdStatus = hseDaily.apd_compliance || (hseDaily.apd_complete ? 'Lengkap Sesuai Standar K3' : 'Lengkap Sesuai Standar K3');
		const topic = hseDaily.tbm_topic || hseDaily.toolbox_topic || '-';
		const time = hseDaily.tbm_time || '-';
		const notes = hseDaily.hse_notes || '-';
		hseHtml = `
		<h2>Keselamatan &amp; Kesehatan Kerja (K3 / HSE)</h2>
		<table>
			<thead><tr><th style="width: 30%;">Parameter</th><th>Keterangan / Hasil Pemeriksaan</th></tr></thead>
			<tbody>
				<tr><td><strong>Kepatuhan APD</strong></td><td><strong style="color: #16a34a;">${esc(apdStatus)}</strong></td></tr>
				<tr><td><strong>Toolbox Meeting (TBM)</strong></td><td>Topik: ${esc(topic)} ${time !== '-' ? `(Pukul ${esc(time)})` : ''}</td></tr>
				${notes !== '-' ? `<tr><td><strong>Catatan K3 / Safety</strong></td><td>${esc(notes)}</td></tr>` : ''}
			</tbody>
		</table>`;
	}

	// QC Ambient ISO 8502-4
	let qcHtml = '';
	if (qcAmbient && (qcAmbient.temp_air || qcAmbient.temp_steel || qcAmbient.relative_humidity || qcAmbient.dew_point)) {
		const tempAir = Number(qcAmbient.temp_air || 0);
		const tempSteel = Number(qcAmbient.temp_steel || 0);
		const rh = Number(qcAmbient.relative_humidity || 0);
		const dewPoint = Number(qcAmbient.dew_point || 0);
		const delta = tempSteel - dewPoint;
		const isSafe = delta >= 3 && rh <= 85;
		qcHtml = `
		<h2>Parameter Lingkungan QC Ambient (ISO 8502-4)</h2>
		<table>
			<thead>
				<tr>
					<th>Suhu Udara (&deg;C)</th>
					<th>Suhu Substrat (&deg;C)</th>
					<th>Kelembaban (RH %)</th>
					<th>Titik Embun (&deg;C)</th>
					<th>&Delta;T Substrat - Dew</th>
					<th>Kondisi Aplikasi Coating</th>
				</tr>
			</thead>
			<tbody>
				<tr>
					<td>${tempAir}&deg;C</td>
					<td>${tempSteel}&deg;C</td>
					<td>${rh}%</td>
					<td>${dewPoint}&deg;C</td>
					<td><strong>+${delta.toFixed(1)}&deg;C</strong> (&ge; +3.0&deg;C)</td>
					<td><strong style="color: ${isSafe ? '#16a34a' : '#dc2626'}">${isSafe ? 'MEMENUHI SYARAT (SAFE)' : 'PERINGATAN / DILUAR AMBANG'}</strong></td>
				</tr>
			</tbody>
		</table>
		${qcAmbient.inspection_no ? `<p style="font-size: 9.5px; color: #555; margin-top: 2px;">Terkait Nomor Inspeksi QC BPIR: <strong>${esc(qcAmbient.inspection_no)}</strong></p>` : ''}`;
	}

	// Downtime Log
	let downtimeHtml = '';
	if (Array.isArray(downtimeLog) && downtimeLog.length > 0) {
		const validLogs = downtimeLog.filter((item: any) => item && (item.hours || item.duration || item.reason));
		if (validLogs.length > 0) {
			const totalHours = validLogs.reduce((acc: number, d: any) => acc + (Number(d.hours || d.duration) || 0), 0);
			downtimeHtml = `
			<h2>Log Jam Henti / Downtime (${validLogs.length} Kejadian — Total ${totalHours} Jam)</h2>
			<table>
				<thead><tr><th style="width: 28%;">Alasan / Kendala</th><th style="width: 14%;">Jam Henti</th><th>Keterangan / Personel Terdampak</th></tr></thead>
				<tbody>
					${validLogs.map((item: any) => `
						<tr>
							<td><strong>${esc(item.reason_label || item.reason || 'Kendala Lapangan')}</strong></td>
							<td><strong>${esc(item.hours || item.duration || 0)} Jam</strong></td>
							<td>${esc(item.notes || '-')} ${item.affected_workers ? `(${esc(item.affected_workers)} personel)` : ''}</td>
						</tr>
					`).join('')}
				</tbody>
			</table>`;
		}
	}

	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
	@page { margin: 16mm 14mm; }
	body { font-family: Arial, Helvetica, sans-serif; font-size: 11px; color: #1a1a1a; }
	h1 { font-size: 16px; margin: 0 0 2px; }
	.subtitle { font-size: 11px; color: #555; margin: 0 0 4px; }
	.meta { font-size: 11px; color: #333; margin-bottom: 14px; }
	.meta span { margin-right: 16px; }
	h2 { font-size: 13px; margin: 16px 0 6px; border-bottom: 1px solid #ddd; padding-bottom: 3px; }
	table { width: 100%; border-collapse: collapse; margin-bottom: 6px; }
	th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; vertical-align: top; }
	th { background: #1F6592; color: #fff; font-size: 10px; text-transform: uppercase; }
	td.empty { text-align: center; color: #888; font-style: italic; }
	.note-block { border: 1px solid #ddd; border-radius: 4px; padding: 8px 10px; margin-bottom: 6px; white-space: pre-wrap; }
	.photo-grid { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 6px; }
	.photo-card { width: 48%; border: 1px solid #ccc; border-radius: 4px; padding: 6px; box-sizing: border-box; page-break-inside: avoid; background: #fafafa; }
	.photo-img-box { width: 100%; height: 160px; overflow: hidden; background: #eee; text-align: center; border-radius: 2px; }
	.photo-img-box img { width: 100%; height: 100%; object-fit: cover; }
	.photo-title { font-size: 9.5px; font-weight: bold; margin-top: 4px; color: #111; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.photo-category { font-size: 8.5px; color: #1F6592; margin-top: 1px; font-weight: 600; }
</style>
</head>
<body>
	<h1>Laporan Harian — ${esc(data.projectName)}</h1>
	<p class="subtitle">Dicetak dari aplikasi lapangan EPI</p>
	<p class="meta">
		<span><strong>Tanggal:</strong> ${esc(data.date)}</span>
		<span><strong>Cuaca:</strong> ${esc(data.weather)}</span>
		<span><strong>Status:</strong> ${esc(data.activity_status)}</span>
		${data.overall_progress != null ? `<span><strong>Progress Keseluruhan:</strong> ${esc(data.overall_progress)}%</span>` : ''}
	</p>

	<h2>Progress Hari Ini</h2>
	<table>
		<thead><tr><th>Aktivitas</th><th>Kategori</th><th>Nilai</th><th>Satuan</th><th>Catatan</th></tr></thead>
		<tbody>${rows(progress, [
			{ key: 'activity', label: 'Aktivitas' },
			{ key: 'category', label: 'Kategori' },
			{ key: 'progress_value', label: 'Nilai' },
			{ key: 'unit', label: 'Satuan' },
			{ key: 'notes', label: 'Catatan' }
		])}</tbody>
	</table>

	<h2>Material Terpakai</h2>
	<table>
		<thead><tr><th>Jenis</th><th>Jumlah</th><th>Satuan</th><th>Catatan</th></tr></thead>
		<tbody>${rows(materialUsed, [
			{ key: 'type', label: 'Jenis' },
			{ key: 'amount', label: 'Jumlah' },
			{ key: 'unit', label: 'Satuan' },
			{ key: 'notes', label: 'Catatan' }
		])}</tbody>
	</table>

	<h2>Manpower</h2>
	<table>
		<thead><tr><th>Peran</th><th>Jumlah</th><th>Catatan</th></tr></thead>
		<tbody>${rows(manpower, [
			{ key: 'role', label: 'Peran' },
			{ key: 'count', label: 'Jumlah' },
			{ key: 'notes', label: 'Catatan' }
		])}</tbody>
	</table>

	<h2>Peralatan &amp; Kondisi P2H</h2>
	<table>
		<thead><tr><th>Nama Alat</th><th>Kategori</th><th>Hasil P2H</th><th>Kondisi Unit</th><th>Jam Kerja (HM)</th><th>Operator</th></tr></thead>
		<tbody>${rows(tools, [
			{ key: 'name', label: 'Nama' },
			{ key: 'category', label: 'Kategori' },
			{ key: 'p2h_result', label: 'Hasil P2H' },
			{ key: 'status_unit', label: 'Kondisi Unit' },
			{ key: 'hoursmeter', label: 'HM' },
			{ key: 'operator', label: 'Operator' }
		])}</tbody>
	</table>

	${hseHtml}
	${qcHtml}
	${downtimeHtml}

	<h2>Kendala / Isu</h2>
	<table>
		<thead><tr><th>Deskripsi</th></tr></thead>
		<tbody>${rows(issues, [{ key: 'description', label: 'Deskripsi' }])}</tbody>
	</table>
	${data.issues_general ? `<div class="note-block"><strong>Kendala umum:</strong> ${esc(data.issues_general)}</div>` : ''}

	${materialVariance ? `<h2>Catatan Deviasi Material</h2><div class="note-block">${esc(materialVariance)}</div>` : ''}
	${clientInstructions ? `<h2>Instruksi Pengawas Klien &amp; Site Memo (Potensi VO)</h2><div class="note-block">${esc(clientInstructions)}</div>` : ''}

	<h2>Rencana Besok</h2>
	<table>
		<thead><tr><th>Aktivitas</th><th>Catatan</th></tr></thead>
		<tbody>${rows(tomorrowPlan, [
			{ key: 'activity', label: 'Aktivitas' },
			{ key: 'notes', label: 'Catatan' }
		])}</tbody>
	</table>
	${data.tomorrow_plan_summary ? `<div class="note-block">${esc(data.tomorrow_plan_summary)}</div>` : ''}

	${data.general_notes ? `<h2>Catatan Umum</h2><div class="note-block">${esc(data.general_notes)}</div>` : ''}

	${photos.length > 0 ? `
		<h2>Lampiran Dokumentasi Foto Lapangan (${photos.length} Foto Pilihan)</h2>
		<div class="photo-grid">
			${photos.map((ph, idx) => `
				<div class="photo-card">
					<div class="photo-img-box">
						<img src="${ph.url}" alt="${esc(ph.label)}" onerror="this.style.display='none'" />
					</div>
					<div class="photo-title">#${idx + 1} — ${esc(ph.label)}</div>
					<div class="photo-category">${esc(ph.category || 'Dokumentasi Lapangan')}</div>
				</div>
			`).join('')}
		</div>
	` : ''}
</body>
</html>`;
}
