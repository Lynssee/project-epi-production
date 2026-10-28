<!-- Modul Kemitraan v2.0 Bab 07.3 — Evaluasi Cepat Mingguan. Lima kriteria berupa
     bintang 1-5, wajib minimal satu foto, target pengisian <60 detik. -->
<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { fetchMitraOptions, uploadEvaluasiFoto, submitEvaluasiCepat, type MitraOption } from '$lib/services/kemitraan';
	import { IconArrowLeft, IconStar, IconStarFilled, IconCamera, IconCheck } from '@tabler/icons-svelte';
	import { onMount } from 'svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let mitraOptions = $state<MitraOption[]>([]);
	let loadingMitra = $state(true);
	let mitraId = $state<number | null>(null);
	let fotoFile = $state<File | null>(null);
	let catatan = $state('');
	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	const KRITERIA = [
		{ key: 'skorKualitas', label: 'Kualitas Pekerjaan' },
		{ key: 'skorWaktu', label: 'Ketepatan Waktu' },
		{ key: 'skorK3', label: 'Kepatuhan K3' },
		{ key: 'skorBiaya', label: 'Efisiensi Biaya' },
		{ key: 'skorKomunikasi', label: 'Komunikasi' }
	] as const;

	let skor = $state<Record<string, number>>({
		skorKualitas: 0,
		skorWaktu: 0,
		skorK3: 0,
		skorBiaya: 0,
		skorKomunikasi: 0
	});

	$effect(() => {
		fetchMitraOptions().then((r) => {
			mitraOptions = r;
			loadingMitra = false;
			const paramId = $page.url.searchParams.get('mitra_id');
			if (paramId && !mitraId) {
				const numericId = Number(paramId);
				if (numericId && r.some((m) => m.id === numericId)) {
					mitraId = numericId;
				}
			}
		});
	});

	// Jaring pengaman draf: foto WAJIB di sini, jadi kamera native pasti dibuka setelah
	// lima bintang diisi. Target pengisian form ini <60 detik — kehilangan isian karena
	// tab dibunuh OS justru paling terasa di form secepat ini.
	interface EvaluasiDraft {
		mitraId: number | null;
		skor: Record<string, number>;
		catatan: string;
	}
	const EVALUASI_PHOTO_KEY = 'bukti';
	const evaluasiPersist = createFormPersist<EvaluasiDraft>('kemitraan_evaluasi');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function evaluasiSnapshot(): EvaluasiDraft {
		return { mitraId, skor, catatan };
	}

	onMount(async () => {
		const draft = evaluasiPersist.restore();
		if (draft) {
			mitraId = draft.mitraId;
			skor = draft.skor;
			catatan = draft.catatan;
			const blob = await evaluasiPersist.restorePhoto(EVALUASI_PHOTO_KEY);
			if (blob) fotoFile = new File([blob], 'bukti.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		} else {
			const paramId = $page.url.searchParams.get('mitra_id');
			if (paramId) {
				const numericId = Number(paramId);
				if (numericId) mitraId = numericId;
			}
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void evaluasiSnapshot();
		if (!draftArmed) return;
		evaluasiPersist.save(evaluasiSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(evaluasiPersist, evaluasiSnapshot));

	function setStar(key: string, value: number) {
		skor[key] = value;
	}

	function onFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		fotoFile = input.files?.[0] || null;
		if (fotoFile) evaluasiPersist.savePhoto(EVALUASI_PHOTO_KEY, fotoFile);
	}

	async function submit() {
		errorMsg = ''; successMsg = '';
		if (!mitraId) { errorMsg = 'Pilih mitra terlebih dahulu.'; return; }
		if (Object.values(skor).some((v) => v === 0)) { errorMsg = 'Isi semua kriteria (minimal 1 bintang).'; return; }
		if (!fotoFile) { errorMsg = 'Foto bukti wajib diunggah.'; return; }

		saving = true;
		try {
			const compressedFoto = await compressPhoto(fotoFile);
			const fotoId = await uploadEvaluasiFoto(compressedFoto, `Evaluasi mitra #${mitraId}`);
			if (!fotoId) { errorMsg = 'Gagal mengunggah foto.'; saving = false; return; }

			await submitEvaluasiCepat({
				mitraId,
				skorKualitas: skor.skorKualitas,
				skorWaktu: skor.skorWaktu,
				skorK3: skor.skorK3,
				skorBiaya: skor.skorBiaya,
				skorKomunikasi: skor.skorKomunikasi,
				fotoBuktiId: fotoId,
				evaluator: $authStore.karyawanName || '-',
				catatan
			});

			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			evaluasiPersist.clear();
			await evaluasiPersist.clearPhotos();
			draftSavedAt = null;
			successMsg = 'Evaluasi tersimpan. Terima kasih!';
			mitraId = null;
			skor = { skorKualitas: 0, skorWaktu: 0, skorK3: 0, skorBiaya: 0, skorKomunikasi: 0 };
			fotoFile = null;
			catatan = '';
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal menyimpan evaluasi.';
		}
		saving = false;
	}
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/kemitraan')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold flex-1" style="color: var(--sys-label)">⭐ Evaluasi Cepat Mitra</h1>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!fotoFile} />
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		<label class="block text-[12px] font-semibold mb-1" style="color: var(--sys-label)">Mitra</label>
		<select
			class="w-full rounded-lg px-3 py-2 text-[13px] mb-3"
			style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
			bind:value={mitraId}
			disabled={loadingMitra}
		>
			<option value={null}>{loadingMitra ? 'Memuat...' : '-- Pilih mitra --'}</option>
			{#each mitraOptions as m (m.id)}
				<option value={m.id}>{m.nama}</option>
			{/each}
		</select>

		{#each KRITERIA as k (k.key)}
			<div class="mb-3">
				<p class="text-[12px] font-semibold mb-1" style="color: var(--sys-label)">{k.label}</p>
				<div class="flex gap-1">
					{#each [1, 2, 3, 4, 5] as star}
						<button type="button" onclick={() => setStar(k.key, star)} aria-label="{star} bintang">
							{#if skor[k.key] >= star}
								<IconStarFilled size={26} style="color: #F59E0B" />
							{:else}
								<IconStar size={26} style="color: var(--sys-label3)" />
							{/if}
						</button>
					{/each}
				</div>
			</div>
		{/each}

		<label class="flex items-center gap-2 text-[12px] mb-3" style="color: var(--sys-label)">
			<IconCamera size={16} />
			<input type="file" accept="image/*" capture="environment" onchange={onFotoChange} class="text-[12px]" />
			<span style="color: var(--red)">*wajib</span>
		</label>

		<textarea
			rows="2"
			class="w-full rounded-lg px-3 py-2 text-[13px] mb-3"
			style="background: var(--sys-fill); border: 1px solid var(--sys-sep)"
			placeholder="Catatan (opsional)"
			bind:value={catatan}
		></textarea>

		<button
			class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2"
			style="background: var(--p)"
			disabled={saving}
			onclick={submit}
		>
			<IconCheck size={16} />
			{saving ? 'Menyimpan…' : 'Simpan Evaluasi'}
		</button>
	</div>
</div>
