<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { submitIncident } from '$lib/services/security';
	import { IconArrowLeft, IconAlertTriangle } from '@tabler/icons-svelte';

	let saving = $state(false);
	let panicSaving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	let form = $state({ kategori: 'lainnya', severity: 'low', lokasi: '', kronologi: '' });

	function getGpsPosition(): Promise<GeolocationPosition | null> {
		return new Promise((resolve) => {
			if (!navigator.geolocation) { resolve(null); return; }
			navigator.geolocation.getCurrentPosition((pos) => resolve(pos), () => resolve(null), { enableHighAccuracy: true, timeout: 5000 });
		});
	}

	async function submitForm() {
		errorMsg = ''; successMsg = '';
		if (!form.kronologi.trim()) { errorMsg = 'Isi kronologi kejadian.'; return; }
		saving = true;
		try {
			await submitIncident({
				...form,
				status: 'open',
				is_panic: false,
				reported_by_id: $authStore.karyawanId
			});
			successMsg = 'Insiden dilaporkan.';
			form = { kategori: 'lainnya', severity: 'low', lokasi: '', kronologi: '' };
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal melaporkan insiden.';
		}
		saving = false;
	}

	async function triggerPanic() {
		if (!confirm('Kirim laporan PANIC/DARURAT sekarang? Notifikasi akan langsung dikirim ke supervisor & HRD.')) return;
		errorMsg = ''; successMsg = '';
		panicSaving = true;
		try {
			const pos = await getGpsPosition();
			const lokasi = pos ? `GPS: ${pos.coords.latitude.toFixed(5)}, ${pos.coords.longitude.toFixed(5)}` : 'Lokasi tidak terdeteksi';
			await submitIncident({
				kategori: 'lainnya',
				severity: 'critical',
				lokasi,
				kronologi: 'PANIC — dikirim langsung dari tombol darurat app lapangan.',
				status: 'open',
				is_panic: true,
				reported_by_id: $authStore.karyawanId
			});
			successMsg = 'Panic terkirim! Supervisor & HRD sudah diberitahu.';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal mengirim panic.';
		}
		panicSaving = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/satpam')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Insiden</h1>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		<button
			class="w-full rounded-xl py-5 mb-5 flex flex-col items-center gap-1 text-white disabled:opacity-50"
			style="background: #DC2626"
			disabled={panicSaving}
			onclick={triggerPanic}
		>
			<IconAlertTriangle size={28} />
			<span class="text-[14px] font-bold">{panicSaving ? 'Mengirim…' : 'PANIC / DARURAT'}</span>
			<span class="text-[10px] opacity-90">Tekan untuk kirim notifikasi darurat instan</span>
		</button>

		<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Lapor Insiden (non-darurat)</p>
		<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={form.kategori}>
			<option value="pencurian">Pencurian</option>
			<option value="kebakaran">Kebakaran</option>
			<option value="kerusakan">Kerusakan</option>
			<option value="orang_mencurigakan">Orang Mencurigakan</option>
			<option value="lainnya">Lainnya</option>
		</select>
		<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={form.severity}>
			<option value="low">Low</option>
			<option value="medium">Medium</option>
			<option value="high">High</option>
			<option value="critical">Critical</option>
		</select>
		<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Lokasi" bind:value={form.lokasi} />
		<textarea rows="3" class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Kronologi kejadian" bind:value={form.kronologi}></textarea>

		<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitForm}>
			{saving ? 'Menyimpan…' : 'Lapor Insiden'}
		</button>
	</div>
</div>
