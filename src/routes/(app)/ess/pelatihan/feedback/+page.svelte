<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getMyTrainingFeedback, submitTrainingFeedback, type TrainingFeedbackRecord } from '$lib/services/ess/trainingFeedback';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconMessageCircle } from '@tabler/icons-svelte';

	let loading = $state(true);
	let errorMsg = $state('');
	let rows = $state<TrainingFeedbackRecord[]>([]);

	let openId = $state<number | null>(null);
	let penerapanSkor = $state(3);
	let manfaatSkor = $state(3);
	let hambatan = $state('');
	let catatan = $state('');
	let submitting = $state(false);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'access_ess', roles)) {
			goto('/');
		}
	});

	async function load() {
		loading = true;
		try {
			rows = await getMyTrainingFeedback();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat survei.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	function openForm(row: TrainingFeedbackRecord) {
		openId = row.id;
		penerapanSkor = 3;
		manfaatSkor = 3;
		hambatan = '';
		catatan = '';
	}

	async function handleSubmit(id: number) {
		submitting = true;
		errorMsg = '';
		try {
			await submitTrainingFeedback({ id, penerapan_skor: penerapanSkor, manfaat_skor: manfaatSkor, hambatan: hambatan.trim() || undefined, catatan: catatan.trim() || undefined });
			openId = null;
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim survei.';
		} finally {
			submitting = false;
		}
	}

	const SKOR_LABEL: Record<number, string> = { 1: 'Sangat jarang', 2: 'Jarang', 3: 'Kadang-kadang', 4: 'Sering', 5: 'Selalu' };
	const MANFAAT_LABEL: Record<number, string> = { 1: 'Tidak bermanfaat', 2: 'Kurang bermanfaat', 3: 'Cukup bermanfaat', 4: 'Bermanfaat', 5: 'Sangat bermanfaat' };
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess/pelatihan')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Feedback Training</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Survei singkat ~2 bulan pasca training selesai — bantu kami tahu efektivitasnya di lapangan.</p>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat umpan balik pelatihan..." />
		</div>
	{:else if errorMsg && rows.length === 0}
		<div class="text-center py-16 text-[13px]" style="color: #DC2626">{errorMsg}</div>
	{:else if rows.length === 0}
		<div class="text-center py-16">
			<IconMessageCircle size={32} style="color: var(--sys-label4); margin: 0 auto" />
			<p class="text-[13px] mt-3" style="color: var(--sys-label3)">Belum ada survei feedback untuk Anda.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each rows as r (r.id)}
				<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep); background: var(--sys-bg-secondary, #fff)">
					<div class="flex items-start justify-between gap-2">
						<div>
							<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{r.program_judul}</p>
							{#if r.status === 'diisi'}
								<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Diisi pada {r.tanggal_isi ? new Date(r.tanggal_isi).toLocaleDateString('id-ID') : '-'} — Penerapan: {SKOR_LABEL[r.penerapan_skor || 3]}, Manfaat: {MANFAAT_LABEL[r.manfaat_skor || 3]}</p>
							{:else}
								<p class="text-[11px] mt-1" style="color: var(--sys-label3)">Menunggu diisi</p>
							{/if}
						</div>
						{#if r.status === 'pending'}
							<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style="background: var(--aml); color: var(--amd)">Baru</span>
						{:else}
							<IconCircleCheck size={18} style="color: #16A34A" class="shrink-0" />
						{/if}
					</div>

					{#if r.status === 'pending'}
						{#if openId === r.id}
							<div class="mt-3 pt-3 border-t space-y-3" style="border-color: var(--sys-sep)">
								<div>
									<p class="text-[11px] font-semibold mb-1.5" style="color: var(--sys-label)">Seberapa sering Anda menerapkan hasil training ini di lapangan?</p>
									<div class="grid grid-cols-5 gap-1">
										{#each [1, 2, 3, 4, 5] as n}
											<button
												class="h-9 rounded-lg text-[10px] font-bold"
												style={penerapanSkor === n ? 'background: var(--p, #1F6592); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
												onclick={() => (penerapanSkor = n)}
											>{n}</button>
										{/each}
									</div>
									<p class="text-[10px] mt-1" style="color: var(--sys-label4)">{SKOR_LABEL[penerapanSkor]}</p>
								</div>
								<div>
									<p class="text-[11px] font-semibold mb-1.5" style="color: var(--sys-label)">Seberapa bermanfaat training ini untuk pekerjaan Anda?</p>
									<div class="grid grid-cols-5 gap-1">
										{#each [1, 2, 3, 4, 5] as n}
											<button
												class="h-9 rounded-lg text-[10px] font-bold"
												style={manfaatSkor === n ? 'background: var(--p, #1F6592); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
												onclick={() => (manfaatSkor = n)}
											>{n}</button>
										{/each}
									</div>
									<p class="text-[10px] mt-1" style="color: var(--sys-label4)">{MANFAAT_LABEL[manfaatSkor]}</p>
								</div>
								<div>
									<label class="text-[11px] font-semibold block mb-1" style="color: var(--sys-label)" for="hambatan-{r.id}">Kendala menerapkan (opsional)</label>
									<textarea id="hambatan-{r.id}" rows="2" class="w-full rounded-lg border text-[12px] p-2.5" style="border-color: var(--sys-sep)" bind:value={hambatan}></textarea>
								</div>
								{#if errorMsg}
									<p class="text-[11px]" style="color: #DC2626">{errorMsg}</p>
								{/if}
								<div class="flex gap-2">
									<button class="flex-1 h-10 rounded-lg text-[12px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label2)" onclick={() => (openId = null)}>Batal</button>
									<button class="flex-1 h-10 rounded-lg text-[12px] font-bold text-white disabled:opacity-50" style="background: var(--p, #1F6592)" disabled={submitting} onclick={() => handleSubmit(r.id)}>
										{submitting ? 'Mengirim...' : 'Kirim'}
									</button>
								</div>
							</div>
						{:else}
							<button class="mt-3 w-full h-9 rounded-lg text-[12px] font-bold text-white" style="background: var(--p, #1F6592)" onclick={() => openForm(r)}>
								Isi Sekarang
							</button>
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
