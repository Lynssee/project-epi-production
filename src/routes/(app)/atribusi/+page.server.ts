// Halaman atribusi open source, read-only. Data dari registry bersama (oss_registry/
// oss_module_usage) yang dikelola di dashboard admin (erp-epi-1) — lihat
// implementation_plan_open source management_v2.md Fase 5 (B1).
import { directusServerJson } from '$lib/server/directus';
import type { PageServerLoad } from './$types';

interface OssItem {
	id: number;
	name: string;
	license: string | null;
	version_current: string | null;
	npm_url: string | null;
	github_url: string | null;
}

export const load: PageServerLoad = async () => {
	try {
		const result = await directusServerJson<{ data: OssItem[] }>(
			`/items/oss_registry?limit=-1&sort=name&fields=id,name,license,version_current,npm_url,github_url&filter[usages][project][_eq]=project-epi`
		);
		return { items: result.data || [] };
	} catch (err) {
		console.error('Failed to load attribution data:', err);
		return { items: [] };
	}
};
