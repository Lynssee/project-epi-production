<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getIdToken, secureDirectusFetch } from '$lib/services/secureDirectus';
	import { getProjects } from '$lib/services/projects';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconBuildingStore, IconReceipt2 } from '@tabler/icons-svelte';
	import { SectionGuide, FieldHint, HelpIcon } from '$lib/components/hints';
	import { procurementLapanganHints } from '$lib/data/hints/procurementLapangan';
	import { getHint } from '$lib/data/hints/getHint';

	const h = (key: string) => getHint(procurementLapanganHints, key, 'procurementLapangan');

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'submit_pengajuan_pembelian', roles)) {
			goto('/');
		}
	});

	// ==================== FORM STATE ====================
	let projects = $state<any[]>([]);
	let loadingProjects = $state(true);
	// PRJ-29: dibuka dari tombol Keluar Uang di proyek -> proyek sudah terpilih (?project_id=).
	const qpProject = Number(page.url.searchParams.get('project_id'));
	let projectId = $state<number | ''>(Number.isFinite(qpProject) && qpProject > 0 ? qpProject : '');
	let tanggalBeli = $state(new Date().toISOString().slice(0, 10));
	let budgetCategory = $state('');
	let deskripsi = $state('');
	let nominal = $state('');
	let lokasiPembelian = $state('');

	// Vendor Wajib Terdaftar — Fase 2 (C4): autocomplete vendor + ambang wajib
	let vendorId = $state<number | null>(null);
	let vendorSuggestions = $state<any[]>([]);
	let showVendorList = $state(false);
	let vendorSearchTimer: ReturnType<typeof setTimeout> | undefined;
	let beliLokalThreshold = $state(1_000_000);
	let alasanTanpaVendor = $state('');

	function onLokasiInput() {
		vendorId = null; // ketik manual = batal pilih vendor terdaftar
		const q = lokasiPembelian.trim();
		if (vendorSearchTimer) clearTimeout(vendorSearchTimer);
		if (q.length < 2) { vendorSuggestions = []; showVendorList = false; return; }
		vendorSearchTimer = setTimeout(async () => {
			try {
				const token = await getIdToken();
				const res = await fetch(`/api/procurement/vendor-suggest?q=${encodeURIComponent(q)}`, {
					headers: { Authorization: `Bearer ${token}` }
				});
				const j = await res.json();
				vendorSuggestions = j.data || [];
				if (typeof j.threshold === 'number' && j.threshold > 0) beliLokalThreshold = j.threshold;
				showVendorList = vendorSuggestions.length > 0;
			} catch {
				vendorSuggestions = [];
			}
		}, 300);
	}

	function pickVendor(v: any) {
		vendorId = v.id;
		lokasiPembelian = v.nama;
		showVendorList = false;
		alasanTanpaVendor = '';
	}

	let wajibVendorTerdaftar = $derived(parseFloat(nominal) >= beliLokalThreshold);
	let vendorTerpenuhi = $derived(
		!wajibVendorTerdaftar || !!vendorId || alasanTanpaVendor.trim().length >= 15
	);

	// F6.2 — Mode Darurat (Penajaman Petty Cash & LPJ v2)
	const KLASIFIKASI_DARURAT = [
		{ value: 'breakdown_critical', label: 'Breakdown kritis (alat/mesin berhenti)' },
		{ value: 'safety_hazard', label: 'Bahaya keselamatan' },
		{ value: 'material_habis', label: 'Material habis (pekerjaan berhenti)' },
		{ value: 'lainnya', label: 'Lainnya' }
	];
	// R1 — deep-link dari wizard "Saya Keluar Uang Duluan" (?darurat=1) menyalakan toggle.
	let modeDarurat = $state(page.url.searchParams.get('darurat') === '1');
	let klasifikasiDarurat = $state('');
	let alasanDarurat = $state('');

	let notaFile = $state<File | null>(null);
	let uploadedNotaId = $state<string | null>(null);
	let uploadedNotaPreview = $state('');
	let uploadingNota = $state(false);
	let notaInputEl: HTMLInputElement | undefined = $state();

	let submitting = $state(false);
	let submitted = $state(false);
	let submittedId = $state<number | null>(null);
	let paguWarning = $state<string | null>(null);
	let errorMsg = $state('');

	// ==================== RIWAYAT ====================
	let riwayat = $state<any[]>([]);
	let loadingRiwayat = $state(true);

	$effect(() => {
		(async () => {
			loadingProjects = true;
			try {
				projects = (await getProjects(null, true, $authStore.directusToken)) || [];
			} finally {
				loadingProjects = false;
			}
		})();
		loadRiwayat();
	});

	async function loadRiwayat() {
		loadingRiwayat = true;
		try {
			const token = await getIdToken();
			const res = await fetch('/api/procurement/pembelian-lokal-proyek', {
				headers: { Authorization: `Bearer ${token}` }
			});
			const json = await res.json();
			if (json.success) riwayat = json.data;
		} catch (e) {
			// diam-diam gagal -- riwayat bukan bagian kritis form
		} finally {
			loadingRiwayat = false;
		}
	}

	function formatRp(v: number) {
		return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', minimumFractionDigits: 0 }).format(v || 0);
	}

	async function handleFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		if (!file.type.startsWith('image/') && file.type !== 'application/pdf') {
			errorMsg = 'Hanya foto (JPG/PNG) atau PDF yang diperbolehkan';
			return;
		}
		if (file.size > 10 * 1024 * 1024) {
			errorMsg = 'Ukuran file maksimal 10 MB';
			return;
		}
		errorMsg = '';
		notaFile = file;
		uploadedNotaId = null;
		uploadingNota = true;
		try {
			const formData = new FormData();
			formData.append('file', file);
			const res = await secureDirectusFetch('/files', { method: 'POST', body: formData });
			if (!res.ok) throw new Error(`Gagal upload (${res.status})`);
			const json = await res.json();
			uploadedNotaId = json?.data?.id || null;
			uploadedNotaPreview = file.type.startsWith('image/') ? URL.createObjectURL(file) : '';
		} catch (err: any) {
			errorMsg = 'Gagal upload nota: ' + err.message;
			notaFile = null;
		} finally {
			uploadingNota = false;
		}
	}

	function removeNota() {
		notaFile = null;
		uploadedNotaId = null;
		uploadedNotaPreview = '';
		if (notaInputEl) notaInputEl.value = '';
	}

	let daruratValid = $derived(
		!modeDarurat ||
		(KLASIFIKASI_DARURAT.some((k) => k.value === klasifikasiDarurat) && alasanDarurat.trim().length >= 15)
	);
	let canSubmit = $derived(
		!!projectId && deskripsi.trim().length >= 5 && parseFloat(nominal) > 0 && !!tanggalBeli && !!uploadedNotaId && daruratValid && vendorTerpenuhi && !submitting
	);

	async function handleSubmit() {
		if (!canSubmit) return;
		submitting = true;
		errorMsg = '';
		try {
			const token = await getIdToken();
			const res = await fetch('/api/procurement/pembelian-lokal-proyek', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({
					projectId,
					tanggalBeli,
					budgetCategory: budgetCategory.trim() || null,
					deskripsi: deskripsi.trim(),
					nominal: parseFloat(nominal),
					lokasiPembelian: lokasiPembelian.trim() || null,
					vendorId: vendorId,
					alasanTanpaVendor: !vendorId ? (alasanTanpaVendor.trim() || null) : null,
					buktiNota: uploadedNotaId,
					modeDarurat,
					klasifikasiDarurat: modeDarurat ? klasifikasiDarurat : null,
					alasanDarurat: modeDarurat ? alasanDarurat.trim() : null
				})
			});
			const json = await res.json();
			if (!res.ok || !json.success) {
				errorMsg = json.message || 'Gagal mengajukan pembelian lokal';
				return;
			}
			submittedId = json.id;
			paguWarning = json.paguWarning || null;
			submitted = true;
			loadRiwayat();
		} catch (err: any) {
			errorMsg = 'Error: ' + err.message;
		} finally {
			submitting = false;
		}
	}

	function ajukanLagi() {
		submitted = false;
		submittedId = null;
		paguWarning = null;
		projectId = '';
		tanggalBeli = new Date().toISOString().slice(0, 10);
		budgetCategory = '';
		deskripsi = '';
		nominal = '';
		lokasiPembelian = '';
		vendorId = null;
		vendorSuggestions = [];
		showVendorList = false;
		alasanTanpaVendor = '';
		modeDarurat = false;
		klasifikasiDarurat = '';
		alasanDarurat = '';
		removeNota();
	}
</script>

<div class="flex-1 flex flex-col h-full overflow-hidden bg-slate-50">
	<div class="glass-panel border-b border-white/40 sticky top-0 z-30 shadow-sm">
		<div class="px-4 sm:px-6 py-4 flex items-center gap-3">
			<button onclick={() => goto('/procurement')} class="w-9 h-9 rounded-xl flex items-center justify-center hover:bg-black/5 shrink-0">
				<IconArrowLeft size={20} />
			</button>
			<div class="w-10 h-10 rounded-2xl bg-teal-500 flex items-center justify-center shadow-lg shadow-teal-500/20 text-white shrink-0">
				<IconBuildingStore size={20} />
			</div>
			<div>
				<h1 class="text-lg font-black text-slate-900 tracking-tight">Beli Lokal (Reimburse)</h1>
				<p class="text-xs font-medium" style="color: var(--sys-label3)">Sudah beli di lokasi? Ajukan penggantian di sini</p>
			</div>
		</div>
	</div>

	<div class="flex-1 overflow-y-auto px-4 sm:px-6 py-6 pb-24">
		<div class="max-w-lg mx-auto w-full space-y-4">
			<SectionGuide
				id="procurementLapangan.beliLokal.page"
				title={h('beliLokal.page').sectionGuide?.title}
				steps={h('beliLokal.page').sectionGuide?.steps ?? []}
			/>

			{#if submitted}
				<div class="glass-panel rounded-2xl p-6 text-center space-y-3">
					<div class="w-14 h-14 mx-auto rounded-full bg-green-100 flex items-center justify-center text-green-600">
						<IconCircleCheck size={28} />
					</div>
					<h2 class="font-bold text-slate-900">Pengajuan #{submittedId} terkirim</h2>
					<p class="text-sm text-slate-500">Menunggu approval admin pusat. Anda bisa memantau statusnya di riwayat bawah halaman ini.</p>
					{#if paguWarning}
						<div class="text-xs text-left bg-amber-50 border border-amber-200 text-amber-800 rounded-lg p-3">
							⚠️ {paguWarning}
							<FieldHint text={h('beliLokal.status.paguWarning').explain} />
						</div>
					{/if}
					<button onclick={ajukanLagi} class="w-full px-4 py-2.5 text-sm font-semibold bg-teal-600 text-white rounded-xl hover:bg-teal-700">
						Ajukan Lagi
					</button>
				</div>
			{:else}
				<div class="glass-panel rounded-2xl p-5 space-y-4">
					<div>
						<label for="beli-project" class="block text-sm font-semibold text-slate-700 mb-1">Proyek <span class="text-red-500">*</span></label>
						<select id="beli-project" bind:value={projectId} disabled={loadingProjects} class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-teal-400">
							<option value="">{loadingProjects ? 'Memuat proyek...' : '— Pilih proyek —'}</option>
							{#each projects as p (p.id)}
								<option value={p.id}>{p.name}</option>
							{/each}
						</select>
						<FieldHint text={h('beliLokal.form.project').fieldHint} />
					</div>

					<div>
						<label for="beli-tanggal" class="block text-sm font-semibold text-slate-700 mb-1">Tanggal Beli <span class="text-red-500">*</span></label>
						<input id="beli-tanggal" type="date" bind:value={tanggalBeli} max={new Date().toISOString().slice(0, 10)} class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
						<FieldHint text={h('beliLokal.form.tanggalBeli').fieldHint} />
					</div>

					<div>
						<label for="beli-deskripsi" class="block text-sm font-semibold text-slate-700 mb-1">Uraian Barang/Jasa <span class="text-red-500">*</span></label>
						<textarea id="beli-deskripsi" bind:value={deskripsi} rows="2" placeholder="Contoh: Beli paku, baut, dan kawat las di toko bangunan" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400"></textarea>
						<FieldHint text={h('beliLokal.form.deskripsi').fieldHint} />
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div>
							<label for="beli-nominal" class="block text-sm font-semibold text-slate-700 mb-1">Nominal (Rp) <span class="text-red-500">*</span></label>
							<input id="beli-nominal" type="number" min="1" bind:value={nominal} placeholder="0" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
						</div>
						<div>
							<label for="beli-kategori" class="block text-sm font-semibold text-slate-700 mb-1">Kategori Biaya</label>
							<input id="beli-kategori" type="text" bind:value={budgetCategory} placeholder="Opsional" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-teal-400" />
						</div>
					</div>
					<FieldHint text={h('beliLokal.form.nominal').fieldHint} />

					<div class="relative">
						<label for="beli-lokasi" class="block text-sm font-semibold text-slate-700 mb-1">
							Tempat Beli
							{#if wajibVendorTerdaftar}<span class="text-red-500"> *</span>{/if}
						</label>
						<input
							id="beli-lokasi"
							type="text"
							bind:value={lokasiPembelian}
							oninput={onLokasiInput}
							onfocus={() => { if (vendorSuggestions.length) showVendorList = true; }}
							autocomplete="off"
							placeholder="Nama toko/tempat beli"
							class="w-full px-3 py-2.5 border rounded-xl text-sm focus:ring-2 focus:ring-teal-400 {vendorId ? 'border-green-300 bg-green-50' : 'border-slate-200'}"
						/>
						{#if vendorId}
							<p class="mt-1 text-[11px] text-green-600">✓ Vendor terdaftar dipilih</p>
						{/if}
						{#if showVendorList && vendorSuggestions.length}
							<div class="absolute z-30 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-56 overflow-y-auto">
								{#each vendorSuggestions as v (v.id)}
									<button type="button" onclick={() => pickVendor(v)} class="w-full text-left px-3 py-2 text-sm hover:bg-teal-50 border-b border-slate-50 last:border-0">
										<span class="font-medium text-slate-800">{v.nama}</span>
										{#if v.kode_supplier}<span class="text-xs text-slate-400 ml-1">[{v.kode_supplier}]</span>{/if}
										{#if v.identitas_lengkap === false}<span class="block text-[10px] text-amber-600">identitas belum lengkap</span>{/if}
									</button>
								{/each}
								<div class="px-3 py-1.5 text-[11px] text-slate-400 bg-slate-50">Ketik terus bila toko tidak ada di daftar.</div>
							</div>
						{/if}
						<FieldHint text={h('beliLokal.form.tempatBeli').fieldHint} />
					</div>

					{#if wajibVendorTerdaftar && !vendorId}
						<div class="rounded-xl border border-amber-300 bg-amber-50/70 p-3 space-y-2">
							<p class="text-xs font-semibold text-amber-800">
								Nominal ≥ {formatRp(beliLokalThreshold)} — pilih vendor terdaftar di atas, atau jelaskan kenapa tidak.
							</p>
							<textarea
								bind:value={alasanTanpaVendor}
								rows="2"
								placeholder="Alasan tidak memakai vendor terdaftar (min. 15 karakter) — mis. toko lokal satu-satunya, darurat di lokasi terpencil"
								class="w-full px-3 py-2 border border-amber-200 rounded-lg text-sm focus:ring-2 focus:ring-amber-400"
							></textarea>
							<p class="text-[11px] {alasanTanpaVendor.trim().length >= 15 ? 'text-slate-400' : 'text-red-500'}">
								{alasanTanpaVendor.trim().length}/15 karakter minimal
							</p>
						</div>
					{/if}

					<!-- F6.2 — Mode Darurat -->
					<div class="rounded-xl border {modeDarurat ? 'border-red-300 bg-red-50/60' : 'border-slate-200 bg-slate-50/60'} p-3 space-y-3">
						<label class="flex items-start gap-3 cursor-pointer">
							<input type="checkbox" bind:checked={modeDarurat} class="mt-0.5 w-4 h-4 rounded accent-red-600" />
							<span>
								<span class="flex items-center gap-1 text-sm font-semibold text-slate-800">🚨 Pembelian Darurat <HelpIcon text={h('beliLokal.form.modeDarurat').helpIcon} position="right" /></span>
								<span class="block text-xs text-slate-500">Aktifkan hanya bila tidak bisa menunggu hari kerja. Wajib alasan + foto nota. Persetujuan dihitung dalam jam.</span>
							</span>
						</label>
						{#if modeDarurat}
							<div>
								<label for="beli-klasifikasi" class="block text-xs font-semibold text-slate-700 mb-1">Jenis Kedaruratan <span class="text-red-500">*</span></label>
								<select id="beli-klasifikasi" bind:value={klasifikasiDarurat} class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:ring-2 focus:ring-red-400">
									<option value="">— Pilih jenis —</option>
									{#each KLASIFIKASI_DARURAT as k (k.value)}
										<option value={k.value}>{k.label}</option>
									{/each}
								</select>
								<FieldHint text={h('beliLokal.form.klasifikasiDarurat').fieldHint} />
							</div>
							<div>
								<label for="beli-alasan-darurat" class="block text-xs font-semibold text-slate-700 mb-1">Alasan Darurat <span class="text-red-500">*</span></label>
								<textarea id="beli-alasan-darurat" bind:value={alasanDarurat} rows="2" placeholder="Jelaskan kenapa tidak bisa menunggu hari kerja (min. 15 karakter)" class="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-red-400"></textarea>
								<p class="text-[11px] mt-1 {alasanDarurat.trim().length >= 15 ? 'text-slate-400' : 'text-red-500'}">{alasanDarurat.trim().length}/15 karakter minimal</p>
								<FieldHint text={h('beliLokal.form.alasanDarurat').fieldHint} />
							</div>
						{/if}
					</div>

					<div>
						<div class="flex items-center gap-1 mb-1">
							<span class="block text-sm font-semibold text-slate-700">Foto Nota/Kuitansi <span class="text-red-500">*</span></span>
							<HelpIcon text={h('beliLokal.form.notaFoto').helpIcon} position="right" />
						</div>
						<input type="file" accept="image/*,application/pdf" bind:this={notaInputEl} onchange={handleFileChange} class="hidden" />
						{#if uploadedNotaId}
							<div class="flex items-center gap-2 p-2.5 border border-green-200 bg-green-50 rounded-xl text-sm">
								{#if uploadedNotaPreview}<img src={uploadedNotaPreview} alt="Preview nota" class="w-10 h-10 object-cover rounded-lg" />{/if}
								<span class="flex-1 text-green-700 truncate">✓ {notaFile?.name}</span>
								<button onclick={removeNota} class="text-red-500 text-xs font-medium">Hapus</button>
							</div>
						{:else}
							<button onclick={() => notaInputEl?.click()} disabled={uploadingNota} class="w-full px-3 py-3 border-2 border-dashed border-slate-300 rounded-xl text-sm text-slate-500 flex items-center justify-center gap-2 disabled:opacity-50">
								{#if uploadingNota}
									<IconLoader2 size={16} class="animate-spin" /> Mengunggah...
								{:else}
									<IconReceipt2 size={16} /> Ambil/Upload Foto Nota
								{/if}
							</button>
						{/if}
						<FieldHint text={h('beliLokal.form.notaFoto').fieldHint} />
					</div>

					{#if errorMsg}
						<div class="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl p-3">{errorMsg}</div>
					{/if}

					<button onclick={handleSubmit} disabled={!canSubmit} class="w-full px-4 py-3 text-sm font-bold bg-teal-600 text-white rounded-xl hover:bg-teal-700 disabled:opacity-50 flex items-center justify-center gap-2">
						{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
						{submitting ? 'Mengirim...' : 'Ajukan'}
					</button>
				</div>
			{/if}

			<!-- ==================== RIWAYAT ==================== -->
			{#if !loadingRiwayat && riwayat.length > 0}
				<div class="glass-panel rounded-2xl p-5">
					<h3 class="text-sm font-bold text-slate-700 mb-3">Riwayat Pengajuan Anda</h3>
					<div class="space-y-2">
						{#each riwayat as r (r.id)}
							<div class="flex items-center justify-between gap-3 p-2.5 border border-slate-100 rounded-xl text-sm">
								<div class="min-w-0">
									<div class="font-medium text-slate-800 truncate">{r.deskripsi}</div>
									<div class="text-xs text-slate-400">{formatRp(r.nominal)} · {r.project_id?.name || ''}</div>
								</div>
								<span
									class="text-xs font-semibold px-2 py-1 rounded-full shrink-0
										{r.status === 'Disetujui' ? 'bg-green-100 text-green-700' : r.status === 'Ditolak' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}"
								>
									{r.status}
								</span>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	</div>
</div>
