<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { fetchMyTrainingStatus, fetchMyMcuStatus, type HseTrainingRecord, type HseMcuStatus } from '$lib/services/hse';
	import { IconArrowLeft } from '@tabler/icons-svelte';

	let training = $state<HseTrainingRecord[]>([]);
	let mcu = $state<HseMcuStatus[]>([]);
	let loading = $state(true);

	async function load() {
		loading = true;
		const karyawanId = $authStore.karyawanId ?? 0;
		[training, mcu] = await Promise.all([fetchMyTrainingStatus(karyawanId), fetchMyMcuStatus(karyawanId)]);
		loading = false;
	}

	onMount(load);

	const HASIL_LABELS: Record<string, string> = { fit: 'Fit', fit_dengan_catatan: 'Fit dengan Catatan', unfit: 'Unfit' };

	function daysUntil(dateStr: string | null): number | null {
		if (!dateStr) return null;
		const d = new Date(dateStr);
		if (Number.isNaN(d.getTime())) return null;
		return Math.ceil((d.getTime() - Date.now()) / 86400000);
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/hse')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">🎓 Training K3 &amp; MCU Saya</h1>
		</div>

		{#if loading}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat sertifikat training K3..." />
		{:else}
			<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Sertifikat Training K3</p>
			{#if training.length === 0}
				<p class="text-[12px] mb-4" style="color: var(--sys-label-2)">Belum ada rekam training.</p>
			{:else}
				<div class="space-y-2 mb-4">
					{#each training as t (t.id)}
						{@const sisa = daysUntil(t.tanggal_kedaluwarsa)}
						<div class="rounded-lg p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="flex items-center justify-between mb-1">
								<span class="text-[12px] font-semibold" style="color: var(--sys-label)">{t.matrix_id?.nama_training}</span>
								<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--rel); color: var(--sys-label-2)">{t.status}</span>
							</div>
							<p class="text-[11px]" style="color: var(--sys-label-2)">
								Selesai: {t.tanggal_selesai || '-'} · Kedaluwarsa: {t.tanggal_kedaluwarsa || '-'}
							</p>
							{#if sisa !== null && sisa <= 30}
								<p class="text-[11px] mt-1 font-semibold" style="color: {sisa < 0 ? 'var(--red)' : '#B45309'}">
									{sisa < 0 ? `Sudah kedaluwarsa ${-sisa} hari lalu` : `Sisa ${sisa} hari sebelum kedaluwarsa`}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}

			<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Status Medical Check-Up</p>
			{#if mcu.length === 0}
				<p class="text-[12px]" style="color: var(--sys-label-2)">Belum ada data MCU.</p>
			{:else}
				<div class="space-y-2">
					{#each mcu as m (m.id)}
						<div class="rounded-lg p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="flex items-center justify-between mb-1">
								<span class="text-[12px] font-semibold" style="color: var(--sys-label)">{m.tipe}</span>
								<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--rel); color: var(--sys-label-2)">{HASIL_LABELS[m.hasil] || m.hasil}</span>
							</div>
							<p class="text-[11px]" style="color: var(--sys-label-2)">
								{m.tanggal} · Jatuh tempo berikutnya: {m.tanggal_jatuh_tempo_berikutnya || '-'}
							</p>
						</div>
					{/each}
				</div>
				<p class="text-[10px] mt-2" style="color: var(--sys-label-2)">
					Detail hasil pemeriksaan bersifat rahasia — hubungi HSE/dokter perusahaan untuk informasi lengkap.
				</p>
			{/if}
		{/if}
	</div>
</div>
