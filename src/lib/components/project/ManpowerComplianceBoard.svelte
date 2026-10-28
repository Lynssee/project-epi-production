<!-- Papan Kepatuhan Tim (Akuntabilitas Pembayaran Manpower v3, F4.5) — widget ringkas di tab
     Manpower proyek: % pekerja terverifikasi HRD & % dokumen lengkap, untuk tim proyek ini.
     Read-only, murni indikator — tidak menahan aksi apa pun di lapangan (verifikasi/dokumen
     tetap wewenang HRD di erp-epi-1). -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { readItems } from '@directus/sdk';
	import directus from '$lib/services/directus';

	let { projectId } = $props<{ projectId: string | number }>();

	let loading = $state(true);
	let verifiedPct = $state<number | null>(null);
	let dokumenPct = $state<number | null>(null);
	let totalPekerja = $state(0);

	async function load() {
		loading = true;
		try {
			const assignments = (await directus.request(
				readItems('manpower_assignment' as any, {
					filter: { project_id: { _eq: projectId }, status: { _eq: 'aktif' } },
					fields: ['manpower_id', 'jenis_pekerjaan'],
					limit: -1
				})
			)) as any[];

			const manpowerIds = [...new Set(assignments.map((a) => (typeof a.manpower_id === 'object' ? a.manpower_id?.id : a.manpower_id)).filter(Boolean))];
			totalPekerja = manpowerIds.length;
			if (manpowerIds.length === 0) {
				verifiedPct = null;
				dokumenPct = null;
				return;
			}

			const [manpowerRows, syaratRows, dokumenRows] = await Promise.all([
				directus.request(readItems('manpower' as any, { filter: { id: { _in: manpowerIds } }, fields: ['id', 'status_pekerja'], limit: -1 })) as Promise<any[]>,
				directus.request(readItems('manpower_dokumen_syarat' as any, { filter: { wajib: { _eq: true } }, fields: ['jenis_pekerjaan', 'jenis_dokumen'], limit: -1 })) as Promise<any[]>,
				directus.request(readItems('manpower_dokumen' as any, { filter: { manpower_id: { _in: manpowerIds } }, fields: ['manpower_id', 'jenis_dokumen', 'status_verifikasi', 'tanggal_kedaluwarsa'], limit: -1 })) as Promise<any[]>
			]);

			const verifiedCount = manpowerRows.filter((m) => m.status_pekerja === 'terverifikasi').length;
			verifiedPct = Math.round((verifiedCount / manpowerIds.length) * 100);

			const jpByManpower = new Map(assignments.map((a) => [typeof a.manpower_id === 'object' ? a.manpower_id?.id : a.manpower_id, (a.jenis_pekerjaan || '').trim().toLowerCase()]));
			const today = new Date();
			let lengkapCount = 0;
			let evaluatedCount = 0;
			for (const mpId of manpowerIds) {
				const jp = jpByManpower.get(mpId) || '';
				const wajibTypes = [...new Set(syaratRows.filter((s) => { const sjp = (s.jenis_pekerjaan || '').trim().toLowerCase(); return !sjp || sjp === jp; }).map((s) => s.jenis_dokumen))];
				if (wajibTypes.length === 0) continue;
				evaluatedCount++;
				const dokMilik = dokumenRows.filter((d) => (typeof d.manpower_id === 'object' ? d.manpower_id?.id : d.manpower_id) === mpId);
				const complete = wajibTypes.every((t) => dokMilik.some((d) => d.jenis_dokumen === t && d.status_verifikasi === 'terverifikasi' && (!d.tanggal_kedaluwarsa || new Date(d.tanggal_kedaluwarsa) >= today)));
				if (complete) lengkapCount++;
			}
			dokumenPct = evaluatedCount > 0 ? Math.round((lengkapCount / evaluatedCount) * 100) : null;
		} catch (e) {
			console.error('ManpowerComplianceBoard:', e);
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function color(pct: number | null) {
		if (pct == null) return 'text-gray-400';
		if (pct >= 80) return 'text-emerald-600';
		if (pct >= 50) return 'text-amber-600';
		return 'text-red-600';
	}
</script>

{#if !loading && totalPekerja > 0}
	<div class="grid grid-cols-2 gap-3 mb-3">
		<div class="bg-white border border-gray-100 rounded-xl p-3">
			<p class="text-[10px] text-gray-400 uppercase font-semibold">Pekerja Terverifikasi HRD</p>
			<p class="text-xl font-bold {color(verifiedPct)}">{verifiedPct ?? '-'}{verifiedPct != null ? '%' : ''}</p>
			<p class="text-[10px] text-gray-400">dari {totalPekerja} pekerja aktif</p>
		</div>
		<div class="bg-white border border-gray-100 rounded-xl p-3">
			<p class="text-[10px] text-gray-400 uppercase font-semibold">Dokumen Lengkap</p>
			<p class="text-xl font-bold {color(dokumenPct)}">{dokumenPct ?? '-'}{dokumenPct != null ? '%' : ''}</p>
			<p class="text-[10px] text-gray-400">{dokumenPct == null ? 'tidak ada syarat dokumen berlaku' : 'per syarat jenis pekerjaan'}</p>
		</div>
	</div>
{/if}
