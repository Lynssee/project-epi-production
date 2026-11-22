// src/lib/utils/processVisualFlowModel.ts
// Normalisasi data SOP Ringkas untuk Dashboard Lapangan (project-epi)
// Mendukung Mode 1: Infografis Vertikal (Gambar 2) dan Mode 2: Kartu Foto Instruksi (Gambar 1)
import type { ProcessFlow, ProcessNode } from '$lib/data/processGuidance';

export interface InfographicStep {
	stepNumber: number;
	id: string;
	label: string;
	type: string;
	lane: string;
	pic: string;
	icon: string;
	summary: string;
	keyPoints: string[];
	gates: string[];
	slaHours: number | null;
	actionUrl?: string;
	actionLabel?: string;
	isDecision: boolean;
	isStart: boolean;
	isEnd: boolean;
}

export interface InfographicModel {
	title: string;
	code: string;
	version: string;
	totalSteps: number;
	steps: InfographicStep[];
}

export interface VisualCard {
	cardNumber: number;
	title: string;
	photoUrl: string;
	caption: string;
	isFinishedResult: boolean;
	statusBadge: string;
	doText?: string;
	dontText?: string;
}

export interface VisualSkillGroup {
	skillNumber: number;
	id: string;
	skillTitle: string;
	pic: string;
	icon: string;
	cards: VisualCard[];
}

export interface VisualWorkInstructionModel {
	title: string;
	code: string;
	totalSkills: number;
	skills: VisualSkillGroup[];
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

export function inferNodeIcon(node: Partial<ProcessNode> | null | undefined): string {
	if (node?.icon && typeof node.icon === 'string' && node.icon.trim()) {
		return node.icon.trim();
	}

	const text = `${node?.label || ''} ${node?.desc || ''}`.toLowerCase();

	if (/jurnal|posting|gl|buku besar/.test(text)) return '📊';
	if (/investigasi|karantina|hold|rusak|reject|investigate|akar masalah/.test(text)) return '🔬';
	if (/recount|hitung ulang|ulang|kedua|verifikasi ulang/.test(text)) return '🔁';
	if (/freeze|pembekuan|kunci|tutup|segel|isolasi/.test(text)) return '🔒';
	if (/cut-off/.test(text) && !/buka/.test(text)) return '🔒';
	if (/approval|otorisasi|persetujuan|direksi|manajer|bk request/.test(text)) return '✍️';
	if (/rekonsiliasi|varians|banding|reconcile/.test(text)) return '⚖️';
	if (/hitung|count|blind|fisik|tally|opname/.test(text)) return '📦';
	if (/selisih/.test(text)) return '⚖️';
	if (/terima|receiving|surat jalan|sj|po|delivery/.test(text)) return '📋';
	if (/inspeksi|inspeksi trailer|seal|damage check/.test(text)) return '🔍';
	if (/bongkar|stage|staging|muat|pallet/.test(text)) return '🚚';
	if (/barcode|scan|rfid|qr/.test(text)) return '📱';
	if (/simpan|put away|rak|gudang|storage|fifo/.test(text)) return '🏗️';
	if (/k3|safety|apd|ppe/.test(text)) return '🦺';

	switch (node?.type) {
		case 'start':
			return '🚀';
		case 'decision':
			return '⚖️';
		case 'end':
			return '🏁';
		default:
			return '⚙️';
	}
}

export function sortProcessNodes(nodes: ProcessNode[] = []): ProcessNode[] {
	const list = arr<ProcessNode>(nodes).filter((n) => n && n.id);
	if (!list.length) return [];

	return [...list].sort((a, b) => {
		const colA = Number(a.col ?? 0);
		const colB = Number(b.col ?? 0);
		if (colA !== colB) return colA - colB;

		const rowA = Number(a.row ?? 0);
		const rowB = Number(b.row ?? 0);
		if (rowA !== rowB) return rowA - rowB;

		return 0;
	});
}

export function extractKeySummaryPoints(node: ProcessNode, maxPoints = 2): string[] {
	const checklists = arr<string>(node?.checklist).map(str).filter(Boolean);
	if (checklists.length > 0) {
		return checklists.slice(0, maxPoints).map((item) => {
			const clean = item.replace(/\.$/, '');
			return clean.length > 90 ? `${clean.slice(0, 87)}...` : clean;
		});
	}

	const desc = str(node?.desc);
	if (desc) {
		return [desc.length > 90 ? `${desc.slice(0, 87)}...` : desc];
	}

	return [];
}

export function buildInfographicSteps(flow: ProcessFlow | null | undefined): InfographicModel {
	const nodes = sortProcessNodes(flow?.nodes || []);
	const lanes = arr<{ key: string; label: string }>(flow?.lanes);
	const laneMap = new Map(lanes.map((l) => [l.key, str(l.label) || l.key]));

	const steps: InfographicStep[] = nodes.map((node, index) => {
		const icon = inferNodeIcon(node);
		const laneName = laneMap.get(node.lane) || str(node.lane) || 'Operasional Lapangan';
		const keyPoints = extractKeySummaryPoints(node, 2);
		const gates = arr<any>(node.gates).map((g) => str(typeof g === 'object' && g ? g.key : g)).filter(Boolean);

		const actionsField = arr<{ label?: string; href?: string }>(node.actions_field).filter((a) => a?.href);
		const actionsErp = arr<{ label?: string; href?: string }>(node.actions).filter((a) => a?.href);
		const primaryAction = actionsField[0] || actionsErp[0] || null;

		return {
			stepNumber: index + 1,
			id: node.id,
			label: str(node.label) || `Langkah ${index + 1}`,
			type: str(node.type) || 'task',
			lane: laneName,
			pic: str(node.pic) || 'Personil Lapangan',
			icon,
			summary: str(node.desc),
			keyPoints,
			gates,
			slaHours: Number(node.sla_hours) > 0 ? Number(node.sla_hours) : null,
			actionUrl: primaryAction?.href || '',
			actionLabel: primaryAction?.label || '',
			isDecision: node.type === 'decision',
			isStart: node.type === 'start',
			isEnd: node.type === 'end'
		};
	});

	return {
		title: str(flow?.title || 'Standar Operasional Prosedur'),
		code: str(flow?.id || 'SOP-EPI'),
		version: 'v2.0',
		totalSteps: steps.length,
		steps
	};
}

export function buildVisualWorkInstructions(flow: ProcessFlow | null | undefined): VisualWorkInstructionModel {
	const nodes = sortProcessNodes(flow?.nodes || []);

	const skills: VisualSkillGroup[] = nodes.map((node, nodeIdx) => {
		const checklists = arr<string>(node.checklist).map(str).filter(Boolean);
		let cards: VisualCard[] = [];

		if (checklists.length >= 2) {
			cards = checklists.slice(0, 4).map((ch, chIdx) => {
				const isLast = chIdx === Math.min(checklists.length, 4) - 1;
				return {
					cardNumber: chIdx + 1,
					title: isLast ? 'Hasil Selesai Terverifikasi' : `Tahapan ${chIdx + 1}`,
					photoUrl: '',
					caption: ch,
					isFinishedResult: isLast,
					statusBadge: isLast ? 'Finished result' : `Langkah ${chIdx + 1}`
				};
			});
		} else {
			cards = [
				{
					cardNumber: 1,
					title: 'Pelaksanaan Instruksi Kerja',
					photoUrl: '',
					caption: str(node.desc || node.label),
					isFinishedResult: false,
					statusBadge: 'Instruksi'
				},
				{
					cardNumber: 2,
					title: 'Hasil Akhir Terverifikasi',
					photoUrl: '',
					caption: 'Pekerjaan selesai sesuai standar operasional dan divalidasi oleh pengawas.',
					isFinishedResult: true,
					statusBadge: 'Finished result'
				}
			];
		}

		return {
			skillNumber: nodeIdx + 1,
			id: node.id,
			skillTitle: str(node.label) || `Langkah ${nodeIdx + 1}`,
			pic: str(node.pic) || 'Pelaksana',
			icon: inferNodeIcon(node),
			cards
		};
	});

	return {
		title: str(flow?.title || 'Instruksi Kerja Visual'),
		code: str(flow?.id || 'IK-EPI'),
		totalSkills: skills.length,
		skills
	};
}
