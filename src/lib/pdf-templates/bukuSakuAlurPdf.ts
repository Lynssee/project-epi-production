// src/lib/pdf-templates/bukuSakuAlurPdf.ts
// Buku Saku & Checklist Lapangan satu alur SOP → HTML untuk Gotenberg (PDF server-side, nol beban bundle klien).
// Persona Operasional/Lapangan (Penyatuan Engine Cetak, Fase 4): hanya yang dipakai di lapangan — langkah, PIC, SLA, checklist (kotak centang),
// hambatan, cabang, gate (+ mode & hint bila terbaca), pintasan layar LAPANGAN. Tanpa ERD/UML/n8n/jabatan internal.
// ATURAN DATA: hanya yang tercatat pada alur. Kosong → "—"/catatan, TIDAK diisi teks karangan; status dokumen dinyatakan apa adanya.
import type { ProcessFlow, ProcessNode } from '$lib/data/processGuidance';
import type { FieldGateInfoResult } from '../../routes/api/process-guidance/flows/gateInfo';

const COMPANY_NAME = 'PT Eltama Prima Indo';
const CONTROLLED = new Set(['approved', 'published']);

export function escHtml(v: unknown): string {
	return String(v ?? '')
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;');
}

export interface BukuSakuRow {
	no: number;
	id: string;
	label: string;
	type: string;
	lane: string;
	pic: string;
	slaHours: number | null;
	desc: string;
	checklist: string[];
	blockers: string[];
	branches: { label: string; to: string }[];
	gates: string[];
	fieldActions: { label: string; href: string }[];
}

const arr = <T>(v: T[] | undefined | null): T[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Urutan baca: kolom lalu baris (bila ada), stabil terhadap urutan asli. */
export function orderedSteps(flow: Pick<ProcessFlow, 'nodes'>): ProcessNode[] {
	return arr(flow?.nodes)
		.map((n, i) => ({ n, i }))
		.filter(({ n }) => n && (n.type === 'task' || n.type === 'decision'))
		.sort((a, b) => (a.n.col ?? 0) - (b.n.col ?? 0) || (a.n.row ?? 0) - (b.n.row ?? 0) || a.i - b.i)
		.map(({ n }) => n);
}

export function buildBukuSakuRows(flow: ProcessFlow): BukuSakuRow[] {
	const label = new Map(arr(flow?.nodes).map((n) => [n.id, str(n.label) || n.id]));
	const lane = new Map(arr(flow?.lanes).map((l) => [l.key, str(l.label) || l.key]));
	return orderedSteps(flow).map((n, i) => ({
		no: i + 1,
		id: n.id,
		label: str(n.label) || n.id,
		type: n.type,
		lane: lane.get(n.lane) || str(n.lane),
		pic: str(n.pic),
		slaHours: Number(n.sla_hours) > 0 ? Number(n.sla_hours) : null,
		desc: str(n.desc),
		checklist: arr(n.checklist).map(str).filter(Boolean),
		blockers: arr(n.blockers).map(str).filter(Boolean),
		branches: arr(flow.edges)
			.filter((e) => e.from === n.id)
			.map((e) => ({ label: str((e as any).label), to: label.get(e.to) || str(e.to) })),
		gates: arr(n.gates).map((g: any) => str(typeof g === 'object' && g ? g.key : g)).filter(Boolean),
		// Di aplikasi lapangan `actions` SUDAH berisi pintasan versi lapangan (actions_field dipetakan saat alur dimuat server).
		fieldActions: arr(n.actions)
			.filter((a) => a && a.href)
			.map((a) => ({ label: str(a.label), href: str(a.href) }))
	}));
}

export function isControlled(flow: Pick<ProcessFlow, 'approval_status'>): boolean {
	return CONTROLLED.has(str(flow?.approval_status).toLowerCase());
}

export interface BukuSakuInput {
	flow: ProcessFlow;
	dicetakOleh?: string;
	gateInfo?: FieldGateInfoResult | null;
	now?: Date;
}

const MODE_LABEL: Record<string, string> = { hard: 'WAJIB (blokir)', soft: 'WAJIB (bisa pengecualian)', warn: 'PERINGATAN', shadow: 'PANTAU' };

export function buildBukuSakuHtml(input: BukuSakuInput): string {
	const { flow, dicetakOleh = '', gateInfo = null } = input;
	const now = (input.now ?? new Date()).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' });
	const rows = buildBukuSakuRows(flow);
	const controlled = isControlled(flow);
	const docNo = str(flow.sop?.doc_number) || str(flow.sop_code);
	const gi = gateInfo && gateInfo.available ? gateInfo.gates : null;
	const slaCount = rows.filter((r) => r.slaHours !== null).length;

	const gateCell = (keys: string[]) =>
		keys.length
			? keys
					.map((k) => {
						const m = gi?.[k];
						return `<div class="gate">🔒 ${escHtml(k)}${m ? ` <b>[${escHtml(MODE_LABEL[m.mode] || m.mode)}]</b>` : ''}</div>`;
					})
					.join('')
			: '<span class="mute">—</span>';

	const stepRows = rows
		.map(
			(r) => `<tr>
	<td class="c">${r.no}</td>
	<td><b>${escHtml(r.label)}</b>${r.type === 'decision' ? ' <i>(keputusan)</i>' : ''}${r.desc ? `<div class="desc">${escHtml(r.desc)}</div>` : ''}
		${r.branches.length ? `<div class="desc"><b>Cabang:</b> ${r.branches.map((b) => `${b.label ? `[${escHtml(b.label)}] ` : ''}→ ${escHtml(b.to)}`).join(' · ')}</div>` : ''}</td>
	<td>${r.lane ? `<div class="lane">${escHtml(r.lane)}</div>` : ''}${escHtml(r.pic) || '<span class="mute">PIC belum diisi</span>'}</td>
	<td class="c">${r.slaHours ?? '—'}</td>
	<td>${r.checklist.length ? r.checklist.map((c) => `<div class="chk">☐ ${escHtml(c)}</div>`).join('') : '<span class="mute">Checklist belum diisi</span>'}
		${r.blockers.length ? `<div class="blk"><b>Hambatan:</b>${r.blockers.map((b) => `<div>• ${escHtml(b)}</div>`).join('')}</div>` : ''}</td>
	<td>${gateCell(r.gates)}${r.fieldActions.map((a) => `<div class="act">📱 ${escHtml(a.label || a.href)}</div>`).join('')}</td>
</tr>`
		)
		.join('');

	const gateDetailKeys = rows.flatMap((r) => r.gates).filter((k, i, a) => a.indexOf(k) === i);
	const gateSection =
		gi && gateDetailKeys.some((k) => gi[k])
			? `<h2>Syarat Lolos Gate</h2><table><thead><tr><th>Gate</th><th>Mode</th><th>Pesan</th><th>Solusi / hint</th></tr></thead><tbody>${gateDetailKeys
					.filter((k) => gi[k])
					.map((k) => {
						const m = gi[k];
						return `<tr><td><b>${escHtml(k)}</b><div class="desc">${escHtml(m.nama)}</div></td><td>${escHtml(MODE_LABEL[m.mode] || m.mode)}</td><td>${escHtml(m.message) || '—'}</td><td>${escHtml(m.hint) || '—'}</td></tr>`;
					})
					.join('')}</tbody></table>${gateInfo?.partial ? '<p class="note">Sebagian gate tidak terbaca saat dicetak.</p>' : ''}`
			: gateDetailKeys.length
				? `<p class="note">Detail gate (mode &amp; solusi) tidak terbaca saat dicetak${gateInfo?.reason ? `: ${escHtml(gateInfo.reason)}` : ''}; kunci gate tetap tercantum pada tabel langkah.</p>`
				: '';

	return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8" />
<style>
	* { box-sizing: border-box; }
	body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 22px; font-size: 10.5px; }
	.kop { text-align: center; border-bottom: 2px solid #1e3a8a; padding-bottom: 6px; }
	.kop .company { font-size: 14px; font-weight: 800; }
	.kop .title { font-size: 12px; font-weight: 700; color: #1e3a8a; margin-top: 4px; }
	.meta { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 8px 0; font-size: 10px; }
	.meta span b { color: #475569; }
	.banner { margin: 6px 0; padding: 5px 8px; border: 1px solid #fca5a5; background: #fef2f2; color: #991b1b; font-weight: 700; font-size: 10px; }
	.ok { border-color: #86efac; background: #f0fdf4; color: #166534; }
	h2 { font-size: 11.5px; margin: 14px 0 4px; color: #1e3a8a; text-transform: uppercase; letter-spacing: .3px; }
	table { width: 100%; border-collapse: collapse; margin-top: 4px; }
	th, td { border: 1px solid #94a3b8; padding: 4px 5px; text-align: left; vertical-align: top; }
	th { background: #f1f5f9; font-size: 9px; text-transform: uppercase; }
	tr { break-inside: avoid; }
	.c { text-align: center; }
	.desc { color: #475569; font-size: 9.5px; margin-top: 2px; }
	.lane { font-size: 8.5px; font-weight: 700; text-transform: uppercase; color: #1e3a8a; }
	.chk { margin: 1px 0; }
	.blk { margin-top: 4px; color: #9f1239; }
	.gate { font-family: monospace; font-size: 9px; }
	.act { font-size: 9px; color: #065f46; margin-top: 2px; }
	.mute { color: #94a3b8; font-style: italic; }
	.note { font-size: 9px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; padding: 3px 6px; margin-top: 4px; }
	.foot { margin-top: 14px; font-size: 8px; color: #64748b; display: flex; justify-content: space-between; gap: 8px; }
	.wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center; font-size: 80px; font-weight: 900; color: rgba(220,38,38,.10); transform: rotate(-24deg); pointer-events: none; }
</style>
</head>
<body>
${controlled ? '' : '<div class="wm">DRAFT</div>'}
<div class="kop">
	<div class="company">${escHtml(COMPANY_NAME)}</div>
	<div class="title">BUKU SAKU &amp; CHECKLIST LAPANGAN</div>
</div>
<h1 style="font-size:14px;margin:8px 0 2px">${escHtml(flow.title)}</h1>
<div class="meta">
	<span><b>Nomor:</b> ${escHtml(docNo) || 'tidak tercatat'}</span>
	<span><b>Kategori:</b> ${escHtml(flow.kategori_sop) || 'tidak tercatat'}</span>
	<span><b>Status:</b> ${escHtml(flow.approval_status) || 'tidak tercatat'}</span>
	<span><b>Langkah:</b> ${rows.length}</span>
	<span><b>SLA tercatat:</b> ${slaCount}/${rows.length}</span>
</div>
<div class="banner ${controlled ? 'ok' : ''}">${controlled ? 'Salinan lapangan dari versi TERBIT saat dicetak. Versi terbaru selalu ada di aplikasi.' : 'BELUM TERKENDALI — alur ini belum berstatus disetujui/terbit; gunakan sebagai panduan sementara, bukan dokumen resmi.'}</div>
${flow.sop?.purpose ? `<h2>Tujuan</h2><p>${escHtml(flow.sop.purpose)}</p>` : ''}
${flow.sop?.scope ? `<h2>Ruang Lingkup</h2><p>${escHtml(flow.sop.scope)}</p>` : ''}
<h2>Langkah Kerja &amp; Checklist</h2>
${
	rows.length
		? `<table><thead><tr><th style="width:4%">No</th><th style="width:27%">Langkah</th><th style="width:15%">Jalur / PIC</th><th style="width:6%">SLA (jam)</th><th style="width:30%">Checklist &amp; hambatan</th><th style="width:18%">Gate &amp; layar</th></tr></thead><tbody>${stepRows}</tbody></table>`
		: '<p class="note">Alur ini belum memiliki langkah kerja (task/decision).</p>'
}
${gateSection}
<div class="foot"><span>Dicetak ${escHtml(now)}${dicetakOleh ? ` oleh ${escHtml(dicetakOleh)}` : ''}</span><span>${escHtml(COMPANY_NAME)} · ${controlled ? 'Salinan lapangan' : 'DRAFT — bukan dokumen terkendali'}</span></div>
</body>
</html>`;
}
