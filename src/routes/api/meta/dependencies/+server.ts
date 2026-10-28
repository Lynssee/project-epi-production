// Endpoint publik read-only untuk Open Source Management Dashboard (admin/erp-epi-1) —
// dipanggil lintas-app via PROJECT_EPI_API_URL supaya sync package.json tidak butuh
// akses filesystem lintas deployment. Hanya expose nama+versi package (info publik),
// tidak ada data internal/bisnis.
import { json } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export async function GET() {
	const pkg = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8'));
	return json({
		name: pkg.name,
		dependencies: pkg.dependencies || {}
	});
}
