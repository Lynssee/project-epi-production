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

export interface SubtaskPhotoPair {
	subtask_name: string;
	category?: string;
	progress_value?: number;
	unit?: string;
	before_url?: string | null;
	before_gps?: string | null;
	after_url?: string | null;
	after_gps?: string | null;
	during_url?: string | null;
	during_gps?: string | null;
	notes?: string;
	kategori_defect?: string;
	tindakan_perbaikan?: string;
	status: 'complete' | 'before_only' | 'after_only' | 'no_photo';
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
	subtask_pairs?: SubtaskPhotoPair[];
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
	if (qcAmbient && (qcAmbient.temp_air || qcAmbient.air_temp || qcAmbient.temp_steel || qcAmbient.steel_temp || qcAmbient.relative_humidity || qcAmbient.dew_point || qcAmbient.concrete_moisture != null)) {
		const tempAir = Number(qcAmbient.air_temp ?? qcAmbient.temp_air ?? 0);
		const tempSteel = Number(qcAmbient.steel_temp ?? qcAmbient.temp_steel ?? 0);
		const rh = Number(qcAmbient.relative_humidity ?? 0);
		const dewPoint = Number(qcAmbient.dew_point ?? 0);
		const concreteMoist = qcAmbient.concrete_moisture != null ? Number(qcAmbient.concrete_moisture) : null;
		const delta = tempSteel - dewPoint;
		const isSafe = delta >= 3 && rh <= 85 && (concreteMoist === null || concreteMoist <= 5);
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
					${concreteMoist != null ? '<th>Kadar Air Beton (%)</th>' : ''}
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
					${concreteMoist != null ? `<td><strong>${concreteMoist}%</strong> (${concreteMoist <= 5 ? 'Aman &le; 5%' : 'Lembab > 5%'})</td>` : ''}
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

	${(() => {
		const subtaskPairs = data.subtask_pairs || [];
		if (!subtaskPairs || subtaskPairs.length === 0) return '';
		const completeCount = subtaskPairs.filter((p) => p.status === 'complete').length;

		return `
		<div style="page-break-before: always; margin-top: 24px;">
			<div style="border-bottom: 2px solid #1F6592; padding-bottom: 8px; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: flex-end;">
				<div>
					<h2 style="font-size: 14px; margin: 0; color: #1F6592; border: none; padding: 0; text-transform: uppercase; letter-spacing: 0.5px;">
						Lampiran: Dokumentasi Mutu Foto Before &amp; After Pekerjaan
					</h2>
					<p style="font-size: 9.5px; color: #555; margin: 3px 0 0;">
						Evidensi visual kondisi substrat pra-aplikasi (Before) dan hasil akhir pekerjaan (After) per subtask berprogres
					</p>
				</div>
				<div style="text-align: right; font-size: 9px; color: #444; line-height: 1.4;">
					<span><strong>Proyek:</strong> ${esc(data.projectName)}</span><br/>
					<span><strong>Tanggal:</strong> ${esc(data.date)}</span> | <span style="color: #16a34a; font-weight: bold;">${completeCount}/${subtaskPairs.length} Subtask Lengkap BA</span>
				</div>
			</div>

			<!-- QC Ambient Summary Mini-Box di Lembar Lampiran -->
			${qcAmbient ? `
				<div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; padding: 6px 10px; margin-bottom: 12px; font-size: 9.5px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
					<div>
						<strong style="color: #0f172a;">Kondisi Lingkungan QC (ISO 8502-4):</strong>
						<span style="margin-left: 8px; color: #334155;">Suhu Udara: <strong>${esc(qcAmbient.air_temp ?? qcAmbient.temp_air ?? '-')} &deg;C</strong></span>
						<span style="margin-left: 8px; color: #334155;">Suhu Substrat: <strong>${esc(qcAmbient.steel_temp ?? qcAmbient.temp_steel ?? '-')} &deg;C</strong></span>
						<span style="margin-left: 8px; color: #334155;">RH: <strong>${esc(qcAmbient.relative_humidity ?? '-')} %</strong></span>
						<span style="margin-left: 8px; color: #334155;">Dew Point: <strong>${esc(qcAmbient.dew_point ?? '-')} &deg;C</strong></span>
						${qcAmbient.concrete_moisture != null ? `<span style="margin-left: 8px; color: #334155;">Kadar Air Beton: <strong>${esc(qcAmbient.concrete_moisture)} %</strong></span>` : ''}
					</div>
					<div>
						${(() => {
							const tStl = Number(qcAmbient.steel_temp ?? qcAmbient.temp_steel ?? 0);
							const dp = Number(qcAmbient.dew_point ?? 0);
							const dlt = tStl - dp;
							const safe = dlt >= 3 && Number(qcAmbient.relative_humidity || 0) <= 85;
							return `<span style="font-weight: bold; padding: 2px 6px; border-radius: 3px; font-size: 8.5px; background: ${safe ? '#dcfce7; color: #166534;' : '#fee2e2; color: #991b1b;'}">
								&Delta;T: +${dlt.toFixed(1)}&deg;C (${safe ? 'AMAN / SAFE' : 'PERINGATAN KONDENSASI'})
							</span>`;
						})()}
					</div>
				</div>
			` : ''}

			<!-- Grid / List Komparasi Before vs After per Subtask -->
			${subtaskPairs.map((pair, idx) => `
				<div style="border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px; margin-bottom: 12px; background: #ffffff; page-break-inside: avoid;">
					<div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 8px;">
						<div>
							<span style="font-size: 11px; font-weight: bold; color: #0f172a;">#${idx + 1}. ${esc(pair.subtask_name)}</span>
							${pair.category ? `<span style="font-size: 9px; color: #64748b; margin-left: 6px;">(${esc(pair.category)})</span>` : ''}
							${pair.progress_value ? `<span style="font-size: 9.5px; font-weight: 600; color: #1F6592; margin-left: 8px;">Realisasi: ${esc(pair.progress_value)} ${esc(pair.unit || '')}</span>` : ''}
						</div>
						<div>
							${pair.status === 'complete' ? `
								<span style="background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; font-size: 8.5px; font-weight: bold; padding: 2px 6px; border-radius: 3px;">
									&#10003; Before &amp; After Lengkap
								</span>
							` : pair.status === 'before_only' ? `
								<span style="background: #fef9c3; color: #854d0e; border: 1px solid #fef08a; font-size: 8.5px; font-weight: bold; padding: 2px 6px; border-radius: 3px;">
									&#9203; Hanya Foto Before
								</span>
							` : pair.status === 'after_only' ? `
								<span style="background: #ffedd5; color: #9a3412; border: 1px solid #fed7aa; font-size: 8.5px; font-weight: bold; padding: 2px 6px; border-radius: 3px;">
									&#9203; Hanya Foto After
								</span>
							` : `
								<span style="background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; font-size: 8.5px; font-weight: bold; padding: 2px 6px; border-radius: 3px;">
									&#9888; Belum Ada Foto
								</span>
							`}
						</div>
					</div>

					<!-- Table 2 Kolom: Kiri Before, Kanan After -->
					<table style="width: 100%; border-collapse: collapse; margin-bottom: 4px; table-layout: fixed;">
						<thead>
							<tr>
								<th style="width: 50%; background: #f1f5f9; color: #334155; border: 1px solid #cbd5e1; font-size: 9px; padding: 4px 6px;">
									BEFORE (Pra-Aplikasi / Kondisi Substrat Awal)
								</th>
								<th style="width: 50%; background: #f0fdf4; color: #166534; border: 1px solid #cbd5e1; font-size: 9px; padding: 4px 6px;">
									AFTER (Pasca-Aplikasi / Hasil Akhir Pekerjaan)
								</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<!-- Kolom Before -->
								<td style="border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; background: #fafafa;">
									${pair.before_url ? `
										<div style="width: 100%; height: 180px; overflow: hidden; background: #eee; text-align: center; border-radius: 3px; border: 1px solid #e2e8f0;">
											<img src="${pair.before_url}" style="width: 100%; height: 100%; object-fit: cover;" alt="Foto Before" />
										</div>
										<div style="font-size: 8px; color: #475569; margin-top: 4px; display: flex; justify-content: space-between;">
											<span>&#128248; Kondisi Substrat</span>
											${pair.before_gps ? `<span style="font-family: monospace;">GPS: ${esc(pair.before_gps)}</span>` : ''}
										</div>
									` : `
										<div style="width: 100%; height: 180px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 3px; display: flex; align-items: center; justify-content: center; text-align: center; color: #94a3b8; font-size: 10px;">
											<div>
												<span style="font-size: 20px; display: block; margin-bottom: 4px;">&#128247;</span>
												Foto Before belum diunggah
											</div>
										</div>
									`}
								</td>

								<!-- Kolom After -->
								<td style="border: 1px solid #cbd5e1; padding: 6px; vertical-align: top; background: #fafafa;">
									${pair.after_url ? `
										<div style="width: 100%; height: 180px; overflow: hidden; background: #eee; text-align: center; border-radius: 3px; border: 1px solid #e2e8f0;">
											<img src="${pair.after_url}" style="width: 100%; height: 100%; object-fit: cover;" alt="Foto After" />
										</div>
										<div style="font-size: 8px; color: #475569; margin-top: 4px; display: flex; justify-content: space-between;">
											<span>&#128248; Hasil Aplikasi</span>
											${pair.after_gps ? `<span style="font-family: monospace;">GPS: ${esc(pair.after_gps)}</span>` : ''}
										</div>
									` : `
										<div style="width: 100%; height: 180px; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 3px; display: flex; align-items: center; justify-content: center; text-align: center; color: #94a3b8; font-size: 10px;">
											<div>
												<span style="font-size: 20px; display: block; margin-bottom: 4px;">&#128247;</span>
												Foto After belum diunggah
											</div>
										</div>
									`}
								</td>
							</tr>
						</tbody>
					</table>

					<!-- Info Tambahan Subtask: Foto During, Catatan, Defect -->
					<div style="font-size: 9px; color: #475569; margin-top: 4px; display: flex; flex-direction: column; gap: 3px;">
						${pair.during_url ? `
							<div style="display: flex; align-items: center; gap: 6px; background: #f8fafc; padding: 4px 6px; border-radius: 3px; border: 1px solid #e2e8f0;">
								<span style="font-weight: bold; color: #0284c7;">&#128247; Foto Proses (During):</span>
								<a href="${pair.during_url}" style="color: #0284c7; text-decoration: underline;" target="_blank">Lihat Dokumentasi Proses Aplikasi</a>
							</div>
						` : ''}
						${pair.notes ? `<div><strong>Catatan Subtask:</strong> ${esc(pair.notes)}</div>` : ''}
						${pair.kategori_defect ? `
							<div style="background: #fff7ed; border-left: 3px solid #f97316; padding: 3px 6px; color: #9a3412;">
								<strong>Temuan Defect:</strong> ${esc(pair.kategori_defect)}
								${pair.tindakan_perbaikan ? ` &mdash; <em>Tindakan Korektif: ${esc(pair.tindakan_perbaikan)}</em>` : ''}
							</div>
						` : ''}
					</div>
				</div>
			`).join('')}
		</div>
		`;
	})()}
</body>
</html>`;
}
