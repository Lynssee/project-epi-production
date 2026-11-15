// Penjaga DRIFT: 29 serah-terima bawaan di sini adalah CERMIN `DEFAULT_HANDOFFS` erp-epi (src/lib/utils/processGrandMap.js).
// Bila checkout erp-epi ada di samping repo ini (atau ERP_EPI_PATH diset), tes ini membandingkan keduanya. Tanpa checkout → dilewati (bukan gagal).
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DEFAULT_HANDOFFS } from './processHandoffDefaults';

const erpRoot = process.env.ERP_EPI_PATH || resolve(process.cwd(), '..', 'erp-epi');
const erpFile = resolve(erpRoot, 'src/lib/utils/processGrandMap.js');
const has = existsSync(erpFile);

describe('processHandoffDefaults ≡ erp-epi DEFAULT_HANDOFFS', () => {
	it('bentuk dasar: 29 titik, kode H01..H29 unik', () => {
		expect(DEFAULT_HANDOFFS).toHaveLength(29);
		expect(new Set(DEFAULT_HANDOFFS.map((h) => h.code)).size).toBe(29);
	});

	(has ? it : it.skip)('sama persis dengan sumber di erp-epi (kode, asal, tujuan, jenis, dokumen)', async () => {
		const erp = (await import(/* @vite-ignore */ pathToFileURL(erpFile).href)) as { DEFAULT_HANDOFFS: any[] };
		const pick = (h: any) => ({ code: h.code, from_flow: h.from_flow, from_node: h.from_node, to_flow: h.to_flow, to_node: h.to_node, handoff_type: h.handoff_type, doc_label: h.doc_label });
		const a = DEFAULT_HANDOFFS.map(pick);
		const b = erp.DEFAULT_HANDOFFS.map(pick);
		expect(
			a,
			'Salinan project-epi (src/lib/data/processHandoffDefaults.ts) berbeda dari erp-epi (src/lib/utils/processGrandMap.js) — samakan salah satunya.'
		).toEqual(b);
	});
});
