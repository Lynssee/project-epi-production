<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		getPeerReviewList,
		submitPeerReview,
		type PeerAssignment
	} from '$lib/services/ess/kpiPeerReview';
	import type { KriteriaItem, KpiReview } from '$lib/services/ess/kpi';
	import { IconLoader2, IconAlertTriangle, IconUsersGroup, IconClipboardCheck } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let assignments = $state<PeerAssignment[]>([]);
	let myReviews = $state<KpiReview[]>([]);
	let defaultKriteria = $state<KriteriaItem[]>([]);

	let showModal = $state(false);
	let saving = $state(false);
	let activeAssignment = $state<PeerAssignment | null>(null);
	let formKriteria = $state<KriteriaItem[]>([]);
	let formKomentar = $state('');

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getPeerReviewList();
			assignments = res.assignments;
			myReviews = res.myReviews;
			defaultKriteria = res.defaultKriteria;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data penilaian rekan.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function existingReview(scorecardId: string) {
		return myReviews.find((r) => r.scorecard_id === scorecardId) || null;
	}

	function openReview(a: PeerAssignment) {
		activeAssignment = a;
		const existing = existingReview(a.id);
		formKriteria = existing ? existing.kriteria.map((k) => ({ ...k })) : defaultKriteria.map((k) => ({ ...k }));
		formKomentar = existing?.komentar || '';
		showModal = true;
	}

	function totalNilaiLive() {
		const totalWeight = formKriteria.reduce((s, k) => s + (Number(k.weight) || 0), 0);
		if (totalWeight === 0) return 0;
		const weighted = formKriteria.reduce((sum, k) => sum + (Number(k.score) || 0) * (Number(k.weight) || 0), 0);
		return Math.round((weighted / totalWeight) * 10) / 10;
	}

	async function handleSubmit() {
		if (!activeAssignment) return;
		if (formKriteria.some((k) => !k.score || k.score < 1 || k.score > 5)) {
			errorMsg = 'Isi semua skor kriteria (1-5) sebelum submit.';
			return;
		}
		saving = true;
		try {
			await submitPeerReview(activeAssignment.id, formKriteria, formKomentar);
			showModal = false;
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal submit penilaian.';
		} finally {
			saving = false;
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Penilaian Rekan Kerja</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Anda ditunjuk sebagai rekan penilai (peer/360°) untuk kinerja rekan berikut.</p>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat penilaian rekan kerja..." />
		</div>
	{:else if errorMsg && !showModal}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else if assignments.length === 0}
		<div class="glass-panel rounded-2xl p-10 text-center">
			<div class="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center mx-auto mb-4">
				<IconUsersGroup size={32} class="text-slate-400" />
			</div>
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada penugasan penilaian rekan untuk Anda.</p>
		</div>
	{:else}
		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			{#each assignments as a (a.id)}
				{@const review = existingReview(a.id)}
				<button
					class="hover-lift glass-panel rounded-2xl p-5 text-left flex items-center justify-between group focus:outline-none"
					onclick={() => openReview(a)}
				>
					<div>
						<p class="text-base font-bold mb-1" style="color: var(--sys-label)">{a.nama_karyawan}</p>
						<p class="text-xs" style="color: var(--sys-label3)">{a.periode} {a.tahun ? `(${a.tahun})` : ''}</p>
					</div>
					<div class="flex items-center gap-3">
						{#if review}
							<span class="text-xs font-bold px-3 py-1 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">Tersimpan</span>
						{:else}
							<span class="text-xs font-bold px-3 py-1 rounded-full text-blue-600 bg-blue-50 border border-blue-200 transition-colors group-hover:bg-blue-600 group-hover:text-white">Nilai Sekarang</span>
						{/if}
						<div class="w-10 h-10 rounded-full flex items-center justify-center bg-blue-50 text-blue-600 transition-transform group-hover:scale-110">
							<IconClipboardCheck size={20} />
						</div>
					</div>
				</button>
			{/each}
		</div>
	{/if}
</div>

{#if showModal && activeAssignment}
	<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/40 backdrop-blur-sm p-0 sm:p-4 transition-opacity" onclick={(e) => { if (e.target === e.currentTarget) showModal = false; }}>
		<div class="bg-white rounded-t-3xl sm:rounded-3xl w-full sm:max-w-xl max-h-[90vh] flex flex-col shadow-2xl">
			<div class="p-6 border-b border-slate-200 flex items-center justify-between shrink-0">
				<div>
					<h3 class="text-lg font-bold" style="color: var(--sys-label)">Nilai {activeAssignment.nama_karyawan}</h3>
					<p class="text-xs font-medium mt-1" style="color: var(--sys-label3)">Periode {activeAssignment.periode}. Nilai kinerja rekan Anda (1 = kurang, 5 = sangat baik).</p>
				</div>
				<div class="bg-blue-50 px-4 py-2 rounded-xl text-center">
					<p class="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-0.5">Total</p>
					<p class="text-xl font-black text-blue-700 leading-none">{totalNilaiLive()}</p>
				</div>
			</div>

			<div class="p-6 overflow-y-auto space-y-6">
				{#if errorMsg}
					<div class="bg-red-50 text-red-600 text-xs font-bold p-3 rounded-xl flex items-center gap-2 border border-red-100">
						<IconAlertTriangle size={16} /> {errorMsg}
					</div>
				{/if}

				<div class="flex flex-col gap-4">
					{#each formKriteria as k}
						<div class="bg-slate-50 rounded-2xl p-4 border border-slate-200">
							<div class="flex justify-between items-start mb-4">
								<span class="text-sm font-bold" style="color: var(--sys-label)">{k.name}</span>
								<span class="text-[10px] font-bold bg-slate-200 px-2 py-0.5 rounded text-slate-600">bobot {k.weight}%</span>
							</div>
							<div class="flex gap-2 mb-4">
								{#each [1, 2, 3, 4, 5] as v}
									<button
										class="flex-1 h-10 rounded-xl text-sm font-black transition-all hover:scale-105 active:scale-95"
										style={k.score === v
											? 'background: var(--p, var(--g)); color: white; box-shadow: 0 4px 10px rgba(31,101,146,0.3); border: none;'
											: 'background: white; border: 1px solid var(--sys-sep); color: var(--sys-label3);'}
										onclick={() => (k.score = v)}
									>
										{v}
									</button>
								{/each}
							</div>
							<input
								type="text"
								placeholder="Tambahkan catatan pencapaian (opsional)..."
								bind:value={k.notes}
								class="w-full px-3 py-2 text-xs rounded-xl bg-white border transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
								style="border-color: var(--sys-sep); color: var(--sys-label)"
							/>
						</div>
					{/each}
				</div>

				<div class="bg-slate-50 rounded-2xl p-4 border border-slate-200">
					<label class="block text-sm font-bold mb-2" style="color: var(--sys-label)">Komentar Umum</label>
					<textarea
						bind:value={formKomentar}
						rows="3"
						placeholder="Bagaimana evaluasi Anda secara keseluruhan terhadap rekan ini pada periode ini?"
						class="w-full px-3 py-3 text-sm rounded-xl bg-white border transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
						style="border-color: var(--sys-sep); color: var(--sys-label)"
					></textarea>
				</div>
			</div>

			<div class="p-4 sm:p-6 border-t border-slate-200 flex justify-end gap-3 shrink-0 bg-slate-50 rounded-b-3xl">
				<button
					class="px-6 py-2.5 text-sm font-bold rounded-xl bg-white border hover:bg-slate-50 transition-colors"
					style="border-color: var(--sys-sep); color: var(--sys-label3)"
					onclick={() => (showModal = false)}
				>
					Batal
				</button>
				<button
					class="px-6 py-2.5 text-sm font-bold rounded-xl text-white shadow-lg shadow-blue-500/30 hover:shadow-xl hover:-translate-y-0.5 active:translate-y-0 transition-all disabled:opacity-50 disabled:transform-none flex items-center gap-2"
					style="background: var(--p, var(--g))"
					disabled={saving}
					onclick={handleSubmit}
				>
					{#if saving}<IconLoader2 size={16} class="animate-spin" />{/if}
					{saving ? 'Menyimpan...' : 'Kirim Penilaian'}
				</button>
			</div>
		</div>
	</div>
{/if}
