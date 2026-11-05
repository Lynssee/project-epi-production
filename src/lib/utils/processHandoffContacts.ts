// src/lib/utils/processHandoffContacts.ts
// "Kontak Approver" di Tugas Saya: untuk tiap langkah milik saya, SIAPA yang menerima serah-terima berikutnya (jabatan di langkah
// sesudahnya) beserta pemegang jabatannya (nama + WhatsApp). Murni, dites. Aturan sama dengan Tugas Saya: hanya PIC yang cocok PASTI.
//
// Alur: langkah saya ──edge──► langkah berikut. Langkah tanpa PIC pasti (keputusan/gateway) dilewati sampai MAX_HOPS agar yang
// ditampilkan jabatan sungguhan, bukan kotak "Setuju?". Jabatan saya sendiri tidak ditampilkan sebagai kontak.
import type { ProcessFlow } from '$lib/data/processGuidance';
import { resolveNodePositions, type PosisiIndex } from '$lib/utils/processPicResolver';
import { toWaNumber } from '$lib/utils/waNumber';
import type { MyTask } from '$lib/utils/processMyTasks';

export const MAX_HANDOFF_ROLES = 3;
export const MAX_PEOPLE_PER_ROLE = 4;
const MAX_HOPS = 3;

export interface ContactPerson {
	id: number;
	nama: string;
	/** nomor siap wa.me (628…); '' bila tidak ada / tidak valid → UI menyembunyikan tombol WhatsApp */
	wa: string;
}
export interface RoleContacts {
	nama: string;
	people: ContactPerson[];
	/** total pemegang aktif (people dibatasi MAX_PEOPLE_PER_ROLE) */
	total: number;
}

const INACTIVE = ['tidak aktif', 'tidak_aktif', 'non aktif', 'non-aktif', 'nonaktif', 'resign', 'keluar', 'inaktif', 'inactive', 'terminated'];

/** Sama dengan erp-epi processCurriculum.isActiveKaryawan agar angkanya konsisten. */
export function isActiveKaryawan(k: { status_kerja?: unknown; status?: unknown } | null | undefined): boolean {
	const sk = String(k?.status_kerja ?? '').trim().toLowerCase();
	const st = String(k?.status ?? '').trim().toLowerCase();
	return !INACTIVE.includes(sk) && st !== 'off';
}

/** Jabatan pasti penerima serah-terima dari satu langkah (urut sesuai alur, unik, tanpa jabatan saya). */
export function handoffPosisiIds(flow: ProcessFlow, nodeId: string, index: PosisiIndex, myPosisiId: number, max = MAX_HANDOFF_ROLES): number[] {
	const byId = new Map((flow.nodes || []).map((n) => [n.id, n]));
	const out: number[] = [];
	const seen = new Set<string>([nodeId]);
	let frontier = [nodeId];
	for (let hop = 0; hop < MAX_HOPS && frontier.length && out.length < max; hop++) {
		const next: string[] = [];
		for (const from of frontier) {
			for (const e of flow.edges || []) {
				if (e.from !== from || seen.has(e.to)) continue;
				seen.add(e.to);
				const node = byId.get(e.to);
				if (!node) continue;
				const ids = node.type === 'end' ? [] : resolveNodePositions(node, index).posisiIds.filter((id) => id !== myPosisiId);
				if (ids.length) {
					for (const id of ids) if (!out.includes(id) && out.length < max) out.push(id);
				} else if (node.type !== 'end') {
					next.push(node.id); // tanpa PIC pasti → telusuri langkah sesudahnya
				}
			}
		}
		frontier = next;
	}
	return out;
}

/** Tambahkan `handoff_to` ke tiap tugas; kembalikan juga himpunan jabatan yang perlu dicari kontaknya. */
export function attachHandoff(tasks: MyTask[], flows: ProcessFlow[], index: PosisiIndex, myPosisiId: number): { tasks: MyTask[]; posisiIds: number[] } {
	const flowById = new Map((Array.isArray(flows) ? flows : []).map((f) => [f.id, f]));
	const all = new Set<number>();
	const withHandoff = tasks.map((t) => {
		const flow = flowById.get(t.flow_id);
		const ids = flow ? handoffPosisiIds(flow, t.node_id, index, myPosisiId) : [];
		ids.forEach((id) => all.add(id));
		return ids.length ? { ...t, handoff_to: ids } : t;
	});
	return { tasks: withHandoff, posisiIds: [...all] };
}

/**
 * Pemegang aktif per jabatan. `holderOf` memetakan karyawan → jabatan pasti (resolveMyPosisi); karyawan saya sendiri dikecualikan.
 */
export function buildRoleContacts(
	karyawan: Array<{ id?: unknown; nama_karyawan?: unknown; no_hp?: unknown; status_kerja?: unknown; status?: unknown }>,
	holderOf: (k: any) => number | null,
	posisiIds: number[],
	index: PosisiIndex,
	excludeKaryawanId?: number | null
): Record<number, RoleContacts> {
	const want = new Set(posisiIds);
	const groups = new Map<number, ContactPerson[]>();
	for (const k of Array.isArray(karyawan) ? karyawan : []) {
		const kid = Number(k?.id);
		if (!Number.isInteger(kid) || kid === excludeKaryawanId || !isActiveKaryawan(k)) continue;
		const pid = holderOf(k);
		if (!pid || !want.has(pid)) continue;
		if (!groups.has(pid)) groups.set(pid, []);
		groups.get(pid)!.push({ id: kid, nama: String(k.nama_karyawan || `#${kid}`), wa: toWaNumber(k.no_hp as string) });
	}
	const out: Record<number, RoleContacts> = {};
	for (const pid of posisiIds) {
		const people = (groups.get(pid) ?? []).sort((a, b) => a.nama.localeCompare(b.nama));
		out[pid] = { nama: index.byId.get(pid)?.nama ?? `Jabatan #${pid}`, people: people.slice(0, MAX_PEOPLE_PER_ROLE), total: people.length };
	}
	return out;
}
