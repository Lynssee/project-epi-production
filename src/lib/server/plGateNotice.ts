// Info gate untuk banner leader (read-only). Konfigurasi MENTAH: override PL di gate_enforcement menang atas
// default di gate_definitions, enforce_from dibiarkan apa adanya supaya UI bisa menghitung mundur.
// Cache 5 menit per proses. Gagal baca = gate dianggap tidak terdaftar (banner tidak tampil), dilog.
import { directusServerJson } from './directus';
import type { GateInfo } from '../shared/plGatePhase';

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { at: number; value: GateInfo }>();

export async function readGateInfo(gateKey: string): Promise<GateInfo> {
	const hit = cache.get(gateKey);
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
	let value: GateInfo = { terdaftar: false };
	try {
		const [defRes, ovRes]: any[] = await Promise.all([
			directusServerJson(`/items/gate_definitions?filter[gate_key][_eq]=${gateKey}&fields=default_mode,enforce_from,is_active&limit=1`),
			directusServerJson(
				`/items/gate_enforcement?filter[gate_key][_eq]=${gateKey}&filter[jenis_pengajuan][_in]=PL,*&filter[is_active][_eq]=true&fields=jenis_pengajuan,mode,enforce_from&limit=5`
			).catch(() => ({ data: [] }))
		]);
		const d = defRes?.data?.[0];
		if (d) {
			const ovs: any[] = ovRes?.data || [];
			const ov = ovs.find((o) => o.jenis_pengajuan === 'PL') || ovs.find((o) => o.jenis_pengajuan === '*');
			const src = ov || d;
			value = {
				terdaftar: true,
				aktif: d.is_active !== false,
				mode: ov ? ov.mode : d.default_mode,
				enforceFrom: src.enforce_from ? String(src.enforce_from).slice(0, 10) : ov && d.enforce_from ? String(d.enforce_from).slice(0, 10) : null
			};
		}
	} catch (e: any) {
		console.warn('[plGateNotice] gagal baca gate', gateKey, e?.message || e);
	}
	cache.set(gateKey, { at: Date.now(), value });
	return value;
}
