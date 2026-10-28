<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { submitPermit, fetchMyPermits, type HsePermit } from '$lib/services/hse';
	import { IconArrowLeft } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import FormDraftBar from '$lib/components/shared/FormDraftBar.svelte';

	let myPermits = $state<HsePermit[]>([]);
	let loadingHistory = $state(true);
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	let form = $state({
		tipe: 'panas',
		lokasi: '',
		deskripsi_pekerjaan: '',
		tanggal_mulai: '',
		tanggal_selesai: '',
		apd_wajib: '',
		gas_test_required: false
	});

	// Draf Otomatis (Fase 5 Lapis 2): field tergabung dalam objek `form` tanpa name/id DOM
	// individual, tidak tertangkap Lapis 1. Form pengajuan tunggal (bukan per-record) -> key statis.
	interface IzinKerjaDraft { form: typeof form }
	const persist = createFormPersist<IzinKerjaDraft>('hse_izin_kerja');
	let draftRestoreInfo = $state<{ savedAt: number | null; apply: () => void; discard: () => void } | null>(null);
	let draftArmed = $state(false);

	function applyDraft(draft: IzinKerjaDraft) {
		if (draft.form) form = { ...form, ...draft.form };
	}

	function checkDraft() {
		const draft = persist.restore();
		if (!draft) return;
		draftRestoreInfo = {
			savedAt: persist.savedAt(),
			apply: () => applyDraft(draft),
			discard: () => persist.clear()
		};
	}

	$effect(() => {
		void form;
		if (!draftArmed) return;
		persist.save({ form });
	});

	onDestroy(registerFormPersistSaveTriggers(persist, () => ({ form })));

	const TIPE_LABELS: Record<string, string> = {
		panas: 'Pekerjaan Panas (Hot Work)',
		ruang_terbatas: 'Ruang Terbatas',
		ketinggian: 'Bekerja di Ketinggian',
		listrik: 'Kelistrikan',
		galian: 'Penggalian'
	};
	const STATUS_LABELS: Record<string, string> = {
		diajukan: 'Menunggu Persetujuan',
		disetujui: 'Disetujui',
		ditolak: 'Ditolak',
		selesai: 'Selesai',
		kedaluwarsa: 'Kedaluwarsa'
	};

	async function loadHistory() {
		loadingHistory = true;
		myPermits = await fetchMyPermits($authStore.karyawanId ?? 0);
		loadingHistory = false;
	}

	onMount(() => {
		checkDraft();
		draftArmed = true;
		loadHistory();
	});

	async function submitForm() {
		errorMsg = ''; successMsg = '';
		if (!form.lokasi.trim() || !form.tanggal_mulai || !form.tanggal_selesai) {
			errorMsg = 'Lokasi dan masa berlaku wajib diisi.';
			return;
		}
		saving = true;
		try {
			await submitPermit({ ...form, pemohon_id: $authStore.karyawanId ?? 0 });
			successMsg = 'Izin kerja diajukan, menunggu persetujuan.';
			persist.clear();
			draftRestoreInfo = null;
			form = { tipe: 'panas', lokasi: '', deskripsi_pekerjaan: '', tanggal_mulai: '', tanggal_selesai: '', apd_wajib: '', gas_test_required: false };
			await loadHistory();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal mengajukan izin kerja.';
		}
		saving = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/hse')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">📝 Izin Kerja (PTW)</h1>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		<FormDraftBar
			restoreInfo={draftRestoreInfo}
			onApplied={() => (draftRestoreInfo = null)}
		/>

		<select bind:value={form.tipe} class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
			{#each Object.entries(TIPE_LABELS) as [val, label]}
				<option value={val}>{label}</option>
			{/each}
		</select>
		<input bind:value={form.lokasi} placeholder="Lokasi pekerjaan" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
		<textarea rows="2" bind:value={form.deskripsi_pekerjaan} placeholder="Deskripsi pekerjaan" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"></textarea>

		<div class="grid grid-cols-2 gap-2 mb-2">
			<div>
				<p class="text-[10px] mb-1" style="color: var(--sys-label-2)">Mulai Berlaku</p>
				<input type="datetime-local" bind:value={form.tanggal_mulai} class="w-full rounded-lg px-2 py-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
			</div>
			<div>
				<p class="text-[10px] mb-1" style="color: var(--sys-label-2)">Selesai Berlaku</p>
				<input type="datetime-local" bind:value={form.tanggal_selesai} class="w-full rounded-lg px-2 py-2 text-[12px]" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" />
			</div>
		</div>

		<textarea rows="2" bind:value={form.apd_wajib} placeholder="APD wajib dipakai (opsional)" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"></textarea>

		<label class="flex items-center gap-2 text-[12px] mb-3" style="color: var(--sys-label)">
			<input type="checkbox" bind:checked={form.gas_test_required} />
			Wajib Gas Test
		</label>

		<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50" style="background: var(--g)" disabled={saving} onclick={submitForm}>
			{saving ? 'Mengajukan…' : 'Ajukan Izin Kerja'}
		</button>

		<div class="mt-6">
			<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Riwayat Izin Kerja Saya</p>
			{#if loadingHistory}
				<CircularProgressGauge size={44} strokeWidth={3} label="Memuat riwayat izin kerja..." />
			{:else if myPermits.length === 0}
				<p class="text-[12px]" style="color: var(--sys-label-2)">Belum ada pengajuan.</p>
			{:else}
				<div class="space-y-2">
					{#each myPermits as p (p.id)}
						<div class="rounded-lg p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="flex items-center justify-between mb-1">
								<span class="text-[11px] font-semibold" style="color: var(--sys-label)">{TIPE_LABELS[p.tipe] || p.tipe}</span>
								<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--rel); color: var(--sys-label-2)">{STATUS_LABELS[p.status] || p.status}</span>
							</div>
							<p class="text-[12px]" style="color: var(--sys-label)">{p.lokasi}</p>
							{#if p.catatan_approval}
								<p class="text-[11px] mt-1" style="color: var(--sys-label-2)">Catatan: {p.catatan_approval}</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
