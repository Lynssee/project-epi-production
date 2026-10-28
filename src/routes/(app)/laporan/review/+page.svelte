<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// src/routes/(app)/laporan/review/+page.svelte
	// PRJ-18 §4.2 — Antrean review laporan harian untuk PM di lapangan: laporan `submitted` (skor mutu terendah dulu), tombol Setujui /
	// Minta Revisi per laporan, dan Setujui Massal untuk laporan yang lengkap tanpa tanda kualitas. Keputusan lewat API ERP (izin dicek di server).
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { fetchReviewQueue, approveReport, requestRevision, bulkApproveReports, FLAG_LABEL, type ReviewItem } from '$lib/services/laporanReview';

	let items = $state<ReviewItem[]>([]);
	let loading = $state(true);
	let errorMsg = $state('');
	let busy = $state<Record<number, boolean>>({});
	let selected = $state<Record<number, boolean>>({});
	let bulkBusy = $state(false);
	let notice = $state('');

	const izin = () => hasPermission(get(authStore).roleId, 'approve_laporan', get(rolesStore));
	const bolehReview = $derived(izin());
	const selectedIds = $derived(Object.keys(selected).filter((k) => selected[Number(k)]).map(Number));
	const eligible = $derived(items.filter((i) => i.bulkOk));

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			items = await fetchReviewQueue();
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat antrean.';
		} finally {
			loading = false;
		}
	}
	onMount(() => {
		if (!izin()) { goto('/laporan'); return; }
		load();
	});

	function note(msg: string) { notice = msg; setTimeout(() => (notice = ''), 5000); }

	async function setujui(it: ReviewItem) {
		busy[it.id] = true;
		try { await approveReport(it.id); items = items.filter((x) => x.id !== it.id); note('Laporan disetujui.'); }
		catch (e: any) { errorMsg = e?.message || 'Gagal menyetujui.'; }
		finally { busy[it.id] = false; }
	}
	async function revisi(it: ReviewItem) {
		const flags = it.quality_flags.map((f) => FLAG_LABEL[f] || f);
		const saran = flags.length ? `Mohon dilengkapi: ${flags.join('; ')}.` : '';
		const catatan = prompt('Catatan revisi untuk Leader (wajib):', saran);
		if (catatan === null) return;
		if (!catatan.trim()) { errorMsg = 'Catatan revisi wajib diisi.'; return; }
		busy[it.id] = true;
		try { await requestRevision(it.id, catatan.trim()); items = items.filter((x) => x.id !== it.id); note('Revisi diminta — Leader melihatnya di "Perlu Diperbaiki".'); }
		catch (e: any) { errorMsg = e?.message || 'Gagal meminta revisi.'; }
		finally { busy[it.id] = false; }
	}
	function pilihSemua() { const n: Record<number, boolean> = {}; for (const i of eligible) n[i.id] = true; selected = n; }
	async function massal() {
		if (!selectedIds.length || bulkBusy) return;
		if (!confirm(`Setujui ${selectedIds.length} laporan tanpa tanda kualitas?`)) return;
		bulkBusy = true;
		try {
			const r = await bulkApproveReports(selectedIds);
			const ok = new Set(r.approved);
			items = items.filter((x) => !ok.has(x.id));
			selected = {};
			note(`${ok.size} laporan disetujui${r.skipped.length ? `; ${r.skipped.length} dilewati (${r.skipped.map((s) => s.reason).join(', ')})` : ''}.`);
		} catch (e: any) { errorMsg = e?.message || 'Gagal setujui massal.'; }
		finally { bulkBusy = false; }
	}
	const tgl = (d: string) => (d ? new Date(d).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : '-');
</script>

<div class="flex-1 overflow-y-auto pb-24" style="background: var(--bg)">
	<div class="px-4 py-3 flex items-center gap-2">
		<button class="w-9 h-9 rounded-xl flex items-center justify-center" onclick={() => goto('/laporan')} aria-label="Kembali"><IconArrowLeft size={20} /></button>
		<div>
			<h1 class="text-[16px] font-extrabold" style="color: var(--sys-label)">Review Laporan Harian</h1>
			<p class="text-[11px]" style="color: var(--sys-label3)">Skor mutu terendah dulu. Setujui massal hanya untuk laporan tanpa tanda kualitas.</p>
		</div>
	</div>

	{#if !bolehReview}
		<p class="px-4 text-[12px]">Anda tidak punya izin review laporan.</p>
	{:else}
		{#if notice}<div class="mx-4 mb-2 p-2 rounded-lg text-[12px] bg-emerald-50 text-emerald-800 border border-emerald-200">{notice}</div>{/if}
		{#if errorMsg}<div class="mx-4 mb-2 p-2 rounded-lg text-[12px] bg-rose-50 text-rose-700 border border-rose-200">{errorMsg}</div>{/if}

		{#if eligible.length > 0}
			<div class="mx-4 mb-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-[12px] flex items-center gap-2 flex-wrap">
				<span class="flex-1 text-emerald-900">{eligible.length} laporan lengkap & tanpa tanda kualitas bisa disetujui sekaligus.</span>
				<button class="px-2.5 py-1 rounded-lg bg-white border border-emerald-300 font-semibold" onclick={pilihSemua}>Pilih semua</button>
				<button class="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold disabled:opacity-50" disabled={!selectedIds.length || bulkBusy} onclick={massal}>{bulkBusy ? 'Memproses…' : `Setujui massal (${selectedIds.length})`}</button>
			</div>
		{/if}

		{#if loading}
			<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat review laporan harian..." />
	</div>
		{:else if items.length === 0}
			<p class="text-center text-[12px] py-10" style="color: var(--sys-label3)">Tidak ada laporan menunggu review. 🎉</p>
		{:else}
			<div class="px-4 space-y-2.5">
				{#each items as it (it.id)}
					<div class="card-section">
						<div class="flex items-start gap-2.5">
							{#if it.bulkOk}<input type="checkbox" class="mt-1" bind:checked={selected[it.id]} title="Pilih untuk setujui massal" />{/if}
							<div class="w-10 h-10 rounded-full border-2 flex items-center justify-center text-[12px] font-extrabold shrink-0"
								style="border-color: {it.quality_score == null ? '#94a3b8' : it.quality_score >= 80 ? '#34C759' : it.quality_score >= 50 ? '#FF9500' : '#FF3B30'}">{it.quality_score ?? '—'}</div>
							<div class="min-w-0 flex-1">
								<p class="text-[13px] font-bold truncate" style="color: var(--sys-label)">{it.project_name}</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">{tgl(it.date)} · {it.prepared_by || '—'}</p>
								{#if it.quality_flags.length}
									<div class="flex flex-wrap gap-1 mt-1.5">
										{#each it.quality_flags as f}<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200">{FLAG_LABEL[f] || f}</span>{/each}
									</div>
								{/if}
							</div>
						</div>
						<div class="flex gap-2 mt-2.5">
							<button class="flex-1 py-2 rounded-xl text-[12px] font-bold bg-emerald-600 text-white disabled:opacity-50" disabled={busy[it.id]} onclick={() => setujui(it)}>Setujui</button>
							<button class="flex-1 py-2 rounded-xl text-[12px] font-bold bg-amber-500 text-white disabled:opacity-50" disabled={busy[it.id]} onclick={() => revisi(it)}>Minta Revisi</button>
							<button class="px-3 py-2 rounded-xl text-[12px] font-semibold border" style="border-color: var(--bd, #e5e7eb)" onclick={() => goto(`/laporan/${it.project_id}`)}>Buka</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
