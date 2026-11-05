<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconStar, IconInfoCircle } from '@tabler/icons-svelte';
	import { getProjectsForCurrentUser, getProjectScope, getWorkshopScope } from '$lib/services/projectScope';
	import { loadProjectSettings } from '$lib/services/projectSettings';
	import { authStore } from '$lib/stores/auth';
	import {
		submitWorkerRatingsBulk, fetchRecentRatings, fetchWorkshops, fetchWorkshopRoster, fetchProjectRoster
	} from '$lib/services/workerRating';
	import {
		buildRatingPayloads, isDraftComplete, isDraftPartial, ratedTodaySet, lastRatedMap, matchWorkshop,
		type RatingDraft
	} from '$lib/utils/bulkRating';

	// ── Nilai Pekerja — MASSAL (KPI & Kinerja Terpusat, Fase 3) ──────────────
	// PL / Koordinator Workshop menilai seluruh tim sekaligus (kualitas, safety, ketepatan; bintang 1-5).
	// Satu simpan = satu request. Kehadiran & skill dihitung otomatis di ERP (Worker Scorecard) — tidak dinilai di sini.
	// Mode "Per Workshop" untuk pekerja workshop (Ciketing/Balaraja) yang tidak punya penugasan proyek; cakupan workshop
	// mengikuti setelan project.scope.workshop_coordinators (sama dgn akses proyek koordinator), admin/manajer melihat semua.

	type Mode = 'proyek' | 'workshop';
	let loading = $state(true);
	let rosterLoading = $state(false);
	let submitting = $state(false);
	let mode = $state<Mode>('proyek');
	let projects = $state<any[]>([]);
	let workshops = $state<{ id: number; code: string | null; name: string | null }[]>([]);
	let selectedProjectId = $state('');
	let selectedWorkshopId = $state('');
	let drafts = $state<RatingDraft[]>([]);
	let ratedToday = $state<Set<number>>(new Set());
	let lastRated = $state<Map<number, string>>(new Map());
	let catatan = $state('');
	let message = $state<{ type: 'ok' | 'err'; text: string } | null>(null);
	let loadError = $state('');
	let seq = 0;

	const completeCount = $derived(drafts.filter((d) => isDraftComplete(d) && !ratedToday.has(d.manpowerId)).length);
	const partialCount = $derived(drafts.filter((d) => isDraftPartial(d) && !ratedToday.has(d.manpowerId)).length);
	const contextProjectId = $derived(mode === 'proyek' && selectedProjectId ? Number(selectedProjectId) : null);
	const contextWorkshopId = $derived(mode === 'workshop' && selectedWorkshopId ? Number(selectedWorkshopId) : null);

	async function resolveWorkshops() {
		const all = await fetchWorkshops();
		if (getProjectScope().unrestricted) return all;
		return getWorkshopScope()
			.map((key) => matchWorkshop(key, all))
			.filter((w): w is NonNullable<typeof w> => !!w);
	}

	async function loadRoster() {
		const my = ++seq;
		rosterLoading = true;
		loadError = '';
		message = null;
		try {
			let base: { manpowerId: number; nama: string; jabatan: string }[] = [];
			if (mode === 'proyek' && selectedProjectId) {
				base = await fetchProjectRoster(Number(selectedProjectId));
			} else if (mode === 'workshop' && selectedWorkshopId) {
				const roster = await fetchWorkshopRoster(Number(selectedWorkshopId));
				base = roster.map((r) => ({ manpowerId: Number(r.manpower_id), nama: r.karyawan_nama, jabatan: r.jabatan || '' }));
			}
			const past = await fetchRecentRatings(base.map((b) => b.manpowerId));
			if (my !== seq) return;
			ratedToday = ratedTodaySet(past, contextProjectId, undefined, contextWorkshopId);
			lastRated = lastRatedMap(past);
			drafts = base.map((b) => ({ ...b, kualitas: 0, safety: 0, ketepatan: 0 }));
		} catch (e: any) {
			if (my === seq) { drafts = []; loadError = e?.message || 'Gagal memuat daftar pekerja'; }
		} finally {
			if (my === seq) rosterLoading = false;
		}
	}

	function setMode(m: Mode) {
		if (mode === m) return;
		mode = m;
		drafts = [];
		loadRoster();
	}

	/** Isi 4★ hanya pada kolom yang masih kosong — titik awal cepat, lalu ubah yang berbeda. */
	function fillDefault(d: RatingDraft) {
		if (!d.kualitas) d.kualitas = 4;
		if (!d.safety) d.safety = 4;
		if (!d.ketepatan) d.ketepatan = 4;
	}
	function fillAllDefault() {
		for (const d of drafts) if (!ratedToday.has(d.manpowerId)) fillDefault(d);
	}

	async function handleSubmit() {
		const payloads = buildRatingPayloads({
			drafts,
			projectId: contextProjectId,
			workshopId: contextWorkshopId,
			catatan,
			dinilaiOleh: $authStore.karyawanName || '',
			skipManpowerIds: ratedToday
		});
		if (!payloads.length) return;
		submitting = true;
		message = null;
		try {
			const res = await submitWorkerRatingsBulk(payloads);
			if (res.success) {
				message = { type: 'ok', text: `✓ ${res.count} penilaian tersimpan` };
				catatan = '';
				await loadRoster();
				message = { type: 'ok', text: `✓ ${res.count} penilaian tersimpan` };
			} else {
				message = { type: 'err', text: res.error || 'Gagal menyimpan penilaian' };
			}
		} finally {
			submitting = false;
		}
	}

	onMount(async () => {
		try {
			await loadProjectSettings();
			const [p, w] = await Promise.all([getProjectsForCurrentUser(true), resolveWorkshops()]);
			projects = p || [];
			workshops = w;
			if (projects.length) selectedProjectId = String(projects[0].id);
			if (workshops.length) selectedWorkshopId = String(workshops[0].id);
			// Koordinator workshop tanpa proyek langsung masuk mode workshop.
			if (!projects.length && workshops.length) mode = 'workshop';
			await loadRoster();
		} catch (e: any) {
			loadError = e?.message || 'Gagal memuat data';
		} finally {
			loading = false;
		}
	});
</script>

{#snippet stars(label: string, value: number, onSet: (v: number) => void, disabled: boolean)}
	<div class="flex items-center justify-between gap-2">
		<span class="text-[11px] text-gray-500 w-16 shrink-0">{label}</span>
		<div class="flex gap-0.5" role="radiogroup" aria-label={label}>
			{#each [1, 2, 3, 4, 5] as s}
				<button
					type="button"
					{disabled}
					aria-label="{label} {s} bintang"
					aria-pressed={value === s}
					onclick={() => onSet(value === s ? 0 : s)}
					class="p-0.5 disabled:opacity-40"
				>
					<IconStar size={24} class={value >= s ? 'fill-amber-400 text-amber-400' : 'text-gray-300'} />
				</button>
			{/each}
		</div>
	</div>
{/snippet}

<div class="flex flex-col h-full bg-gray-50">
	<div class="sticky top-0 z-10 bg-white border-b border-gray-100 px-4 py-3 flex items-center gap-3">
		<button onclick={() => goto('/manpower')} class="p-1 -ml-1 text-gray-500" aria-label="Kembali">
			<IconArrowLeft size={20} />
		</button>
		<div>
			<p class="text-[14px] font-semibold text-gray-800">Nilai Pekerja</p>
			<p class="text-[11px] text-gray-400">Kualitas, safety & ketepatan — seluruh tim sekaligus</p>
		</div>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat daftar pekerja..." />
		</div>
	{:else}
		<div class="flex-1 overflow-y-auto px-4 py-4 space-y-3 pb-28">
			<details class="bg-sky-50 border border-sky-100 rounded-xl px-3 py-2 text-[12px] text-sky-900">
				<summary class="cursor-pointer font-semibold flex items-center gap-1.5"><IconInfoCircle size={15} /> Cara menilai (10 detik)</summary>
				<ol class="list-decimal ml-5 mt-1.5 space-y-0.5">
					<li>Pilih proyek{workshops.length ? ' atau tab Per Workshop' : ''}. Semua pekerja aktif muncul.</li>
					<li>Ketuk bintang untuk Kualitas, Safety, Ketepatan. Ketuk bintang yang sama lagi untuk mengosongkan.</li>
					<li>"Isi 4★ yang kosong" mengisi nilai awal "baik" — ubah hanya yang berbeda.</li>
					<li>Pekerja yang belum lengkap (3 bintang) tidak ikut tersimpan. Satu pekerja hanya bisa dinilai sekali per hari per proyek.</li>
				</ol>
			</details>

			{#if message}
				<div class="{message.type === 'ok' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'} border text-[13px] rounded-lg px-3 py-2 text-center" role={message.type === 'err' ? 'alert' : 'status'}>
					{message.text}
				</div>
			{/if}

			{#if workshops.length}
				<div class="grid grid-cols-2 gap-1 bg-gray-200/70 p-1 rounded-xl" role="tablist">
					<button role="tab" aria-selected={mode === 'proyek'} onclick={() => setMode('proyek')} class="py-1.5 rounded-lg text-[12px] font-semibold {mode === 'proyek' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}">Per Proyek</button>
					<button role="tab" aria-selected={mode === 'workshop'} onclick={() => setMode('workshop')} class="py-1.5 rounded-lg text-[12px] font-semibold {mode === 'workshop' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}">Per Workshop</button>
				</div>
			{/if}

			{#if mode === 'proyek'}
				<div class="bg-white rounded-xl border border-gray-100 p-3">
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider" for="rating-proyek">Proyek</label>
					<select id="rating-proyek" bind:value={selectedProjectId} onchange={loadRoster} class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200 bg-white">
						{#each projects as p}
							<option value={String(p.id)}>{p.name}</option>
						{/each}
					</select>
					{#if !projects.length}
						<p class="text-[12px] text-gray-400 mt-2">Anda belum memegang proyek aktif.</p>
					{/if}
				</div>
			{:else}
				<div class="bg-white rounded-xl border border-gray-100 p-3">
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider" for="rating-ws">Workshop</label>
					<select id="rating-ws" bind:value={selectedWorkshopId} onchange={loadRoster} class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200 bg-white">
						{#each workshops as w}
							<option value={String(w.id)}>{w.name || w.code}</option>
						{/each}
					</select>
					<p class="text-[11px] text-gray-400 mt-1.5">Pekerja workshop yang sudah terhubung ke data pekerja pusat. Penilaian ini tidak terikat proyek.</p>
				</div>
			{/if}

			{#if loadError}
				<div class="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-lg px-3 py-2" role="alert">{loadError} — <button class="underline font-semibold" onclick={loadRoster}>coba lagi</button></div>
			{:else if rosterLoading}
				<div class="py-10 flex justify-center"><CircularProgressGauge size={40} strokeWidth={4} label="Memuat pekerja..." /></div>
			{:else if drafts.length === 0}
				<div class="bg-white rounded-xl border border-gray-100 p-6 text-center text-[13px] text-gray-400">
					{mode === 'proyek' ? 'Belum ada pekerja aktif di proyek ini. Penugasan dilakukan di menu Manpower.' : 'Belum ada pekerja workshop yang terhubung ke data pekerja pusat.'}
				</div>
			{:else}
				<div class="flex items-center justify-between">
					<p class="text-[12px] text-gray-500">{drafts.length} pekerja · {completeCount} siap disimpan</p>
					<button type="button" onclick={fillAllDefault} class="text-[12px] font-semibold text-amber-600">Isi 4★ yang kosong</button>
				</div>

				{#each drafts as d (d.manpowerId)}
					{@const locked = ratedToday.has(d.manpowerId)}
					<div class="bg-white rounded-xl border p-3 space-y-1.5 {locked ? 'border-emerald-200 bg-emerald-50/40' : isDraftComplete(d) ? 'border-amber-300' : 'border-gray-100'}">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="text-[13px] font-semibold text-gray-800 truncate">{d.nama}</p>
								<p class="text-[11px] text-gray-400 truncate">{d.jabatan || '-'}{#if lastRated.get(d.manpowerId)} · terakhir dinilai {lastRated.get(d.manpowerId)}{/if}</p>
							</div>
							{#if locked}
								<span class="text-[11px] font-semibold text-emerald-700 whitespace-nowrap">✓ Sudah dinilai hari ini</span>
							{:else}
								<button type="button" onclick={() => fillDefault(d)} class="text-[11px] font-semibold text-amber-600 whitespace-nowrap">4★ semua</button>
							{/if}
						</div>
						{@render stars('Kualitas', d.kualitas, (v) => (d.kualitas = v), locked)}
						{@render stars('Safety', d.safety, (v) => (d.safety = v), locked)}
						{@render stars('Ketepatan', d.ketepatan, (v) => (d.ketepatan = v), locked)}
						{#if isDraftPartial(d) && !locked}
							<p class="text-[11px] text-amber-600">Lengkapi ketiga bintang agar tersimpan.</p>
						{/if}
					</div>
				{/each}

				<div class="bg-white rounded-xl border border-gray-100 p-3">
					<label class="text-[10px] font-semibold text-gray-400 uppercase tracking-wider" for="rating-catatan">Catatan untuk semua (opsional)</label>
					<textarea id="rating-catatan" bind:value={catatan} rows="2" placeholder="Mis. minggu ke-2, pekerjaan epoxy lantai" class="w-full mt-1 text-[13px] px-3 py-2 rounded-lg border border-gray-200"></textarea>
				</div>
			{/if}
		</div>

		{#if drafts.length > 0}
			<div class="sticky bottom-0 bg-white border-t border-gray-100 px-4 py-3">
				{#if partialCount > 0}
					<p class="text-[11px] text-amber-600 mb-1.5 text-center">{partialCount} pekerja belum lengkap dan tidak ikut disimpan.</p>
				{/if}
				<button
					onclick={handleSubmit}
					disabled={submitting || completeCount === 0}
					class="w-full py-2.5 rounded-lg bg-[var(--g)] text-white text-[13px] font-semibold disabled:opacity-50"
				>
					{submitting ? 'Menyimpan...' : completeCount === 0 ? 'Isi minimal 1 pekerja' : `Simpan ${completeCount} Penilaian`}
				</button>
			</div>
		{/if}
	{/if}
</div>
