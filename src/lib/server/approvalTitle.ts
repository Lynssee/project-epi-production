// src/lib/server/approvalTitle.ts
// PRJ-27 — judul approval & notifikasi yang informatif (nama proyek, jumlah item, nilai, pengaju), bukan "Project #1040".
// Format PL: `PL — <Proyek> · <n> item · Rp<total> · oleh <Leader>`, dipotong rapi ≤ 120 karakter.
// Satu query kecil (`projects?fields=name,nomor_po,leader`); gagal baca → jatuh ke label "Project #id" (tidak pernah melempar).
import { directusServerJson } from './directus';

export const MAX_TITLE_LEN = 120;

export function truncateTitle(s: string, max = MAX_TITLE_LEN): string {
	const t = s.replace(/\s+/g, ' ').trim();
	return t.length <= max ? t : t.slice(0, max - 1).trimEnd() + '…';
}

const rp = (n: number) => 'Rp' + Math.round(n || 0).toLocaleString('id-ID');

export interface PlTitleInput {
	projectLabel: string;
	itemCount?: number;
	total?: number;
	leader?: string | null;
	suffix?: string | null; // mis. "di luar RAP"
}

export function formatPlTitle({ projectLabel, itemCount, total, leader, suffix }: PlTitleInput): string {
	const parts = [`PL — ${projectLabel}`];
	if (itemCount) parts.push(`${itemCount} item${suffix ? ' ' + suffix : ''}`);
	if (total && total > 0) parts.push(rp(total));
	if (leader) parts.push(`oleh ${leader}`);
	return truncateTitle(parts.join(' · '));
}

/** Nama proyek + leader untuk judul. Gagal → { label: 'Project #id' }. */
export async function resolveProjectTitleParts(projectId: number | string | null | undefined): Promise<{ label: string; leader: string | null }> {
	if (!projectId) return { label: 'Project -', leader: null };
	try {
		const res: any = await directusServerJson(`/items/projects/${projectId}?fields=name,nomor_po,leader`);
		const p = res?.data;
		if (!p) return { label: `Project #${projectId}`, leader: null };
		const name = String(p.name || '').trim();
		return { label: name || `Project #${projectId}`, leader: p.leader ? String(p.leader).trim() : null };
	} catch (e: any) {
		console.warn('[approvalTitle] gagal membaca proyek untuk judul (pakai id):', e?.message);
		return { label: `Project #${projectId}`, leader: null };
	}
}
