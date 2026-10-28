<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// ESS HRD v3 Fase 2 — pengajuan izin per-jam (Dinas/Pribadi/Cuti Jam-Jaman/Darurat).
	// Foto+liveness opsional (reuse LivenessCamera Fase 1, context='izin' di server) —
	// tidak wajib karena bukan clock-in/out, hanya sinyal tambahan utk review HRD.

	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { auth } from '$lib/firebase';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconX } from '@tabler/icons-svelte';
	import LivenessCamera from '$lib/components/ess/LivenessCamera.svelte';
	import { fetchDelegasiKandidat, type DelegasiKandidat } from '$lib/services/ess/cuti';

	interface Kategori {
		id: number;
		kode: string;
		nama: string;
		keterangan: string | null;
		maks_durasi_jam: number | null;
		kuota_jam_per_bulan: number | null;
		berbayar: boolean;
	}

	let kategoriList = $state<Kategori[]>([]);
	let loadingKategori = $state(true);
	let kategoriId = $state<number | null>(null);
	let alasan = $state('');
	let estimasiDurasiJam = $state<number | null>(null);

	let photoFile = $state<File | null>(null);
	let livenessPassed = $state(false);
	let photoPreview = $state<string | null>(null);

	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	let delegasiKaryawanId = $state('');
	let delegasiCatatan = $state('');
	let rekanKerja = $state<DelegasiKandidat[]>([]);

	let selectedKategori = $derived(kategoriList.find((k) => k.id === kategoriId) || null);

	async function getIdToken(): Promise<string> {
		const user = auth.currentUser;
		if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
		return user.getIdToken();
	}

	onMount(async () => {
		try {
			const idToken = await getIdToken();
			const res = await fetch('/api/ess/izin-jam/kategori', { headers: { Authorization: `Bearer ${idToken}` } });
			if (res.ok) {
				const data = await res.json();
				kategoriList = data.data || [];
			}
		} finally {
			loadingKategori = false;
		}
		try {
			rekanKerja = await fetchDelegasiKandidat();
		} catch (e) {
			console.error('Gagal memuat daftar rekan kerja:', e);
		}
	});

	function handleCapture(file: File, passed: boolean) {
		photoFile = file;
		livenessPassed = passed;
		photoPreview = null;
	}

	// H-16 fix: HTML max attribute bisa di-bypass — validasi durasi terhadap maks_durasi_jam kategori di canSubmit juga.
	let canSubmit = $derived(
		!!kategoriId && !!alasan.trim() && !!estimasiDurasiJam && estimasiDurasiJam > 0 &&
		(!selectedKategori?.maks_durasi_jam || estimasiDurasiJam <= selectedKategori.maks_durasi_jam) &&
		!!delegasiKaryawanId && delegasiCatatan.trim().length >= 5 &&
		!submitting
	);

	async function handleSubmit() {
		if (!canSubmit || !kategoriId || !estimasiDurasiJam) return;
		submitting = true;
		errorMsg = '';
		try {
			const idToken = await getIdToken();
			const formData = new FormData();
			formData.append('kategori_id', String(kategoriId));
			formData.append('alasan', alasan.trim());
			formData.append('estimasi_durasi_jam', String(estimasiDurasiJam));
			formData.append('delegasi_karyawan_id', delegasiKaryawanId);
			formData.append('delegasi_catatan', delegasiCatatan.trim());
			if (photoFile) {
				formData.append('foto', photoFile);
				formData.append('liveness_passed', livenessPassed ? 'true' : 'false');
			}

			const res = await fetch('/api/ess/izin-jam/submit', {
				method: 'POST',
				headers: { Authorization: `Bearer ${idToken}` },
				body: formData
			});
			if (!res.ok) {
				const data = await res.json().catch(() => null);
				throw new Error(data?.message || `Gagal (${res.status})`);
			}
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim pengajuan.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="w-full p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/ess')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Pengajuan izin terkirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">
				Menunggu approval atasan. QR pass akan dikirim via WhatsApp setelah disetujui.
			</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, var(--g))" onclick={() => goto('/ess')}>
				Kembali ke Beranda
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Izin Jam-Jaman</h1>
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Izin keluar sementara — dinas, pribadi, cuti jam, atau darurat</p>

		<div class="flex flex-col gap-4">
			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Kategori</p>
				{#if loadingKategori}
					<CircularProgressGauge size={40} strokeWidth={3} label="Memuat kategori izin..." />
				{:else}
					<select
						bind:value={kategoriId}
						class="w-full h-10 px-3 rounded-lg text-[13px] border"
						style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)"
					>
						<option value={null}>Pilih kategori...</option>
						{#each kategoriList as k (k.id)}
							<option value={k.id}>{k.nama}</option>
						{/each}
					</select>
					{#if selectedKategori}
						<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
							{selectedKategori.keterangan || ''}
							{#if selectedKategori.maks_durasi_jam}Maks {selectedKategori.maks_durasi_jam} jam.{/if}
							{#if selectedKategori.kuota_jam_per_bulan}Kuota {selectedKategori.kuota_jam_per_bulan} jam/bulan.{/if}
						</p>
					{/if}
				{/if}
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Estimasi Durasi (jam)</p>
				<input
					type="number"
					step="0.5"
					min="0"
					max={selectedKategori?.maks_durasi_jam || undefined}
					bind:value={estimasiDurasiJam}
					class="w-full h-10 px-3 rounded-lg text-[13px] border"
					style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)"
				/>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Alasan</p>
				<textarea
					bind:value={alasan}
					rows="3"
					class="w-full px-3 py-2 rounded-lg text-[13px] border"
					style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)"
				></textarea>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">
					Delegasi Tugas Kepada <span style="color:#DC2626">*</span>
				</p>
				<select
					bind:value={delegasiKaryawanId}
					class="w-full h-10 px-3 rounded-lg text-[13px] border"
					style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)"
				>
					<option value="">-- Pilih rekan kerja --</option>
					{#each rekanKerja as k}
						<option value={k.id}>{k.nama_karyawan}</option>
					{/each}
				</select>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">
					Tugas yang Didelegasikan <span style="color:#DC2626">*</span>
				</p>
				<textarea
					bind:value={delegasiCatatan}
					rows="2"
					class="w-full px-3 py-2 rounded-lg text-[13px] border"
					style="border-color: var(--sys-sep); background: var(--sys-bg2); color: var(--sys-label)"
					placeholder="Tugas/tanggung jawab yang dialihkan selama Anda izin"
				></textarea>
			</div>

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto (opsional)</p>
				{#if photoPreview}
					<div class="relative w-28 h-28">
						<img src={photoPreview} alt="Preview" class="w-28 h-28 object-cover rounded-lg" />
						<button
							class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white"
							style="background: #DC2626"
							onclick={() => { photoFile = null; photoPreview = null; }}
						>
							<IconX size={14} />
						</button>
					</div>
				{:else}
					<LivenessCamera onCapture={handleCapture} />
				{/if}
			</div>

			{#if errorMsg}
				<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--p, var(--g))"
				disabled={!canSubmit}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Ajukan Izin
			</button>
		</div>
	{/if}
</div>
