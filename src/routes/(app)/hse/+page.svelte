<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { submitHseIncident, fetchMyHseReports, uploadHseFoto, fetchMitraOptionsForHse, type HseIncident, type MitraOption } from '$lib/services/hse';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { IconArrowLeft, IconAlertTriangle, IconCamera, IconFlask2 } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';

	let saving = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');
	let myReports = $state<HseIncident[]>([]);
	let loadingHistory = $state(true);
	let fotoFile = $state<File | null>(null);
	let melibatkanMitra = $state(false);
	let mitraTerlibatId = $state<number | null>(null);
	let mitraOptions = $state<MitraOption[]>([]);

	const params = page.url.searchParams;
	let form = $state({
		tipe: params.get('prefill_kategori') === 'tumpahan' ? 'insiden' : 'near_miss',
		kategori_bahaya: params.get('prefill_kategori') || 'lainnya',
		lokasi: params.get('prefill_lokasi') || '',
		kronologi: params.get('prefill_kronologi') || '',
		tindakan_segera: ''
	});

	function getGpsPosition(): Promise<GeolocationPosition | null> {
		return new Promise((resolve) => {
			if (!navigator.geolocation) { resolve(null); return; }
			navigator.geolocation.getCurrentPosition((pos) => resolve(pos), () => resolve(null), { enableHighAccuracy: true, timeout: 5000 });
		});
	}

	// Jaring pengaman draf: laporan insiden/near-miss ditulis panjang lalu difoto di
	// TKP. Laporan HSE yang hilang = bahaya yang tidak pernah tercatat, jadi isian
	// dipertahankan lintas reload.
	interface HseDraft {
		form: { tipe: string; kategori_bahaya: string; lokasi: string; kronologi: string; tindakan_segera: string };
		melibatkanMitra: boolean;
		mitraTerlibatId: number | null;
	}
	const HSE_PHOTO_KEY = 'insiden';
	const hsePersist = createFormPersist<HseDraft>('hse_insiden');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function hseSnapshot(): HseDraft {
		return { form, melibatkanMitra, mitraTerlibatId };
	}

	function onFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		fotoFile = input.files?.[0] || null;
		if (fotoFile) hsePersist.savePhoto(HSE_PHOTO_KEY, fotoFile);
	}

	async function onToggleMelibatkanMitra() {
		if (melibatkanMitra && mitraOptions.length === 0) {
			mitraOptions = await fetchMitraOptionsForHse();
		}
		if (!melibatkanMitra) mitraTerlibatId = null;
	}

	async function loadHistory() {
		loadingHistory = true;
		myReports = await fetchMyHseReports($authStore.karyawanId ?? 0);
		loadingHistory = false;
	}

	onMount(async () => {
		await loadHistory();

		const draft = hsePersist.restore();
		if (draft) {
			// Prefill dari query string (mis. datang dari tombol "Lapor Tumpahan") menang
			// atas draf — itu konteks yang baru saja dipilih user.
			form = params.get('prefill_kategori') ? form : draft.form;
			melibatkanMitra = draft.melibatkanMitra;
			mitraTerlibatId = draft.mitraTerlibatId;
			if (melibatkanMitra && mitraOptions.length === 0) {
				mitraOptions = await fetchMitraOptionsForHse();
			}
			const blob = await hsePersist.restorePhoto(HSE_PHOTO_KEY);
			if (blob) fotoFile = new File([blob], 'insiden.jpg', { type: blob.type || 'image/jpeg' });
			draftSavedAt = new Date();
		}
		draftArmed = true;
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void hseSnapshot();
		if (!draftArmed) return;
		hsePersist.save(hseSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(hsePersist, hseSnapshot));

	async function submitForm() {
		errorMsg = ''; successMsg = '';
		if (!form.kronologi.trim()) { errorMsg = 'Isi kronologi kejadian.'; return; }
		saving = true;
		try {
			const pos = await getGpsPosition();
			let fotoId: string | null = null;
			if (fotoFile) {
				const compressed = await compressPhoto(fotoFile);
				fotoId = await uploadHseFoto(compressed, `HSE ${form.tipe} - ${form.lokasi || 'lapangan'}`);
			}

			await submitHseIncident({
				...form,
				gps_lat: pos?.coords.latitude ?? null,
				gps_lng: pos?.coords.longitude ?? null,
				foto: fotoId,
				pelapor_id: $authStore.karyawanId,
				mitra_terlibat_id: melibatkanMitra ? mitraTerlibatId : null
			});
			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			hsePersist.clear();
			await hsePersist.clearPhotos();
			draftSavedAt = null;
			successMsg = 'Laporan HSE terkirim. Terima kasih sudah menjaga keselamatan bersama!';
			form = { tipe: 'near_miss', kategori_bahaya: 'lainnya', lokasi: '', kronologi: '', tindakan_segera: '' };
			fotoFile = null;
			melibatkanMitra = false;
			mitraTerlibatId = null;
			await loadHistory();
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Gagal mengirim laporan HSE.';
		}
		saving = false;
	}

	const TIPE_LABELS: Record<string, string> = {
		near_miss: 'Near-Miss',
		unsafe_condition: 'Kondisi Tidak Aman',
		unsafe_action: 'Tindakan Tidak Aman',
		insiden: 'Insiden/Kecelakaan'
	};
	const STATUS_LABELS: Record<string, string> = {
		baru: 'Baru',
		triase: 'Ditriase',
		investigasi: 'Investigasi',
		capa: 'CAPA Berjalan',
		closed: 'Selesai'
	};
</script>

<div class="scroll-body">
	<div class="w-full p-4 pb-24">
		<div class="flex items-center gap-2 mb-4">
			<button class="w-8 h-8 rounded-lg flex items-center justify-center" style="background: var(--sys-fill)" onclick={() => goto('/')}>
				<IconArrowLeft size={16} />
			</button>
			<h1 class="text-[16px] font-bold flex-1" style="color: var(--sys-label)">⛑️ HSE — Lapor Cepat</h1>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!fotoFile} />
			<button
				class="flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11px] font-semibold"
				style="background: var(--sys-fill); color: var(--sys-label)"
				onclick={() => goto('/hse/b3')}
			>
				<IconFlask2 size={14} />
				Cek MSDS
			</button>
		</div>

		<div class="grid grid-cols-2 gap-2 mb-2">
			<button class="rounded-lg py-2 text-[11px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => goto('/hse/apd')}>
				🦺 APD Saya
			</button>
			<button class="rounded-lg py-2 text-[11px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => goto('/hse/inspeksi')}>
				📋 Inspeksi
			</button>
		</div>
		<div class="grid grid-cols-2 gap-2 mb-2">
			<button class="rounded-lg py-2 text-[11px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => goto('/hse/izin-kerja')}>
				📝 Izin Kerja
			</button>
			<button class="rounded-lg py-2 text-[11px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => goto('/hse/training-mcu')}>
				🎓 Training/MCU
			</button>
		</div>
		<div class="grid grid-cols-1 gap-2 mb-4">
			<button class="rounded-lg py-2 text-[11px] font-semibold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => goto('/hse/soc')}>
				👀 Kartu Observasi Keselamatan (SOC)
			</button>
		</div>

		{#if errorMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--rel); color: var(--red)">{errorMsg}</div>{/if}
		{#if successMsg}<div class="rounded-lg p-3 mb-3 text-[12px]" style="background: var(--gg); color: var(--ggd)">{successMsg}</div>{/if}

		<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Lapor Near-Miss / Kondisi Tidak Aman / Insiden</p>

		<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={form.tipe}>
			<option value="near_miss">Near-Miss</option>
			<option value="unsafe_condition">Kondisi Tidak Aman</option>
			<option value="unsafe_action">Tindakan Tidak Aman</option>
			<option value="insiden">Insiden/Kecelakaan</option>
		</select>

		<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={form.kategori_bahaya}>
			<option value="kebakaran">Kebakaran/Ledakan</option>
			<option value="paparan_kimia">Paparan Kimia</option>
			<option value="tumpahan">Tumpahan (Spill)</option>
			<option value="jatuh">Terjatuh/Terpeleset</option>
			<option value="tertimpa">Tertimpa/Terbentur</option>
			<option value="listrik">Listrik</option>
			<option value="lainnya">Lainnya</option>
		</select>

		<input class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Lokasi (mis. Area Mixing)" bind:value={form.lokasi} />

		<textarea rows="3" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Kronologi kejadian" bind:value={form.kronologi}></textarea>

		<textarea rows="2" class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" placeholder="Tindakan segera yang sudah diambil (opsional)" bind:value={form.tindakan_segera}></textarea>

		<label class="flex items-center gap-2 text-[12px] mb-2" style="color: var(--sys-label)">
			<input type="checkbox" bind:checked={melibatkanMitra} onchange={onToggleMelibatkanMitra} />
			Melibatkan pekerja mitra (subkon/mandor)
		</label>
		{#if melibatkanMitra}
			<select class="w-full rounded-lg px-3 py-2 text-[13px] mb-2" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" bind:value={mitraTerlibatId}>
				<option value={null}>-- Pilih mitra --</option>
				{#each mitraOptions as m (m.id)}
					<option value={m.id}>{m.nama}</option>
				{/each}
			</select>
		{/if}

		<label class="flex items-center gap-2 text-[12px] mb-3" style="color: var(--sys-label)">
			<IconCamera size={16} />
			<input type="file" accept="image/*" capture="environment" onchange={onFotoChange} class="text-[12px]" />
		</label>

		<button class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white disabled:opacity-50 flex items-center justify-center gap-2" style="background: #DC2626" disabled={saving} onclick={submitForm}>
			<IconAlertTriangle size={16} />
			{saving ? 'Mengirim…' : 'Kirim Laporan'}
		</button>

		<div class="mt-6">
			<p class="text-[12px] font-semibold mb-2" style="color: var(--sys-label)">Riwayat Laporan Saya</p>
			{#if loadingHistory}
				<CircularProgressGauge size={44} strokeWidth={3} label="Memuat riwayat laporan..." />
			{:else if myReports.length === 0}
				<p class="text-[12px]" style="color: var(--sys-label-2)">Belum ada laporan.</p>
			{:else}
				<div class="space-y-2">
					{#each myReports as r (r.id)}
						<div class="rounded-lg p-3" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
							<div class="flex items-center justify-between mb-1">
								<span class="text-[11px] font-semibold" style="color: var(--sys-label)">{TIPE_LABELS[r.tipe] || r.tipe}</span>
								<span class="text-[10px] px-2 py-0.5 rounded-full" style="background: var(--rel); color: var(--sys-label-2)">{STATUS_LABELS[r.status] || r.status}</span>
							</div>
							<p class="text-[12px]" style="color: var(--sys-label)">{r.kronologi}</p>
							<p class="text-[10px] mt-1" style="color: var(--sys-label-2)">{r.lokasi || '-'} · {new Date(r.date_created).toLocaleDateString('id-ID')}</p>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>
</div>
