// src/routes/api/process-guidance/ai-navigator/+server.ts
// Endpoint AI Process Navigator untuk Aplikasi Lapangan (project-epi).
// Menerima pertanyaan alur / kendala gate lapangan, mencocokkan SOP resmi,
// dan memberikan instruksi ringkas serta aksi formulir HP.

import { json, error, type RequestHandler } from '@sveltejs/kit';
import { authenticateEss } from '$lib/server/ess/attendanceGuard';
import { loadPublishedFlowsForField } from '$lib/server/processGuidanceFlows';
import { pruneCandidates, queryAiFieldNavigator, buildDeterministicFieldGuidance } from './processAiNavigatorFieldService';

export const GET: RequestHandler = async (event) => {
	const user = await authenticateEss(event);
	if (!user) throw error(401, 'Sesi login lapangan tidak sah.');

	const q = event.url.searchParams.get('q');
	if (!q) {
		return json({
			success: true,
			status: 'ready',
			message: 'AI Process Navigator Lapangan siap.'
		});
	}

	const flows = await loadPublishedFlowsForField();
	const candidates = pruneCandidates(flows, q, 3);
	if (!candidates.length) {
		return json({
			success: true,
			found: false,
			message: `Tidak ditemukan panduan alur yang cocok dengan "${q}".`
		});
	}

	const guidance = buildDeterministicFieldGuidance(candidates[0], q);
	return json({ success: true, ...guidance });
};

export const POST: RequestHandler = async (event) => {
	const user = await authenticateEss(event);
	if (!user) throw error(401, 'Sesi login lapangan tidak sah.');

	let body: any;
	try {
		body = await event.request.json();
	} catch {
		throw error(400, 'Payload harus JSON.');
	}

	const query = String(body?.query || '').trim();
	if (query.length < 2) {
		throw error(400, 'Pertanyaan minimal 2 karakter.');
	}

	try {
		const flows = await loadPublishedFlowsForField();
		const candidateFlows = pruneCandidates(flows, query, 3);

		if (!candidateFlows.length) {
			return json({
				success: true,
				found: false,
				message: `Tidak ada alur atau kendala gate yang cocok untuk "${query}". Coba kata kunci umum seperti kasbon, alat rusak, BBM, material sisa, atau P2H.`
			});
		}

		if (body?.mode === 'fast') {
			const fastResult = buildDeterministicFieldGuidance(candidateFlows[0], query);
			return json({ success: true, ...fastResult });
		}

		const result = await queryAiFieldNavigator({
			query,
			candidateFlows,
			user
		});

		return json({
			success: true,
			...result
		});
	} catch (err: any) {
		console.warn('[ai-navigator field] gagal:', err?.message || err);
		return json(
			{
				success: false,
				error: 'Gagal memproses panduan AI. Silakan gunakan daftar panduan manual.'
			},
			{ status: 500 }
		);
	}
};
