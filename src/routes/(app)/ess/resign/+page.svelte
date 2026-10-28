<script lang="ts">
	import { goto } from '$app/navigation';
	import { submitResign } from '$lib/services/ess/offboarding';
	import { IconArrowLeft, IconAlertTriangle, IconSend } from '@tabler/icons-svelte';

	let alasan = $state('');
	let tanggalEfektif = $state('');
	let submitting = $state(false);
	let errorMsg = $state('');
	let done = $state(false);

	function minTanggalEfektif() {
		const d = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
		return d.toISOString().slice(0, 10);
	}

	async function handleSubmit() {
		errorMsg = '';
		if (alasan.trim().length < 10) {
			errorMsg = 'Alasan wajib diisi minimal 10 karakter.';
			return;
		}
		if (!tanggalEfektif) {
			errorMsg = 'Tanggal efektif wajib diisi.';
			return;
		}
		if (!confirm('Ajukan pengajuan resign? Proses clearance akan langsung dimulai setelah ini.')) return;

		submitting = true;
		try {
			const result = await submitResign(alasan.trim(), tanggalEfektif);
			if (result.skipped === 'already_active_case') {
				errorMsg = 'Anda sudah memiliki proses offboarding yang sedang berjalan. Cek di menu Offboarding Saya.';
				return;
			}
			done = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengajukan resign.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	<h1 class="text-[16px] font-bold mb-1" style="color: var(--sys-label)">Pengajuan Resign</h1>
	<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Mengajukan pengunduran diri akan langsung memulai proses clearance</p>

	{#if done}
		<div class="glass-panel rounded-2xl p-6 text-center">
			<p class="text-[13px] font-bold mb-1" style="color: #16A34A">Pengajuan Terkirim</p>
			<p class="text-[11px] mb-4" style="color: var(--sys-label3)">
				HRD sudah diberi tahu. Proses clearance sudah dimulai — cek statusnya di menu Offboarding Saya.
			</p>
			<button class="px-5 py-2.5 rounded-xl text-[12px] font-bold text-white gradient-bg" onclick={() => goto('/ess/offboarding')}>
				Lihat Status Offboarding
			</button>
		</div>
	{:else}
		<div class="glass-panel rounded-2xl p-5 flex flex-col gap-3">
			<div>
				<label for="alasan" class="text-[11px] font-semibold block mb-1" style="color: var(--sys-label)">Alasan Resign</label>
				<textarea
					id="alasan"
					bind:value={alasan}
					placeholder="Jelaskan alasan Anda mengundurkan diri..."
					class="w-full text-[12px] p-3 rounded-xl border border-gray-200 resize-none"
					rows="4"
				></textarea>
			</div>
			<div>
				<label for="tgl-efektif" class="text-[11px] font-semibold block mb-1" style="color: var(--sys-label)">Tanggal Efektif (Hari Kerja Terakhir)</label>
				<input id="tgl-efektif" type="date" bind:value={tanggalEfektif} min={minTanggalEfektif()} class="w-full text-[12px] p-3 rounded-xl border border-gray-200" />
				<p class="text-[10px] mt-1" style="color: var(--sys-label4)">Disarankan minimal 14 hari dari sekarang sesuai kebijakan notice period.</p>
			</div>

			{#if errorMsg}
				<div class="rounded-lg p-3" style="background: var(--rel)">
					<p class="text-[11px] flex items-center gap-1.5" style="color: #DC2626"><IconAlertTriangle size={13} /> {errorMsg}</p>
				</div>
			{/if}

			<button
				class="mt-1 px-5 py-3 rounded-xl text-[13px] font-bold text-white gradient-bg flex items-center justify-center gap-2 disabled:opacity-50"
				disabled={submitting}
				onclick={handleSubmit}
			>
				<IconSend size={16} /> {submitting ? 'Mengirim...' : 'Ajukan Resign'}
			</button>
		</div>
	{/if}
</div>
