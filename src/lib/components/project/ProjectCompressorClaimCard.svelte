<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Fase 4b — Kartu "Klaim Operasional Kompresor" untuk Project Leader.
	// Leader menyusun DRAFT solar/sewa harian per unit + melihat prasyarat (P2H, tutup
	// pemakaian, Laporan Harian). Pengajuan & verifikasi tetap di dashboard admin.
	import { onMount } from 'svelte';
	import {
		getProjectCompressorPrereq,
		saveCompressorClaimDraft,
		type ProjectCompressorPrereq,
		type CompressorUnitPrereq
	} from '$lib/services/compressorClaim';
	import {
		IconLoader2,
		IconGasStation,
		IconCircleCheck,
		IconAlertTriangle,
		IconClockPause,
		IconDeviceFloppy
	} from '@tabler/icons-svelte';

	let { projectId }: { projectId: number | string } = $props();

	let loading = $state(true);
	let errMsg = $state('');
	let data = $state<ProjectCompressorPrereq | null>(null);

	// form per-unit (equipment_id -> draft fields)
	let openFor = $state<string | null>(null);
	let saving = $state(false);
	let saveMsg = $state('');
	let f = $state<{
		unit_ownership: 'milik' | 'sewa';
		vendor_name: string;
		idle: boolean;
		jam_operasi: string;
		solar_liter: string;
		solar_rp: string;
		sewa_rp: string;
		catatan: string;
	}>(blankForm());

	function blankForm() {
		return {
			unit_ownership: 'milik' as const,
			vendor_name: '',
			idle: false,
			jam_operasi: '',
			solar_liter: '',
			solar_rp: '',
			sewa_rp: '',
			catatan: ''
		};
	}

	async function load() {
		loading = true;
		errMsg = '';
		try {
			data = await getProjectCompressorPrereq(projectId);
		} catch (e: any) {
			errMsg = e?.message || 'Gagal memuat status kompresor.';
		} finally {
			loading = false;
		}
	}
	onMount(load);

	function openForm(u: CompressorUnitPrereq) {
		openFor = u.equipment_id;
		saveMsg = '';
		if (u.claim) {
			f = {
				unit_ownership: u.claim.unit_ownership || 'milik',
				vendor_name: u.claim.vendor_name || '',
				idle: !!u.claim.idle,
				jam_operasi: u.claim.jam_operasi != null ? String(u.claim.jam_operasi) : '',
				solar_liter: u.claim.solar_liter != null ? String(u.claim.solar_liter) : '',
				solar_rp: u.claim.solar_rp != null ? String(u.claim.solar_rp) : '',
				sewa_rp: u.claim.sewa_rp != null ? String(u.claim.sewa_rp) : '',
				catatan: u.claim.catatan || ''
			};
		} else {
			f = blankForm();
		}
	}

	async function save(u: CompressorUnitPrereq) {
		saving = true;
		saveMsg = '';
		try {
			await saveCompressorClaimDraft({
				id: u.claim?.id,
				project_id: projectId,
				equipment_id: u.equipment_id,
				tanggal: data!.tanggal,
				unit_ownership: f.unit_ownership,
				vendor_name: f.vendor_name,
				idle: f.idle,
				jam_operasi: f.jam_operasi === '' ? null : Number(f.jam_operasi),
				solar_liter: f.solar_liter === '' ? null : Number(f.solar_liter),
				solar_rp: f.solar_rp === '' ? null : Number(f.solar_rp),
				sewa_rp: f.sewa_rp === '' ? null : Number(f.sewa_rp),
				catatan: f.catatan
			});
			saveMsg = 'Draft klaim tersimpan. Admin akan memverifikasi & mengajukan.';
			openFor = null;
			await load();
		} catch (e: any) {
			saveMsg = e?.message || 'Gagal menyimpan draft.';
		} finally {
			saving = false;
		}
	}

	function p2hBadge(s: string) {
		if (s === 'terisi') return { t: 'P2H ✓', c: 'bg-emerald-100 text-emerald-700' };
		if (s === 'bolong') return { t: 'P2H bolong', c: 'bg-red-100 text-red-700' };
		if (s === 'libur') return { t: 'Libur', c: 'bg-slate-100 text-slate-500' };
		return { t: 'P2H belum', c: 'bg-amber-100 text-amber-700' };
	}
	const rp = (n: any) => 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');

	let unitPrereqWarnings = $derived.by(() => {
		const w: Record<string, string[]> = {};
		if (!data) return w;
		for (const u of data.units) {
			const list: string[] = [];
			if (u.claim?.idle) {
				w[u.equipment_id] = list;
				continue;
			}
			if (u.p2h_status !== 'terisi') list.push('P2H unit hari ini belum terisi');
			if (!u.pemakaian_ditutup) list.push('Pemakaian unit belum ditutup di P2H');
			if (!data.laporan_harian_ada) list.push('Laporan Harian proyek hari ini belum dibuat');
			w[u.equipment_id] = list;
		}
		return w;
	});
</script>

<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
	<div class="mb-3 flex items-center gap-2">
		<IconGasStation size={20} class="text-sky-600" />
		<h3 class="text-sm font-semibold text-slate-800">Klaim Operasional Kompresor — Hari Ini</h3>
		{#if data}<span class="ml-auto text-xs text-slate-400">{data.tanggal}</span>{/if}
	</div>

	<p class="mb-3 text-xs text-slate-500">
		Catat solar &amp; sewa kompresor per unit. Draft ini diverifikasi &amp; diajukan admin.
		Lengkapi <b>P2H unit</b>, <b>tutup pemakaian</b>, dan <b>Laporan Harian</b> agar klaim lolos gate.
	</p>

	{#if loading}
		<CircularProgressGauge size={44} strokeWidth={3} label="Memuat klaim kompresor..." />
	{:else if errMsg}
		<div class="rounded-lg bg-red-50 p-3 text-sm text-red-700">{errMsg}</div>
	{:else if !data || data.units.length === 0}
		<div class="rounded-lg bg-slate-50 p-3 text-sm text-slate-500">
			Tidak ada unit kompresor terpasang / terpantau di proyek ini hari ini.
		</div>
	{:else}
		{#if !data.laporan_harian_ada}
			<div class="mb-3 flex items-start gap-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-800">
				<IconAlertTriangle size={14} class="mt-0.5 shrink-0" />
				Laporan Harian proyek hari ini belum dibuat — buat dulu agar klaim solar bisa diverifikasi Finance.
			</div>
		{/if}

		<div class="space-y-3">
			{#each data.units as u (u.equipment_id)}
				{@const badge = p2hBadge(u.p2h_status)}
				{@const warns = unitPrereqWarnings[u.equipment_id] || []}
				<div class="rounded-xl border border-slate-200 p-3">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-medium text-slate-800">{u.code} — {u.name}</span>
						<span class="rounded px-1.5 py-0.5 text-[11px] {badge.c}">{badge.t}</span>
						<span
							class="rounded px-1.5 py-0.5 text-[11px] {u.pemakaian_ditutup
								? 'bg-emerald-100 text-emerald-700'
								: 'bg-slate-100 text-slate-500'}"
						>
							{u.pemakaian_ditutup ? 'Ditutup ✓' : 'Belum ditutup'}
						</span>
						{#if u.claim}
							<span class="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600">
								Klaim: {u.claim.idle ? 'Idle' : rp(u.claim.total_klaim_rp)} · {u.claim.status}
							</span>
						{/if}
						<button
							class="ml-auto rounded-lg bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-700 disabled:opacity-50"
							onclick={() => (openFor === u.equipment_id ? (openFor = null) : openForm(u))}
							disabled={!!u.claim && u.claim.status !== 'draft'}
						>
							{u.claim ? (u.claim.status === 'draft' ? 'Ubah draft' : 'Terkirim') : 'Buat draft'}
						</button>
					</div>

					{#if warns.length}
						<ul class="mt-2 space-y-0.5 text-[11px] text-amber-700">
							{#each warns as wm}
								<li class="flex items-center gap-1"><IconClockPause size={12} /> {wm}</li>
							{/each}
						</ul>
					{:else if !u.claim?.idle}
						<p class="mt-2 flex items-center gap-1 text-[11px] text-emerald-700">
							<IconCircleCheck size={12} /> Prasyarat lengkap — klaim siap diajukan admin.
						</p>
					{/if}

					{#if openFor === u.equipment_id}
						<div class="mt-3 grid grid-cols-2 gap-2 rounded-lg bg-slate-50 p-3 text-xs">
							<label class="col-span-2 flex items-center gap-2 text-slate-600">
								<input type="checkbox" bind:checked={f.idle} />
								Kompresor tidak dioperasikan hari ini
							</label>
							{#if !f.idle}
								<label class="text-slate-600">Jam operasi
									<input type="number" step="0.5" min="0" bind:value={f.jam_operasi}
										class="mt-1 block w-full rounded border-slate-300 text-xs" />
								</label>
								<label class="text-slate-600">Solar (liter)
									<input type="number" step="0.1" min="0" bind:value={f.solar_liter}
										class="mt-1 block w-full rounded border-slate-300 text-xs" />
								</label>
								<label class="text-slate-600">Solar (Rp)
									<input type="number" min="0" bind:value={f.solar_rp}
										class="mt-1 block w-full rounded border-slate-300 text-xs" />
								</label>
								<label class="text-slate-600">Sewa (Rp)
									<input type="number" min="0" bind:value={f.sewa_rp}
										class="mt-1 block w-full rounded border-slate-300 text-xs" />
								</label>
								<label class="col-span-2 flex gap-3 text-slate-600">
									<span>Unit:</span>
									<label><input type="radio" bind:group={f.unit_ownership} value="milik" /> Milik EPI</label>
									<label><input type="radio" bind:group={f.unit_ownership} value="sewa" /> Sewa</label>
								</label>
								{#if f.unit_ownership === 'sewa'}
									<label class="col-span-2 text-slate-600">Vendor
										<input bind:value={f.vendor_name} class="mt-1 block w-full rounded border-slate-300 text-xs" />
									</label>
								{/if}
							{/if}
							<label class="col-span-2 text-slate-600">Catatan
								<input bind:value={f.catatan} class="mt-1 block w-full rounded border-slate-300 text-xs" />
							</label>
							<div class="col-span-2 flex items-center gap-2">
								<button
									class="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
									onclick={() => save(u)}
									disabled={saving}
								>
									<IconDeviceFloppy size={14} />
									{saving ? 'Menyimpan…' : 'Simpan Draft'}
								</button>
								<button class="text-xs text-slate-500 hover:underline" onclick={() => (openFor = null)}>Batal</button>
							</div>
						</div>
					{/if}
				</div>
			{/each}
		</div>

		{#if saveMsg}
			<div class="mt-3 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">{saveMsg}</div>
		{/if}
	{/if}
</div>
