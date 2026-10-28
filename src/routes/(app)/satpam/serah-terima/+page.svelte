<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { submitShiftHandover, searchKaryawan } from '$lib/services/security';
	import { IconArrowLeft, IconLoader2 } from '@tabler/icons-svelte';

	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	let form = $state({
		shift: 'pagi' as 'pagi' | 'siang' | 'malam',
		tanggal: new Date().toISOString().split('T')[0],
		catatan: ''
	});

	let masukQuery = $state('');
	let masukResults = $state<any[]>([]);
	let selectedMasuk = $state<{ id: number; label: string } | null>(null);

	let searchTimer: ReturnType<typeof setTimeout>;
	function onMasukQueryInput() {
		selectedMasuk = null;
		clearTimeout(searchTimer);
		searchTimer = setTimeout(async () => {
			if (!masukQuery.trim()) { masukResults = []; return; }
			const results = await searchKaryawan(masukQuery);
			masukResults = results.map((r) => ({ id: r.id, label: r.nama_karyawan }));
		}, 300);
	}

	function pickMasuk(p: { id: number; label: string }) {
		selectedMasuk = p;
		masukQuery = p.label;
		masukResults = [];
	}

	// G_SEC7 (mode soft): alasan tetap menyerahkan walau belum lengkap, diminta setelah server menjawab 422.
	let gateSec7Reason = '';

	async function submitForm() {
		errorMsg = ''; successMsg = '';
		const karyawanId = $authStore.karyawanId;
		if (!karyawanId) { errorMsg = 'Profil karyawan tidak ditemukan di sesi login.'; return; }
		if (!selectedMasuk) { errorMsg = 'Pilih satpam yang masuk-shift dari hasil pencarian.'; return; }

		saving = true;
		try {
			await submitShiftHandover({
				shift: form.shift,
				tanggal: form.tanggal,
				catatan: form.catatan,
				satpam_masuk_id: selectedMasuk.id,
				gate_sec7_reason: gateSec7Reason.trim() || undefined
			});
			successMsg = 'Serah-terima shift tercatat. Menunggu konfirmasi satpam masuk-shift.';
			form.catatan = '';
			selectedMasuk = null;
			masukQuery = '';
			gateSec7Reason = '';
		} catch (err) {
			if (err instanceof Error && (err as any).isGateSec7) {
				const alasan = window.prompt(`${err.message}\n\nAlasan tetap menyerahkan (min. 5 karakter):`, '');
				if (alasan && alasan.trim().length >= 5) {
					gateSec7Reason = alasan.trim();
					saving = false;
					await submitForm();
					return;
				}
				errorMsg = err.message;
			} else {
				errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan serah-terima.';
			}
		}
		saving = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/satpam')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Serah-Terima Shift</h1>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" type="date" bind:value={form.tanggal} />
		<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={form.shift}>
			<option value="pagi">Pagi</option>
			<option value="siang">Siang</option>
			<option value="malam">Malam</option>
		</select>

		<label class="text-[11px] font-semibold mb-1 block" style="color: var(--sys-label)">Satpam Masuk-Shift (penerima)</label>
		<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-1" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Cari nama…" bind:value={masukQuery} oninput={onMasukQueryInput} />
		{#if masukResults.length > 0}
			<div class="rounded-lg mb-2 overflow-hidden" style="border: 1px solid var(--sys-sep)">
				{#each masukResults as r}
					<button class="w-full text-left px-3 py-2 text-[12px]" style="background: white" onclick={() => pickMasuk(r)}>{r.label}</button>
				{/each}
			</div>
		{/if}

		<textarea rows="4" class="w-full rounded-lg px-3 py-2 text-[13px] mb-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Catatan: kondisi, barang belum kembali, tamu masih di dalam, dsb" bind:value={form.catatan}></textarea>
		<p class="text-[11px] mb-3 -mt-2" style="color: var(--sys-label-secondary, #666)">Tulis kondisi pos, barang yang belum kembali, dan tamu yang masih di dalam. Catatan terlalu singkat atau belum ada ronda tercatat akan meminta alasan sebelum serah-terima dikirim.</p>

		<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitForm}>
			{#if saving}<IconLoader2 size={16} class="animate-spin inline mr-1" />{/if}
			{saving ? 'Menyimpan…' : 'Serah-Terima'}
		</button>
	</div>
</div>
