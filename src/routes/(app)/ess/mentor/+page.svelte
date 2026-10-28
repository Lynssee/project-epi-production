<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Dashboard Mentor (Fase 4.3) — mentor melihat mentee yang ditugaskan + isi evaluasi akhir.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { getMentees, submitMenteeEvaluation, type MenteeSummary } from '$lib/services/ess/mentor';
	import { IconArrowLeft, IconLoader2, IconAlertTriangle, IconUsersGroup, IconCircleCheck } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let mentees = $state<MenteeSummary[]>([]);
	let activeId = $state<number | null>(null);
	let skorAkhir = $state(70);
	let rekomendasi = $state('lanjut_tetap');
	let catatan = $state('');
	let submitting = $state(false);

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getMentees();
			mentees = res.mentees;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat daftar mentee.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function openEval(m: MenteeSummary) {
		activeId = activeId === m.onboardingId ? null : m.onboardingId;
		skorAkhir = m.skorAkhir ?? 70;
		rekomendasi = m.rekomendasi || 'lanjut_tetap';
		catatan = '';
	}

	async function handleSubmit(onboardingId: number) {
		submitting = true;
		try {
			await submitMenteeEvaluation(onboardingId, skorAkhir, rekomendasi, catatan);
			activeId = null;
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan evaluasi.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold mb-1" style="color: var(--sys-label)">Dashboard Mentor</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Karyawan baru yang Anda bimbing selama onboarding</p>

	{#if loading}
		<CircularProgressGauge size={50} strokeWidth={4} label="Memuat data mentoring..." />
	{:else if errorMsg}
		<div class="rounded-lg p-4" style="background: var(--rel)">
			<p class="text-[12px] flex items-center gap-1.5" style="color: #DC2626"><IconAlertTriangle size={14} /> {errorMsg}</p>
			<button class="mt-2 text-[11px] font-semibold underline" style="color: #DC2626" onclick={load}>Coba lagi</button>
		</div>
	{:else if mentees.length === 0}
		<div class="glass-panel rounded-2xl p-6 text-center">
			<IconUsersGroup size={28} class="mx-auto mb-2" style="color: var(--sys-label4)" />
			<p class="text-[12px]" style="color: var(--sys-label3)">Anda belum ditugaskan sebagai mentor untuk karyawan mana pun.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each mentees as m (m.onboardingId)}
				<div class="glass-panel rounded-2xl p-4">
					<div class="flex items-center justify-between gap-2">
						<div>
							<p class="text-[13px] font-bold" style="color: var(--sys-label)">{m.namaKaryawan}</p>
							<p class="text-[10px]" style="color: var(--sys-label4)">{m.jenis} · Task {m.doneTasks}/{m.totalTasks}</p>
						</div>
						<span class="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">{m.status}</span>
					</div>
					<div class="w-full h-2 rounded-full bg-gray-100 overflow-hidden my-2">
						<div class="h-full bg-blue-500 rounded-full" style="width: {m.progress}%"></div>
					</div>

					{#if m.skorAkhir != null}
						<p class="text-[11px] flex items-center gap-1" style="color: var(--sys-label3)">
							<IconCircleCheck size={14} class="text-green-600" /> Sudah dievaluasi — skor {m.skorAkhir}, rekomendasi {m.rekomendasi}
						</p>
					{/if}

					<button class="mt-2 text-[11px] font-semibold" style="color: var(--p, #2563EB)" onclick={() => openEval(m)}>
						{m.skorAkhir != null ? 'Ubah Evaluasi' : 'Isi Evaluasi Akhir'}
					</button>

					{#if activeId === m.onboardingId}
						<div class="mt-3 pt-3 border-t border-gray-100 flex flex-col gap-2">
							<label class="text-[10px] font-bold text-gray-500 uppercase" for={`skor-${m.onboardingId}`}>Skor Akhir (0-100)</label>
							<input id={`skor-${m.onboardingId}`} type="number" min="0" max="100" bind:value={skorAkhir} class="text-[12px] p-2 rounded-lg border border-gray-200" />

							<label class="text-[10px] font-bold text-gray-500 uppercase" for={`rekom-${m.onboardingId}`}>Rekomendasi</label>
							<select id={`rekom-${m.onboardingId}`} bind:value={rekomendasi} class="text-[12px] p-2 rounded-lg border border-gray-200">
								<option value="lanjut_tetap">Lanjut ke Karyawan Tetap</option>
								<option value="perpanjang_probation">Perpanjang Masa Probation</option>
								<option value="tidak_lanjut">Tidak Dilanjutkan</option>
							</select>

							<textarea bind:value={catatan} placeholder="Catatan evaluasi" class="text-[11px] p-2 rounded-lg border border-gray-200 resize-none" rows="3"
							></textarea>

							<button
								class="px-4 py-2 rounded-xl text-[12px] font-bold text-white gradient-bg disabled:opacity-50"
								disabled={submitting}
								onclick={() => handleSubmit(m.onboardingId)}
							>
								{submitting ? 'Menyimpan...' : 'Simpan Evaluasi'}
							</button>
						</div>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
