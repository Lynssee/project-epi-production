// src/routes/api/laporan/[id]/export-pdf/+server.ts
// GET: dipanggil tombol "Unduh PDF" di halaman Laporan Harian setelah laporan
// terkirim (lihat +page.svelte, state isLocked) — auth Firebase biasa
// (requireUser), render server-side via Gotenberg, binary PDF dikembalikan
// langsung (tidak diunggah ke Directus — leader unduh untuk arsip pribadinya).

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson, directusServerFetch } from '$lib/server/directus';
import { htmlToPdf } from '$lib/server/gotenbergClient';
import { buildLaporanHarianLapanganHtml } from '$lib/pdf-templates/laporanHarianLapangan';

export async function GET(event: RequestEvent) {
	await requireUser(event);

	const id = event.params.id;
	if (!id || Number.isNaN(Number(id))) {
		throw error(400, 'ID laporan tidak valid');
	}

	const res = await directusServerJson<{ data: any }>(
		`/items/reports/${id}?fields=*`
	).catch((e: any) => {
		console.error('[laporan/export-pdf] gagal ambil data laporan:', e?.message);
		throw error(500, 'Gagal mengambil data laporan.');
	});
	const report = res?.data;
	if (!report) {
		throw error(404, 'Laporan tidak ditemukan');
	}

	let projectName = 'Workshop Ciketing';
	let project: any = null;
	const projId = typeof report.project_id === 'object' ? report.project_id?.id : report.project_id;
	if (projId) {
		const projRes = await directusServerJson<{ data: any }>(
			`/items/projects/${projId}?fields=id,name,nomor_po,timeline_planning,target_progress`
		).catch(() => null);
		if (projRes?.data) {
			project = projRes.data;
			projectName = project.name || projectName;
		}
	}

	const reportDate = (report.date || '').split('T')[0];

	// Normalisasi progress items agar memiliki metrik target harian & sisa yang valid
	let progressItems = report.progress;
	if (typeof progressItems === 'string') {
		try { progressItems = JSON.parse(progressItems); } catch { progressItems = []; }
	}
	if (Array.isArray(progressItems)) {
		let planning = project?.timeline_planning;
		if (typeof planning === 'string') {
			try { planning = JSON.parse(planning); } catch { planning = null; }
		}
		const categories = planning?.categories || [];
		const subtaskMap: Record<string, any> = {};
		for (const cat of categories) {
			for (const sub of (cat.subtasks || [])) {
				if (sub.id) subtaskMap[String(sub.id)] = sub;
				if (sub.name) subtaskMap[`act_${sub.name.trim().toLowerCase()}`] = sub;
			}
		}

		const audience = event.url.searchParams.get('audience') || 'internal';
		const whiteLabel = event.url.searchParams.get('whiteLabel') !== 'false';

		progressItems = progressItems.map((pi: any) => {
			const sub = (pi.subtask_id && subtaskMap[String(pi.subtask_id)]) || (pi.activity && subtaskMap[`act_${pi.activity.trim().toLowerCase()}`]) || null;
			const target = Number(pi.target_volume) || Number(sub?.volume) || 0;
			const today = Number(pi.progress_value) || 0;
			let dailyTarget = Number(pi.daily_target) || 0;
			if (!dailyTarget && sub?.daily_plan && reportDate && sub.daily_plan[reportDate] != null) {
				dailyTarget = Number(sub.daily_plan[reportDate]) || 0;
			}
			let prev = Number(pi.prev_volume) || 0;
			if (!prev && pi.cumulative_volume != null && Number(pi.cumulative_volume) > 0) {
				prev = Math.max(0, Number(pi.cumulative_volume) - today);
			}
			const cum = (pi.cumulative_volume != null && Number(pi.cumulative_volume) > 0) ? Number(pi.cumulative_volume) : (prev + today);
			const pct = target > 0 ? Math.round((cum / target) * 100) : (Number(pi.persen) || 0);
			const sisa = target > 0 ? Math.max(0, target - cum) : (Number(pi.sisa) || 0);

			const vendorName = (audience === 'customer' && whiteLabel && pi.executor_vendor_name)
				? 'Tim Pelaksana PT EPI'
				: pi.executor_vendor_name;

			return {
				...pi,
				executor_vendor_name: vendorName,
				target_volume: target,
				daily_target: dailyTarget,
				prev_volume: prev,
				cumulative_volume: cum,
				persen: pct,
				sisa
			};
		});
	}

	const audienceMode = event.url.searchParams.get('audience') || 'internal';

	// Kumpulkan file IDs foto dari report untuk disertakan dalam PDF
	const photoFileIds: Array<{ id: string; label: string; category: string }> = [];
	const seenFids = new Set<string>();
	const extractFids = (arr: any, cat: string, defLbl: string) => {
		if (!arr) return;
		let parsed = arr;
		if (typeof parsed === 'string') {
			const trimmed = parsed.trim();
			if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
				try { parsed = JSON.parse(trimmed); } catch { parsed = [trimmed]; }
			} else if (trimmed.includes(',')) {
				parsed = trimmed.split(',').map((s: string) => s.trim());
			} else {
				parsed = [trimmed];
			}
		}
		if (!Array.isArray(parsed)) parsed = [parsed];
		for (const item of parsed) {
			if (!item) continue;
			const fid = typeof item === 'object' ? (item.id || item.directus_files_id || item.file_id) : item;
			if (fid && typeof fid === 'string' && fid.length > 5 && !seenFids.has(fid)) {
				seenFids.add(fid);
				const lbl = (typeof item === 'object' && (item.label || item.caption || item.description || item.name)) || defLbl;
				photoFileIds.push({ id: fid, label: lbl, category: cat });
			}
		}
	};

	const selectBestPhotoCandidates = (photos: Array<{ id: string; label: string; category: string }>, min = 3, max = 6) => {
		if (!photos || photos.length <= max) return photos || [];

		const progressPhotos = photos.filter((p) => p.category?.toLowerCase().includes('progress'));
		const safetyPhotos = photos.filter(
			(p) =>
				p.category?.toLowerCase().includes('safety') ||
				p.category?.toLowerCase().includes('k3') ||
				p.category?.toLowerCase().includes('toolbox')
		);
		const areaPhotos = photos.filter((p) => p.category?.toLowerCase().includes('area'));
		const otherPhotos = photos.filter(
			(p) => !progressPhotos.includes(p) && !safetyPhotos.includes(p) && !areaPhotos.includes(p)
		);

		const selected: Array<{ id: string; label: string; category: string }> = [];
		const pickedIds = new Set<string>();
		const pick = (p: { id: string; label: string; category: string }) => {
			if (p && !pickedIds.has(p.id) && selected.length < max) {
				pickedIds.add(p.id);
				selected.push(p);
			}
		};

		// 1. Prioritaskan 1 foto Safety / TBM
		if (safetyPhotos.length > 0) pick(safetyPhotos[0]);
		// 2. Prioritaskan 1 foto Area Kerja
		if (areaPhotos.length > 0) pick(areaPhotos[0]);
		// 3. Prioritaskan 2-3 foto Progres Fisik utama
		for (const p of progressPhotos) {
			if (selected.length < max - 1) pick(p);
		}
		// 4. Jika masih ada sisa slot hingga max (6), ambil sisa foto yang tersedia
		for (const p of [...progressPhotos, ...safetyPhotos, ...areaPhotos, ...otherPhotos]) {
			pick(p);
		}

		return selected;
	};

	extractFids(report.progress_photos, 'Progress Fisik', 'Dokumentasi Progres Fisik');
	extractFids(report.toolbox_photos, 'Safety / K3', 'Toolbox Meeting (TBM)');
	let hseObj: any = null;
	if (report.hse_daily) {
		try {
			hseObj = typeof report.hse_daily === 'string' ? JSON.parse(report.hse_daily) : report.hse_daily;
		} catch {}
	}
	if (hseObj?.tbm_photos) extractFids(hseObj.tbm_photos, 'Safety / K3', 'Toolbox Meeting (TBM)');
	if (hseObj?.photos) extractFids(hseObj.photos, 'Safety / K3', 'Foto K3 & APD');
	extractFids(report.area_kerja_photos, 'Area Kerja', 'Kondisi Area Site');
	extractFids(report.attendance_photos, 'Presensi Crew', 'Absensi Tim');
	extractFids(report.issue_photos, 'Kendala & Isu', 'Foto Temuan Kendala');
	extractFids(report.photos || report.foto || report.foto_dokumentasi, 'Dokumentasi Umum', 'Dokumentasi Lapangan');

	// Ambil juga dari progress_items.foto_bukti
	if (Array.isArray(progressItems)) {
		for (const pi of progressItems) {
			extractFids(pi?.foto_bukti, 'Progress Subtask', pi.activity || 'Bukti Subtask');
		}
	}

	// Seleksi 3-6 foto terbaik pilihan bila mode customer, atau maks 12 foto untuk mode internal
	const candidatePhotos = audienceMode === 'customer'
		? selectBestPhotoCandidates(photoFileIds, 3, 6)
		: photoFileIds.slice(0, 12);

	// Ambil buffer foto via directusServerFetch dan ubah ke base64
	const photosList: Array<{ url: string; label: string; category: string }> = [];
	for (const pf of candidatePhotos) {
		try {
			const imgRes = await directusServerFetch(`/assets/${pf.id}?width=600&quality=70`);
			if (imgRes.ok) {
				const buf = Buffer.from(await imgRes.arrayBuffer());
				const mime = imgRes.headers.get('content-type') || 'image/jpeg';
				photosList.push({
					url: `data:${mime};base64,${buf.toString('base64')}`,
					label: pf.label,
					category: pf.category
				});
			}
		} catch (imgErr) {
			console.warn('[export-pdf] Gagal ambil aset foto:', pf.id, imgErr);
		}
	}

	try {
		const html = buildLaporanHarianLapanganHtml({
			projectName: audienceMode === 'customer' ? `${projectName} (Laporan Resmi Klien)` : projectName,
			date: reportDate || (report.date || '').split('T')[0],
			weather: report.weather,
			activity_status: report.activity_status,
			overall_progress: report.overall_progress,
			issues_general: report.issues_general,
			general_notes: report.general_notes,
			tomorrow_plan_summary: report.tomorrow_plan_summary,
			schedule: report.schedule,
			progress: progressItems,
			material_used: report.material_used,
			manpower: report.manpower,
			tools: report.tools,
			issues: report.issues,
			tomorrow_plan: report.tomorrow_plan,
			photos: photosList,
			hse_daily: report.hse_daily,
			downtime_log: report.downtime_log,
			qc_ambient: report.qc_ambient,
			material_variance: report.material_variance,
			client_instructions: report.client_instructions
		});

		const buffer = await htmlToPdf(html, { filename: `laporan-harian-${id}.pdf` });
		const dateLabel = reportDate || (report.date || '').split('T')[0] || id;

		return new Response(Uint8Array.from(buffer), {
			headers: {
				'Content-Type': 'application/pdf',
				'Content-Disposition': `attachment; filename="laporan-harian-${audienceMode === 'customer' ? 'resmi-' : ''}${dateLabel}.pdf"`
			}
		});
	} catch (e: any) {
		console.error('[laporan/export-pdf] gagal render PDF:', e?.message);
		throw error(500, e?.message || 'Gagal membuat PDF laporan.');
	}
}
