// src/lib/services/toolboxMeeting.ts
// Toolbox Meeting / Briefing Pagi per proyek per hari — Fase 2 rencana JSA &
// Administrasi HSE v2.0. Menggantikan localStorage BriefingPagi (T1, sisi admin)
// dan mengisi kekosongan modul briefing di lapangan (0 file sebelumnya).
//
// Peserta di-pre-fill dari manpower laporan harian hari itu (T3/P1) — TIDAK
// diketik ulang. TTD memakai pola signature sederhana per-record (mirip
// manpowerAssignment.signAssignment), BUKAN signature_envelope/doc_signature —
// infrastruktur itu dibangun untuk karyawan (HR), bukan manpower lapangan
// (keputusan user, 23 Jul 2026).

import directus, { handleDirectusError } from './directus';
import { readItems, createItem, updateItem, uploadFiles } from '@directus/sdk';
import { getReportByProjectAndDate } from './reports';
import { getPreviousWorkday } from '$lib/utils/workingDays';
import { getIdToken } from './secureDirectus';
import { ADMIN_APP_ORIGIN } from './h1ReportGate';

export interface ToolboxParticipant {
	id: number;
	nama: string;
	role: string;
}

export interface ToolboxSignature {
	manpower_id: number;
	nama: string;
	file: string;
	signed_at: string;
}

export type ToolboxKondisi = 'aman' | 'kendala' | 'kritis';

export interface ToolboxActionItem {
	action: string;
	pic: string;
	deadline: string;
}

export interface ToolboxGateRow {
	gate_key: string;
	label: string;
	mode: string;
	status: string;
	message: string;
	blocking: boolean;
}

export interface ToolboxGateResult {
	gates: ToolboxGateRow[];
	blocking: string[];
	warnings: string[];
}

export interface ToolboxMeeting {
	id: number;
	project_id: number;
	tanggal: string;
	topik: string | null;
	catatan: string | null;
	peserta_manpower_ids: number[];
	signatures: ToolboxSignature[];
	status: string;
	kondisi?: ToolboxKondisi | null;
	dibuat_oleh: string | null;
	date_created: string;
}

function todayStr(): string {
	return new Date().toISOString().split('T')[0];
}

/** Peserta hari ini, diambil dari manpower laporan harian — tidak diketik ulang (P1). */
export async function getTodayParticipants(projectId: number | string): Promise<ToolboxParticipant[]> {
	try {
		let report: any = await getReportByProjectAndDate(projectId, todayStr());
		// Di pagi hari saat briefing diadakan (07:30-08:30 WIB), laporan hari ini biasanya belum disubmit.
		// Fallback otomatis ke laporan hari kerja sebelumnya (kemarin) agar daftar manpower langsung terisi.
		if (!report) {
			const prevDay = getPreviousWorkday(todayStr());
			report = await getReportByProjectAndDate(projectId, prevDay);
		}
		if (!report) return [];
		let mp = report.manpower;
		if (typeof mp === 'string') {
			try { mp = JSON.parse(mp); } catch { return []; }
		}
		if (!Array.isArray(mp) || mp.length === 0) {
			const prevDay = getPreviousWorkday(todayStr());
			const prevReport: any = await getReportByProjectAndDate(projectId, prevDay);
			if (prevReport?.manpower) {
				try {
					mp = typeof prevReport.manpower === 'string' ? JSON.parse(prevReport.manpower) : prevReport.manpower;
				} catch { /* proceed */ }
			}
		}
		if (!Array.isArray(mp)) return [];

		const seen = new Set<number>();
		const out: ToolboxParticipant[] = [];
		for (const group of mp) {
			if (!Array.isArray(group?.workers)) continue;
			for (const w of group.workers) {
				const id = Number(w?.id);
				const nama = w?.nama || w?.name;
				if (!id || !nama || seen.has(id)) continue;
				seen.add(id);
				out.push({ id, nama, role: group.role || '-' });
			}
		}
		return out;
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function listToolboxMeetings(projectId: number | string, limit = 10): Promise<ToolboxMeeting[]> {
	try {
		const rows = await directus.request(
			readItems('toolbox_meeting', {
				filter: { project_id: { _eq: projectId as any } },
				sort: ['-tanggal', '-id'],
				limit
			})
		);
		return (rows as any[]).map(normalizeRow);
	} catch (error) {
		handleDirectusError(error);
		return [];
	}
}

export async function getTodayToolboxMeeting(projectId: number | string): Promise<ToolboxMeeting | null> {
	try {
		const rows = await directus.request(
			readItems('toolbox_meeting', {
				filter: { project_id: { _eq: projectId as any }, tanggal: { _eq: todayStr() } },
				limit: 1
			})
		);
		const row = (rows as any[])[0];
		return row ? normalizeRow(row) : null;
	} catch (error) {
		handleDirectusError(error);
		return null;
	}
}

function normalizeRow(row: any): ToolboxMeeting {
	let peserta = row.peserta_manpower_ids;
	if (typeof peserta === 'string') { try { peserta = JSON.parse(peserta); } catch { peserta = []; } }
	let signatures = row.signatures;
	if (typeof signatures === 'string') { try { signatures = JSON.parse(signatures); } catch { signatures = []; } }
	return { ...row, peserta_manpower_ids: peserta || [], signatures: signatures || [] };
}

function dataUrlToFile(dataUrl: string, filename: string): File {
	const arr = dataUrl.split(',');
	const mimeMatch = arr[0].match(/:(.*?);/);
	const mime = mimeMatch ? mimeMatch[1] : 'image/png';
	const bstr = atob(arr[1]);
	let n = bstr.length;
	const u8arr = new Uint8Array(n);
	while (n--) u8arr[n] = bstr.charCodeAt(n);
	return new File([u8arr], filename, { type: mime });
}

/** Unggah satu tanda tangan (data URL PNG) ke Directus files, kembalikan file id. */
export async function uploadToolboxSignature(dataUrl: string, manpowerId: number): Promise<string> {
	const file = dataUrlToFile(dataUrl, `ttd-toolbox-${manpowerId}-${Date.now()}.png`);
	const formData = new FormData();
	formData.append('title', `TTD Toolbox Meeting — manpower #${manpowerId}`);
	formData.append('file', file);
	const uploaded: any = await directus.request(uploadFiles(formData as any));
	return uploaded.id;
}

export async function createToolboxMeeting(payload: {
	project_id: number | string;
	topik: string;
	catatan?: string;
	peserta_manpower_ids: number[];
	signatures: ToolboxSignature[];
	dibuat_oleh?: string;
	evaluasi_tanggal?: string;
	kondisi?: ToolboxKondisi | null;
	action_items?: ToolboxActionItem[];
}): Promise<{ success: boolean; data?: ToolboxMeeting; error?: string }> {
	try {
		let finalCatatan = (payload.catatan || '').trim();
		if (payload.evaluasi_tanggal && !finalCatatan.includes('[EVALUASI LAPORAN:')) {
			finalCatatan = `[EVALUASI LAPORAN: ${payload.evaluasi_tanggal}]\n\n` + finalCatatan;
			finalCatatan = finalCatatan.trim();
		}
		const created: any = await directus.request(
			createItem('toolbox_meeting', {
				project_id: payload.project_id,
				tanggal: todayStr(),
				topik: payload.topik,
				catatan: finalCatatan || null,
				peserta_manpower_ids: payload.peserta_manpower_ids,
				signatures: payload.signatures,
				status: 'submitted',
				stage_step: 2,
				submitted_at: new Date().toISOString(),
				departemen: 'project',
				kondisi: payload.kondisi || null,
				action_items: (payload.action_items || []).map((a, i) => ({ id: 'n' + (i + 1), ...a, status: 'pending', dept_target: null })),
				dibuat_oleh: payload.dibuat_oleh || null
			})
		);
		return { success: true, data: normalizeRow(created) };
	} catch (error: any) {
		handleDirectusError(error);
		return { success: false, error: error?.message || 'Gagal menyimpan toolbox meeting' };
	}
}

/**
 * Submit Toolbox lewat server admin (Lifecycle Briefing): gate G_BRF_* dinilai SEBELUM menulis, hasil gate dikembalikan
 * apa adanya. Mode gate diatur Superadmin (default shadow = tidak memblokir). Server tidak terjangkau / 5xx / 404
 * (endpoint belum rilis) => jalur cadangan langsung ke Directus supaya lapangan tidak terhenti (fail-open).
 */
export async function submitToolboxLifecycle(payload: {
  project_id: number | string;
  topik: string;
  catatan?: string;
  kondisi: ToolboxKondisi | null;
  action_items: ToolboxActionItem[];
  peserta_manpower_ids: number[];
  signatures: ToolboxSignature[];
  dibuat_oleh?: string;
  evaluasi_tanggal?: string;
  exceptionReason?: string;
}): Promise<{ success: boolean; data?: ToolboxMeeting; error?: string; gate?: ToolboxGateResult | null; broadcast?: boolean; viaFallback?: boolean }> {
  try {
    let finalCatatan = (payload.catatan || '').trim();
    if (payload.evaluasi_tanggal && !finalCatatan.includes('[EVALUASI LAPORAN:')) {
      finalCatatan = `[EVALUASI LAPORAN: ${payload.evaluasi_tanggal}]\n\n` + finalCatatan;
      finalCatatan = finalCatatan.trim();
    }
    const token = await getIdToken();
    const res = await fetch(`${ADMIN_APP_ORIGIN}/api/briefing/lifecycle/action`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        action: 'submit_new',
        exceptionReason: payload.exceptionReason || undefined,
        data: {
          departemen: 'project',
          project_id: payload.project_id,
          tanggal: todayStr(),
          topik: payload.topik,
          catatan: finalCatatan,
          kondisi: payload.kondisi,
          action_items: payload.action_items,
          peserta_manpower_ids: payload.peserta_manpower_ids,
          signatures: payload.signatures
        }
      })
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok && j?.ok) return { success: true, data: normalizeRow(j.row), gate: j.gate || null, broadcast: !!j.broadcast };
    if (res.status >= 500 || res.status === 404) throw new Error('server ' + res.status);
    return { success: false, error: j?.error || j?.message || `Gagal (${res.status})`, gate: j?.gate || null };
  } catch (e) {
    console.warn('[toolboxMeeting] server briefing tidak terjangkau, simpan langsung ke Directus:', e);
    const r = await createToolboxMeeting(payload);
    return { ...r, gate: null, viaFallback: true };
  }
}
