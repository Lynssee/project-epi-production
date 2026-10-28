<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { getProfil, updateProfil, EDITABLE_PROFIL_FIELDS, type EssProfil } from '$lib/services/ess/profil';
	import {
		getDokumenList,
		openDokumenFile,
		uploadDokumen,
		SELF_UPLOAD_DOKUMEN_TYPES,
		type EssDokumen
	} from '$lib/services/ess/dokumen';
	import { IconLoader2, IconAlertTriangle, IconFileText, IconMail, IconUpload, IconX, IconCheck } from '@tabler/icons-svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let loading = $state(true);
	let errorMsg = $state('');
	let profil = $state<EssProfil | null>(null);
	let dokumen = $state<EssDokumen[]>([]);
	let openingId = $state<number | null>(null);

	let showUpload = $state(false);
	let uploadTipe = $state(SELF_UPLOAD_DOKUMEN_TYPES[0].value);
	let uploadFile = $state<File | null>(null);
	let uploading = $state(false);
	let uploadError = $state('');
	let uploadSuccess = $state('');

	let profilEdits = $state<Record<string, string>>({});
	let savingProfil = $state(false);
	let profilSaveMsg = $state('');
	let profilSaveError = $state('');

	function initEdits(p: EssProfil) {
		const edits: Record<string, string> = {};
		for (const f of EDITABLE_PROFIL_FIELDS) {
			edits[f.key] = (p[f.key] as string | null) || '';
		}
		profilEdits = edits;
	}

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const [profilRes, dokumenRes] = await Promise.all([getProfil(), getDokumenList()]);
			profil = profilRes.profil;
			dokumen = dokumenRes.dokumen;
			if (profil) initEdits(profil);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat profil.';
		} finally {
			loading = false;
		}
	}

	async function handleSaveProfil() {
		savingProfil = true;
		profilSaveError = '';
		profilSaveMsg = '';
		try {
			const patch: Record<string, string> = {};
			for (const f of EDITABLE_PROFIL_FIELDS) {
				patch[f.key] = profilEdits[f.key] ?? '';
			}
			const res = await updateProfil(patch);
			profil = res.profil;
			initEdits(res.profil);
			profilSaveMsg = 'Data diri berhasil disimpan.';
			setTimeout(() => (profilSaveMsg = ''), 3000);
		} catch (err: any) {
			profilSaveError = err?.message || 'Gagal menyimpan data diri.';
		} finally {
			savingProfil = false;
		}
	}

	onMount(load);

	// ?buka=<tipe_dokumen> (dikirim dari banner "Lengkapi Data Diri" / checklist gerbang
	// dokumen wajib) -> langsung buka form unggah dengan tipe itu sudah terpilih, supaya user
	// tidak perlu mencari sendiri tombol "Unggah" lalu memilih tipe yang benar dari dropdown.
	let autoOpened = $state(false);
	$effect(() => {
		const tipe = page.url.searchParams.get('buka');
		if (!tipe || autoOpened || loading) return;
		if (!SELF_UPLOAD_DOKUMEN_TYPES.some((t) => t.value === tipe)) return;
		autoOpened = true;
		uploadTipe = tipe;
		uploadFile = null;
		uploadError = '';
		uploadSuccess = '';
		showUpload = true;
	});

	async function handleOpenDokumen(doc: EssDokumen) {
		if (openingId) return;
		openingId = doc.id;
		try {
			await openDokumenFile(doc.id);
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal membuka dokumen.';
		} finally {
			openingId = null;
		}
	}

	function formatDate(dateStr: string | null) {
		if (!dateStr) return '-';
		const d = new Date(dateStr);
		if (isNaN(d.getTime())) return dateStr;
		return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	function openUpload() {
		uploadTipe = SELF_UPLOAD_DOKUMEN_TYPES[0].value;
		uploadFile = null;
		uploadError = '';
		uploadSuccess = '';
		showUpload = true;
	}

	function handleFileChange(e: Event) {
		const input = e.target as HTMLInputElement;
		uploadFile = input.files?.[0] || null;
	}

	async function handleUpload() {
		if (!uploadFile) {
			uploadError = 'Pilih file terlebih dahulu.';
			return;
		}
		uploading = true;
		uploadError = '';
		try {
			const compressed = uploadFile.type.startsWith('image/') ? await compressPhoto(uploadFile) : uploadFile;
			await uploadDokumen(uploadTipe, compressed);
			uploadSuccess = 'Dokumen berhasil diunggah, menunggu verifikasi HRD.';
			uploadFile = null;
			await load();
			setTimeout(() => { showUpload = false; uploadSuccess = ''; }, 1500);
		} catch (err: any) {
			uploadError = err?.message || 'Gagal mengunggah dokumen.';
		} finally {
			uploading = false;
		}
	}
</script>

<div class="w-full p-4 md:p-6 pb-24">
	<div class="mb-8">
		<h1 class="text-2xl md:text-3xl font-extrabold tracking-tight gradient-text">Profil Saya</h1>
		<p class="text-sm md:text-base mt-1 font-medium" style="color: var(--sys-label3)">Data diri & dokumen pribadi</p>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat profil karyawan..." />
		</div>
	{:else if errorMsg}
		<div class="glass-panel rounded-2xl p-8 text-center max-w-md mx-auto mt-10">
			<div class="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
				<IconAlertTriangle size={32} style="color: #DC2626" />
			</div>
			<h3 class="text-lg font-bold text-red-600 mb-2">Terjadi Kesalahan</h3>
			<p class="text-sm text-red-500 mb-6">{errorMsg}</p>
			<button class="px-6 py-2.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg" onclick={load}>
				Coba Lagi
			</button>
		</div>
	{:else}
		<div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
			<div class="lg:col-span-5 xl:col-span-4 flex flex-col gap-6">
				{#if profil}
					<div class="glass-panel rounded-3xl p-6 relative overflow-hidden">
						<div class="absolute top-0 right-0 w-32 h-32 bg-blue-500/10 rounded-full blur-3xl -mr-10 -mt-10"></div>
						<div class="relative z-10 flex flex-col items-center text-center mb-6">
							<div class="w-24 h-24 rounded-full gradient-bg flex items-center justify-center text-white text-3xl font-bold mb-4 shadow-xl shadow-blue-500/20">
								{profil.nama_karyawan.charAt(0).toUpperCase()}
							</div>
							<p class="text-xl font-bold" style="color: var(--sys-label)">{profil.nama_karyawan}</p>
							<p class="text-sm font-medium mt-1 px-3 py-1 bg-slate-100 rounded-full" style="color: var(--sys-label3)">{profil.posisi || '-'} &middot; {profil.divisi || '-'}</p>
						</div>
						<div class="grid grid-cols-2 gap-4 relative z-10">
							<div class="bg-white/50 p-3 rounded-xl border border-white/20">
								<p class="text-xs mb-1" style="color: var(--sys-label4)">No. Karyawan</p>
								<p class="text-sm font-bold" style="color: var(--sys-label)">{profil.no_karyawan || profil.id_karyawan || '-'}</p>
							</div>
							<div class="bg-white/50 p-3 rounded-xl border border-white/20">
								<p class="text-xs mb-1" style="color: var(--sys-label4)">Status</p>
								<p class="text-sm font-bold" style="color: var(--sys-label)">{profil.status_kerja || profil.status || '-'}</p>
							</div>
							<div class="bg-white/50 p-3 rounded-xl border border-white/20">
								<p class="text-xs mb-1" style="color: var(--sys-label4)">No. HP</p>
								<p class="text-sm font-bold" style="color: var(--sys-label)">{profil.no_hp || '-'}</p>
							</div>
							<div class="bg-white/50 p-3 rounded-xl border border-white/20">
								<p class="text-xs mb-1" style="color: var(--sys-label4)">Tanggal Masuk</p>
								<p class="text-sm font-bold" style="color: var(--sys-label)">{formatDate(profil.tanggal_masuk)}</p>
							</div>
						</div>
					</div>
				{/if}

				<button
					class="w-full h-12 rounded-xl glass-panel flex items-center justify-center gap-2 text-sm font-bold hover-lift transition-all hover:bg-blue-50"
					style="color: var(--p, var(--g))"
					onclick={() => goto('/support/baru?tipe=Permintaan&departemen=HRD')}
				>
					<IconMail size={18} /> Ajukan Surat Keterangan Kerja
				</button>

				{#if profil}
					<div class="glass-panel rounded-3xl p-6">
						<h2 class="text-lg font-bold mb-1" style="color: var(--sys-label)">Lengkapi Data Diri</h2>
						<p class="text-xs font-medium mb-4" style="color: var(--sys-label3)">Isi field yang masih kosong agar kelengkapan profil Anda 100%.</p>

						<div class="flex flex-col gap-3">
							{#each EDITABLE_PROFIL_FIELDS as f (f.key)}
								<div>
									<label class="block text-xs font-bold mb-1" style="color: var(--sys-label4)">
										{f.label}
										{#if !profil[f.key]}<span class="text-amber-500 ml-1">&bull; kosong</span>{/if}
									</label>
									{#if f.type === 'date'}
										<input
											type="date"
											class="w-full h-10 rounded-lg px-3 text-sm font-medium glass-panel"
											bind:value={profilEdits[f.key]}
											disabled={savingProfil}
										/>
									{:else}
										<input
											type="text"
											class="w-full h-10 rounded-lg px-3 text-sm font-medium glass-panel"
											bind:value={profilEdits[f.key]}
											disabled={savingProfil}
										/>
									{/if}
								</div>
							{/each}
						</div>

						{#if profilSaveError}
							<p class="text-xs font-medium text-red-500 mt-3">{profilSaveError}</p>
						{/if}
						{#if profilSaveMsg}
							<p class="text-xs font-medium text-green-600 mt-3 flex items-center gap-1"><IconCheck size={14} /> {profilSaveMsg}</p>
						{/if}

						<button
							class="w-full h-11 mt-4 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-md disabled:opacity-50 flex items-center justify-center gap-2"
							onclick={handleSaveProfil}
							disabled={savingProfil}
						>
							{#if savingProfil}
								<IconLoader2 size={16} class="animate-spin" /> Menyimpan...
							{:else}
								Simpan Data Diri
							{/if}
						</button>
					</div>
				{/if}
			</div>

			<div class="lg:col-span-7 xl:col-span-8">
				<div class="flex items-center justify-between mb-4">
					<h2 class="text-lg font-bold" style="color: var(--sys-label)">Dokumen Pribadi</h2>
					<button
						class="px-4 py-2 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-md flex items-center gap-2"
						onclick={openUpload}
					>
						<IconUpload size={16} /> Unggah
					</button>
				</div>
				{#if dokumen.length === 0}
					<div class="glass-panel rounded-2xl p-10 text-center">
						<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada dokumen tersimpan.</p>
					</div>
				{:else}
					<div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
						{#each dokumen as doc (doc.id)}
							<button
								class="hover-lift glass-panel rounded-2xl p-4 flex items-center gap-4 text-left disabled:opacity-50 w-full"
								disabled={openingId === doc.id}
								onclick={() => handleOpenDokumen(doc)}
							>
								<div class="w-12 h-12 rounded-xl flex items-center justify-center shrink-0 gradient-bg text-white shadow-md">
									{#if openingId === doc.id}
										<IconLoader2 size={20} class="animate-spin" />
									{:else}
										<IconFileText size={20} />
									{/if}
								</div>
								<div class="min-w-0 flex-1">
									<p class="text-sm font-bold truncate mb-0.5" style="color: var(--sys-label)">{doc.nama_dokumen}</p>
									<p class="text-xs font-medium" style="color: var(--sys-label3)">{doc.tipe_dokumen} &middot; {formatDate(doc.tanggal_upload)}</p>
								</div>
							</button>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}

	{#if showUpload}
		<div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.5)">
			<div class="glass-panel rounded-2xl p-6 w-full max-w-sm relative">
				<button
					class="absolute top-4 right-4 w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/5"
					onclick={() => (showUpload = false)}
					disabled={uploading}
				>
					<IconX size={18} />
				</button>
				<h3 class="text-lg font-bold mb-4" style="color: var(--sys-label)">Unggah Dokumen</h3>

				<label class="block text-xs font-bold mb-1.5" style="color: var(--sys-label3)">Jenis Dokumen</label>
				<select
					class="w-full h-11 rounded-xl px-3 mb-4 text-sm font-medium glass-panel"
					bind:value={uploadTipe}
					disabled={uploading}
				>
					{#each SELF_UPLOAD_DOKUMEN_TYPES as t}
						<option value={t.value}>{t.label}</option>
					{/each}
				</select>

				<label class="block text-xs font-bold mb-1.5" style="color: var(--sys-label3)">File (PDF/JPG/PNG, maks 10MB)</label>
				<input
					type="file"
					accept=".pdf,.jpg,.jpeg,.png"
					class="w-full text-sm mb-4"
					onchange={handleFileChange}
					disabled={uploading}
				/>

				{#if uploadError}
					<p class="text-xs font-medium text-red-500 mb-3">{uploadError}</p>
				{/if}
				{#if uploadSuccess}
					<p class="text-xs font-medium text-green-600 mb-3">{uploadSuccess}</p>
				{/if}

				<button
					class="w-full h-11 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-90 transition-opacity shadow-lg disabled:opacity-50 flex items-center justify-center gap-2"
					onclick={handleUpload}
					disabled={uploading || !uploadFile}
				>
					{#if uploading}
						<IconLoader2 size={18} class="animate-spin" /> Mengunggah...
					{:else}
						Unggah
					{/if}
				</button>
			</div>
		</div>
	{/if}
</div>
