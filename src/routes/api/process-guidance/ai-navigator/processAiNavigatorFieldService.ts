// src/routes/api/process-guidance/ai-navigator/processAiNavigatorFieldService.ts
// Service AI Navigator khusus Dashboard Lapangan (project-epi).
// Murni, hemat kuota HP, dengan in-memory cache dan fallback deterministik.

import { env } from '$env/dynamic/private';
import { OPENROUTER_URL, PLACEHOLDER_KEY } from '$lib/server/aiAssistantShared';
import { logAiUsage } from '$lib/server/aiUsageLog';
import type { ProcessFlow } from '$lib/data/processGuidance';

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam
const queryCache = new Map<string, { at: number; result: any }>();

export function tokenizeQuery(text: string): string[] {
	return String(text || '')
		.toLowerCase()
		.replace(/[^\w\s-]/g, ' ')
		.split(/\s+/)
		.filter((t) => t.length >= 2);
}

export function scoreFlow(flow: ProcessFlow, tokens: string[], rawQuery: string): number {
	if (!flow || !tokens.length) return 0;
	let score = 0;
	const normTitle = String(flow.title || '').toLowerCase();
	const normKey = String(flow.id || flow.flow_key || '').toLowerCase();
	const normSop = String(flow.sop_code || '').toLowerCase();

	if (normTitle.includes(rawQuery)) score += 60;
	if (normKey.includes(rawQuery)) score += 50;
	if (normSop.includes(rawQuery)) score += 70;

	for (const token of tokens) {
		if (normTitle.includes(token)) score += 20;
		if (normKey.includes(token)) score += 15;
		if (normSop.includes(token)) score += 25;
	}

	for (const node of flow.nodes || []) {
		const nodeLabel = String(node.label || '').toLowerCase();
		const nodeDesc = String(node.desc || '').toLowerCase();
		const pic = String(node.pic || '').toLowerCase();

		for (const token of tokens) {
			if (nodeLabel.includes(token)) score += 10;
			if (nodeDesc.includes(token)) score += 5;
			if (pic.includes(token)) score += 5;
		}

		for (const g of node.gates || []) {
			const gKey = String(g.key || '').toLowerCase();
			for (const token of tokens) {
				if (gKey.includes(token)) score += 25;
			}
		}

		for (const b of node.blockers || []) {
			const bStr = String(b || '').toLowerCase();
			for (const token of tokens) {
				if (bStr.includes(token)) score += 8;
			}
		}
	}

	return score;
}

export function pruneCandidates(flows: ProcessFlow[], query: string, maxCandidates = 3): ProcessFlow[] {
	const rawQuery = String(query || '').toLowerCase().trim();
	const tokens = tokenizeQuery(rawQuery);
	if (!tokens.length) return [];

	const scored: { flow: ProcessFlow; score: number }[] = [];
	for (const flow of flows) {
		const score = scoreFlow(flow, tokens, rawQuery);
		if (score > 0) {
			scored.push({ flow, score });
		}
	}

	scored.sort((a, b) => b.score - a.score);
	return scored.slice(0, maxCandidates).map((s) => s.flow);
}

export function buildDeterministicFieldGuidance(flow: ProcessFlow | null, query: string) {
	if (!flow) {
		return {
			found: false,
			message: `Tidak ditemukan panduan SOP lapangan yang sesuai dengan "${query}". Coba kata kunci seperti: kasbon, alat rusak, p2h, laporan harian, material sisa.`
		};
	}

	const nodes = Array.isArray(flow.nodes) ? flow.nodes : [];
	const stages = nodes.slice(0, 6).map((n) => {
		const fieldAction = Array.isArray(n.actions_field) && n.actions_field.length ? n.actions_field[0] : null;
		const adminAction = Array.isArray(n.actions) && n.actions.length ? n.actions[0] : null;
		const gateKey = Array.isArray(n.gates) && n.gates.length ? n.gates[0].key : null;

		return {
			nodeId: n.id,
			label: n.label || n.id,
			pic: n.pic || 'Operasional Lapangan',
			summary: n.desc ? n.desc.slice(0, 150) : 'Langkah operasional lapangan.',
			actionField: fieldAction ? { label: fieldAction.label, href: fieldAction.href } : (adminAction ? { label: adminAction.label, href: adminAction.href } : null),
			gate: gateKey
		};
	});

	const gatesSummary: { key: string; modul: string; documentType: string }[] = [];
	for (const n of nodes) {
		for (const g of n.gates || []) {
			if (!gatesSummary.some((item) => item.key === g.key)) {
				gatesSummary.push({
					key: g.key,
					modul: g.modul || 'Operasional',
					documentType: g.documentType || 'Syarat'
				});
			}
		}
	}

	return {
		found: true,
		source: 'deterministic',
		matchedFlowKey: flow.id || flow.flow_key,
		matchedFlowTitle: flow.title,
		sopCode: flow.sop_code || 'SOP-LAPANGAN',
		kategoriSop: flow.kategori_sop || 'induk',
		targetApp: flow.target_app || 'project-epi',
		answer: `Alur ${flow.title}: Ikuti urutan langkah lapangan dari ${nodes[0]?.label || 'tahap awal'} sampai verifikasi selesai.`,
		stages,
		gatesSummary: gatesSummary.slice(0, 4),
		quickTips: 'Pastikan bukti foto dan checklist fisik dilengkapi sebelum menekan tombol selesai.'
	};
}

export async function queryAiFieldNavigator({ query, candidateFlows, user }: { query: string; candidateFlows: ProcessFlow[]; user: any }) {
	const rawQuery = String(query || '').trim();
	const cacheKey = rawQuery.toLowerCase();

	const hit = queryCache.get(cacheKey);
	if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
		return { ...hit.result, cached: true };
	}

	if (!candidateFlows.length) {
		return {
			found: false,
			message: `Tidak ditemukan panduan alur yang cocok untuk "${rawQuery}".`
		};
	}

	const topFlow = candidateFlows[0];
	const apiKey = env.OPENROUTER_API_KEY || process.env.OPENROUTER_API_KEY || '';

	if (!apiKey || apiKey === PLACEHOLDER_KEY) {
		return buildDeterministicFieldGuidance(topFlow, rawQuery);
	}

	const contextText = candidateFlows
		.map((f, idx) => {
			const nodesSummary = (f.nodes || [])
				.slice(0, 8)
				.map((n, nIdx) => {
					const gatesStr = (n.gates || []).map((g) => g.key).join(', ');
					const action = n.actions_field?.[0]?.href || n.actions?.[0]?.href || '';
					return `  ${nIdx + 1}. [${n.id}] ${n.label} (PIC: ${n.pic || 'Mandor/Mekanik'}) ${gatesStr ? `[Gate: ${gatesStr}]` : ''} ${action ? `[Link: ${action}]` : ''} - ${n.desc || ''}`;
				})
				.join('\n');

			return `ALUR ${idx + 1}:
ID: ${f.id}
Judul: ${f.title}
SOP: ${f.sop_code || '-'}
Langkah:
${nodesSummary}`;
		})
		.join('\n\n');

	const systemPrompt = `Kamu adalah Asisten Panduan Lapangan (SOP & Gate Assistant) PT ELTAMA PRIMA INDO untuk mekanik, mandor, dan project leader.
Tugasmu adalah menjawab pertanyaan lapangan secara ringkas, tegas, ramah lapangan, mudah dibaca di layar HP dalam 20 detik.
Format balasan WAJIB berupa JSON murni tanpa markdown fence:
{
  "matchedFlowKey": "${topFlow.id}",
  "matchedFlowTitle": "${topFlow.title}",
  "sopCode": "${topFlow.sop_code || '-'}",
  "answer": "1-2 kalimat ringkas solusi langkah lapangan langsung ke inti.",
  "stages": [
    {
      "nodeId": "id_langkah",
      "label": "Nama Langkah",
      "pic": "PIC",
      "summary": "1 kalimat aksi fisik apa yang harus dikerjakan / difoto.",
      "actionField": { "label": "Label Tombol HP", "href": "/link/form/lapangan" },
      "gate": "KODE_GATE jika ada"
    }
  ],
  "gatesSummary": [
    { "key": "KODE_GATE", "description": "1 kalimat syarat agar tidak terkunci" }
  ],
  "quickTips": "1 tips lapangan penting agar pekerjaan tidak ditolak sistem"
}`;

	const userPrompt = `Pertanyaan Lapangan: "${rawQuery}"

Konteks Alur SOP Lapangan:
${contextText}

Jawab dalam JSON sesuai skema di atas.`;

	try {
		const res = await fetch(OPENROUTER_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json',
				'HTTP-Referer': 'https://project.eltamaprimaindo.com',
				'X-Title': 'EPI Field Process Assistant'
			},
			body: JSON.stringify({
				model: 'google/gemini-2.5-flash',
				max_tokens: 800,
				messages: [
					{ role: 'system', content: systemPrompt },
					{ role: 'user', content: userPrompt }
				]
			})
		});

		if (!res.ok) {
			throw new Error(`OpenRouter HTTP ${res.status}`);
		}

		const data = await res.json();
		let rawText = data?.choices?.[0]?.message?.content || '{}';
		const fence = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
		if (fence) rawText = fence[1].trim();

		let parsed: any;
		try {
			parsed = JSON.parse(rawText);
		} catch {
			parsed = buildDeterministicFieldGuidance(topFlow, rawQuery);
		}

		const result = {
			found: true,
			source: 'ai',
			matchedFlowKey: parsed.matchedFlowKey || topFlow.id,
			matchedFlowTitle: parsed.matchedFlowTitle || topFlow.title,
			sopCode: parsed.sopCode || topFlow.sop_code || '-',
			kategoriSop: topFlow.kategori_sop || 'induk',
			targetApp: 'project-epi',
			answer: parsed.answer || topFlow.description || '',
			stages: Array.isArray(parsed.stages) ? parsed.stages : [],
			gatesSummary: Array.isArray(parsed.gatesSummary) ? parsed.gatesSummary : [],
			quickTips: parsed.quickTips || 'Pastikan bukti lapangan lengkap sebelum verifikasi.'
		};

		try {
			await logAiUsage({
				uid: user?.localId || user?.uid || 'field-user',
				feature: 'field_process_guidance_ai',
				model: 'google/gemini-2.5-flash',
				tokensIn: data?.usage?.prompt_tokens || 0,
				tokensOut: data?.usage?.completion_tokens || 0
			});
		} catch {
			// non-fatal
		}

		queryCache.set(cacheKey, { at: Date.now(), result });
		return result;
	} catch (err: any) {
		console.warn('[processAiNavigatorFieldService] AI gagal, fallback ke deterministik:', err?.message || err);
		const fallback = buildDeterministicFieldGuidance(topFlow, rawQuery);
		queryCache.set(cacheKey, { at: Date.now(), result: fallback });
		return fallback;
	}
}

export function clearFieldNavigatorCache(): void {
	queryCache.clear();
}
