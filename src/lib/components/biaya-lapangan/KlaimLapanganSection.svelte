<!-- src/lib/components/biaya-lapangan/KlaimLapanganSection.svelte -->
<!-- Form input klaim lapangan, backcharge pemborong, dan pekerjaan tambah (Fase 2) -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import {
		IconLoader2,
		IconCamera,
		IconCheck,
		IconX,
		IconAlertTriangle
	} from '@tabler/icons-svelte';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { getBackchargeTarifs, type BackchargeTarifItem } from '$lib/services/proyekKlaimApi';
	import { getBoronganAssignments } from '$lib/services/manpowerBorongan';
	import { auth } from '$lib/firebase';

	interface Proyek {
		id: number;
		name: string;
	}

	let {
		selectedProjectId = $bindable<number | null>(null),
		proyekList = [],
		onSuccess
	}: {
		selectedProjectId?: number | null;
		proyekList?: Proyek[];
		onSuccess?: () => void;
	} = $props();

	// Form State
	let tipeKlaim = $state<'backcharge_pemborong' | 'pekerjaan_tambah_owner' | 'non_budget_darurat'>('backcharge_pemborong');
	let selectedPemborongId = $state<number | null>(null);
	let manualNamaPemborong = $state('');

	// Master Tarif & Kategori
	let tarifs = $state<Record<string, BackchargeTarifItem>>({});
	let loadingTarifs = $state(true);
	let kategoriJasa = $state('buang_puing');
	let volume = $state<number>(1);
	let tarifSatuan = $state<number>(350000);
	let catatan = $state('');

	// Pemborong list from borongan assignments
	let pemborongList = $state<Array<{ id: number; nama: string; jabatan?: string }>>([]);
	let loadingPemborong = $state(false);

	// Bukti Foto & Mandor Approval
	let fotoBuktiFile = $state<File | null>(null);
	let fotoBuktiPreview = $state<string | null>(null);

	let metodeMandor = $state<'screen' | 'paper'>('screen');
	let sigPadRef: any = $state(null);
	let fotoBaFile = $state<File | null>(null);
	let fotoBaPreview = $state<string | null>(null);
	let namaMandor = $state('');

	// Submission state
	let submitting = $state(false);
	let errorMsg = $state('');

	// Total Nominal dihitung otomatis
	const totalNominal = $derived(Math.max(0, volume * tarifSatuan));

	function formatRupiah(num: number): string {
		return `Rp ${Math.round(num).toLocaleString('id-ID')}`;
	}

	onMount(async () => {
		try {
			tarifs = await getBackchargeTarifs();
			if (tarifs['buang_puing']) {
				tarifSatuan = tarifs['buang_puing'].tarif;
			}
		} catch (err) {
			console.warn('[KlaimLapanganSection] Gagal muat master tarif:', err);
		} finally {
			loadingTarifs = false;
		}
	});

	// Muat daftar pemborong saat proyek berganti
	$effect(() => {
		if (selectedProjectId) {
			loadPemborongProyek(selectedProjectId);
		} else {
			pemborongList = [];
			selectedPemborongId = null;
		}
	});

	async function loadPemborongProyek(pId: number) {
		loadingPemborong = true;
		try {
			const rows = await getBoronganAssignments(pId);
			const list: Array<{ id: number; nama: string; jabatan?: string }> = [];
			const seen = new Set<number>();

			for (const r of rows) {
				const m = r.manpower_id;
				if (m && typeof m === 'object' && m.id && !seen.has(m.id)) {
					seen.add(m.id);
					list.push({ id: m.id, nama: m.nama || `Pemborong #${m.id}`, jabatan: r.jabatan });
				} else if (typeof m === 'number' && !seen.has(m)) {
					seen.add(m);
					list.push({ id: m, nama: `Pemborong #${m}`, jabatan: r.jabatan });
				}
			}
			pemborongList = list;
			if (list.length > 0 && !selectedPemborongId) {
				selectedPemborongId = list[0].id;
			}
		} catch (err) {
			console.warn('[KlaimLapanganSection] Gagal muat pemborong borongan:', err);
			pemborongList = [];
		} finally {
			loadingPemborong = false;
		}
	}

	function onKategoriChange(kategoriKey: string) {
		kategoriJasa = kategoriKey;
		const item = tarifs[kategoriKey];
		if (item && item.tarif > 0) {
			tarifSatuan = item.tarif;
		}
	}

	function onFotoBuktiChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (!file) return;
		fotoBuktiFile = file;
		if (fotoBuktiPreview) URL.revokeObjectURL(fotoBuktiPreview);
		fotoBuktiPreview = URL.createObjectURL(file);
	}

	function hapusFotoBukti() {
		fotoBuktiFile = null;
		if (fotoBuktiPreview) URL.revokeObjectURL(fotoBuktiPreview);
		fotoBuktiPreview = null;
	}

	function onFotoBaChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0] ?? null;
		if (!file) return;
		fotoBaFile = file;
		if (fotoBaPreview) URL.revokeObjectURL(fotoBaPreview);
		fotoBaPreview = URL.createObjectURL(file);
	}

	function hapusFotoBa() {
		fotoBaFile = null;
		if (fotoBaPreview) URL.revokeObjectURL(fotoBaPreview);
		fotoBaPreview = null;
	}

	async function authHeaders(): Promise<Record<string, string>> {
		const user = auth.currentUser;
		if (!user) return {};
		const token = await user.getIdToken();
		return { Authorization: `Bearer ${token}` };
	}

	async function handleSubmit() {
		errorMsg = '';

		if (!selectedProjectId) {
			errorMsg = 'Pilih proyek terlebih dahulu.';
			return;
		}

		if (totalNominal <= 0) {
			errorMsg = 'Total nominal harus lebih dari Rp 0.';
			return;
		}

		let namaPemborongFinal = manualNamaPemborong.trim();
		if (tipeKlaim === 'backcharge_pemborong') {
			if (selectedPemborongId) {
				const found = pemborongList.find((p) => p.id === selectedPemborongId);
				namaPemborongFinal = found ? found.nama : `Pemborong #${selectedPemborongId}`;
			} else if (!namaPemborongFinal) {
				errorMsg = 'Pilih pemborong atau isi nama pemborong tertanggung.';
				return;
			}
		}

		// Validasi bukti foto dan tanda tangan untuk backcharge
		let signatureData: string | null = null;
		if (tipeKlaim === 'backcharge_pemborong') {
			if (!fotoBuktiFile) {
				errorMsg = 'Wajib melampirkan foto bukti fisik pekerjaan (misal: foto puing/armada).';
				return;
			}

			if (metodeMandor === 'screen') {
				if (!sigPadRef || sigPadRef.isEmpty()) {
					errorMsg = 'Mandor belum menandatangani di layar. Minta mandor membubuhkan paraf atau ganti ke opsi foto BA fisik.';
					return;
				}
				signatureData = sigPadRef.toDataURL();
			} else {
				if (!fotoBaFile) {
					errorMsg = 'Wajib melampirkan foto lembar Berita Acara (BA) yang sudah ditandatangani mandor.';
					return;
				}
			}

			if (!namaMandor.trim()) {
				errorMsg = 'Isi nama mandor / penanggung jawab yang menyetujui.';
				return;
			}
		}

		submitting = true;
		try {
			const form = new FormData();
			form.set('project_id', String(selectedProjectId));
			form.set('tipe_klaim', tipeKlaim);
			if (selectedPemborongId) form.set('pemborong_id', String(selectedPemborongId));
			if (namaPemborongFinal) form.set('nama_pemborong', namaPemborongFinal);

			form.set('kategori_jasa', kategoriJasa);
			const currentTarif = tarifs[kategoriJasa];
			form.set('satuan_hitung', currentTarif?.satuan || 'ritase');
			form.set('volume', String(volume));
			form.set('tarif_satuan', String(tarifSatuan));
			form.set('total_nominal', String(totalNominal));
			form.set('catatan', catatan.trim());
			form.set('nama_mandor_penyetuju', namaMandor.trim());

			if (fotoBuktiFile) {
				const compressedBukti = await compressPhoto(fotoBuktiFile);
				form.set('foto_bukti', compressedBukti);
			}

			if (metodeMandor === 'paper' && fotoBaFile) {
				const compressedBa = await compressPhoto(fotoBaFile);
				form.set('foto_ba', compressedBa);
			} else if (signatureData) {
				form.set('signature_data', signatureData);
			}

			const res = await fetch('/api/proyek-klaim', {
				method: 'POST',
				headers: await authHeaders(),
				body: form
			});

			if (!res.ok) {
				const body = await res.json().catch(() => ({}));
				throw new Error(body?.message || `HTTP ${res.status}`);
			}

			// Sukses
			if (onSuccess) onSuccess();
		} catch (err: any) {
			console.error('[KlaimLapanganSection] Submit gagal:', err);
			errorMsg = err?.message || 'Gagal mengirim pengajuan klaim lapangan.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="space-y-4">
	<!-- 1. Tipe Klaim -->
	<div class="glass-panel rounded-2xl p-4">
		<p class="text-xs font-bold uppercase tracking-widest mb-3" style="color: var(--sys-label3)">
			Tujuan Klaim Lapangan
		</p>
		<div class="grid grid-cols-3 gap-2">
			<button
				type="button"
				onclick={() => (tipeKlaim = 'backcharge_pemborong')}
				class="flex flex-col items-center gap-1 p-2.5 rounded-xl text-center text-xs font-bold transition-all border"
				style={tipeKlaim === 'backcharge_pemborong'
					? 'background: var(--b6, #eff6ff); border-color: var(--blue, #3b82f6); color: var(--blue, #1d4ed8)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-lg">🤝</span>
				<span>Potong Pemborong</span>
				<span class="text-[10px] font-normal opacity-80">(Backcharge)</span>
			</button>

			<button
				type="button"
				onclick={() => (tipeKlaim = 'pekerjaan_tambah_owner')}
				class="flex flex-col items-center gap-1 p-2.5 rounded-xl text-center text-xs font-bold transition-all border"
				style={tipeKlaim === 'pekerjaan_tambah_owner'
					? 'background: var(--g6, #f0fdf4); border-color: var(--green, #16a34a); color: var(--green, #15803d)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-lg">📑</span>
				<span>Klaim Owner</span>
				<span class="text-[10px] font-normal opacity-80">(Pekerjaan Tambah)</span>
			</button>

			<button
				type="button"
				onclick={() => (tipeKlaim = 'non_budget_darurat')}
				class="flex flex-col items-center gap-1 p-2.5 rounded-xl text-center text-xs font-bold transition-all border"
				style={tipeKlaim === 'non_budget_darurat'
					? 'background: var(--o6, #fff7ed); border-color: var(--orange, #f97316); color: var(--orange, #c2410c)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-lg">🚨</span>
				<span>Biaya Darurat</span>
				<span class="text-[10px] font-normal opacity-80">(Non-RAP Site)</span>
			</button>
		</div>

		{#if tipeKlaim === 'backcharge_pemborong'}
			<p class="text-xs mt-2.5 px-1 leading-relaxed" style="color: var(--sys-label3)">
				💡 Jasa/biaya internal kita (buang puing, pemakaian alat, solar) akan <b>memotong pembayaran opname/termin pemborong</b> terkait.
			</p>
		{:else if tipeKlaim === 'pekerjaan_tambah_owner'}
			<p class="text-xs mt-2.5 px-1 leading-relaxed" style="color: var(--sys-label3)">
				💡 Pekerjaan ekstra di luar kontrak yang diminta owner di lapangan. Akan masuk antrean <b>Addendum / Invoice Tambahan</b> di kantor.
			</p>
		{:else}
			<p class="text-xs mt-2.5 px-1 leading-relaxed" style="color: var(--sys-label3)">
				💡 Pengeluaran tak terduga mendesak di lapangan yang membutuhkan persetujuan Project Manager.
			</p>
		{/if}
	</div>

	<!-- 2. Pilih Pemborong (Khusus Backcharge) -->
	{#if tipeKlaim === 'backcharge_pemborong'}
		<div class="glass-panel rounded-2xl p-4">
			<label class="block text-xs font-bold uppercase tracking-widest mb-2" style="color: var(--sys-label3)">
				Pemborong yang Bertanggung Jawab <span class="text-red-500">*</span>
			</label>
			{#if loadingPemborong}
				<CircularProgressGauge size={44} strokeWidth={3} label="Memuat daftar pemborong proyek..." />
			{:else if pemborongList.length > 0}
				<select
					bind:value={selectedPemborongId}
					class="w-full bg-transparent text-sm font-semibold py-1.5 outline-none mb-2"
					style="color: var(--sys-label)"
				>
					{#each pemborongList as p (p.id)}
						<option value={p.id}>{p.nama} {p.jabatan ? `(${p.jabatan})` : ''}</option>
					{/each}
					<option value={null}>+ Pemborong Lain / Input Manual</option>
				</select>
			{/if}

			{#if !selectedPemborongId || pemborongList.length === 0}
				<input
					type="text"
					placeholder="Tulis nama mandor / subkontraktor…"
					bind:value={manualNamaPemborong}
					class="w-full bg-transparent text-sm font-medium py-1.5 px-2 border rounded-xl outline-none"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
				/>
			{/if}
		</div>
	{/if}

	<!-- 3. Kategori Jasa & Tarif -->
	<div class="glass-panel rounded-2xl p-4">
		<label class="block text-xs font-bold uppercase tracking-widest mb-2" style="color: var(--sys-label3)">
			Jenis Pekerjaan / Jasa Lapangan
		</label>
		<div class="grid grid-cols-2 gap-2 mb-3">
			<button
				type="button"
				onclick={() => onKategoriChange('buang_puing')}
				class="flex items-center gap-2 p-2.5 rounded-xl text-left text-xs font-bold border transition-all"
				style={kategoriJasa === 'buang_puing'
					? 'background: var(--b6, #eff6ff); border-color: var(--blue, #3b82f6); color: var(--blue, #1d4ed8)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-base">🚚</span>
				<div>
					<div>Buang Puing</div>
					<div class="text-[10px] font-normal opacity-75">Tarif per Ritase</div>
				</div>
			</button>

			<button
				type="button"
				onclick={() => onKategoriChange('sewa_alat_internal')}
				class="flex items-center gap-2 p-2.5 rounded-xl text-left text-xs font-bold border transition-all"
				style={kategoriJasa === 'sewa_alat_internal'
					? 'background: var(--b6, #eff6ff); border-color: var(--blue, #3b82f6); color: var(--blue, #1d4ed8)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-base">⚙️</span>
				<div>
					<div>Pakai Genset/Alat</div>
					<div class="text-[10px] font-normal opacity-75">Tarif per Jam (HM)</div>
				</div>
			</button>

			<button
				type="button"
				onclick={() => onKategoriChange('solar_energi')}
				class="flex items-center gap-2 p-2.5 rounded-xl text-left text-xs font-bold border transition-all"
				style={kategoriJasa === 'solar_energi'
					? 'background: var(--b6, #eff6ff); border-color: var(--blue, #3b82f6); color: var(--blue, #1d4ed8)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-base">⛽</span>
				<div>
					<div>BBM / Solar Mesin</div>
					<div class="text-[10px] font-normal opacity-75">Tarif per Liter</div>
				</div>
			</button>

			<button
				type="button"
				onclick={() => onKategoriChange('tenaga_kerja')}
				class="flex items-center gap-2 p-2.5 rounded-xl text-left text-xs font-bold border transition-all"
				style={kategoriJasa === 'tenaga_kerja'
					? 'background: var(--b6, #eff6ff); border-color: var(--blue, #3b82f6); color: var(--blue, #1d4ed8)'
					: 'background: var(--sys-bg2); border-color: var(--sys-sep); color: var(--sys-label2)'}
			>
				<span class="text-base">👷</span>
				<div>
					<div>Bantuan Helper</div>
					<div class="text-[10px] font-normal opacity-75">Tarif per Hari</div>
				</div>
			</button>
		</div>

		<!-- Volume & Tarif Satuan Grid -->
		<div class="grid grid-cols-2 gap-3 pt-2 border-t" style="border-color: var(--sys-sep)">
			<div>
				<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">
					Volume ({tarifs[kategoriJasa]?.satuan || 'Satuan'})
				</label>
				<div class="flex items-center gap-1 border rounded-xl px-2.5 py-1.5" style="border-color: var(--sys-sep); background: var(--sys-bg2)">
					<input
						type="number"
						min="0.1"
						step="0.5"
						bind:value={volume}
						class="w-full bg-transparent text-sm font-bold outline-none"
						style="color: var(--sys-label)"
					/>
				</div>
			</div>

			<div>
				<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">
					Tarif Satuan (Rp)
				</label>
				<div class="flex items-center gap-1 border rounded-xl px-2.5 py-1.5" style="border-color: var(--sys-sep); background: var(--sys-bg2)">
					<input
						type="number"
						bind:value={tarifSatuan}
						class="w-full bg-transparent text-sm font-bold outline-none"
						style="color: var(--sys-label)"
					/>
				</div>
			</div>
		</div>

		<!-- Kalkulasi Total -->
		<div class="mt-3 p-3 rounded-xl flex items-center justify-between" style="background: var(--sys-bg2); border: 1px dashed var(--sys-sep)">
			<span class="text-xs font-semibold" style="color: var(--sys-label2)">Total Nilai Klaim:</span>
			<span class="text-base font-extrabold" style="color: var(--color-accent, #ea580c)">
				{formatRupiah(totalNominal)}
			</span>
		</div>
	</div>

	<!-- 4. Catatan Keterangan -->
	<div class="glass-panel rounded-2xl p-4">
		<label class="block text-xs font-bold uppercase tracking-widest mb-2" style="color: var(--sys-label3)">
			Keterangan Aktivitas / Lokasi
		</label>
		<textarea
			rows="2"
			placeholder="Misal: Buang puing sisa pembongkaran lantai zona B (3 rit dump truck)…"
			bind:value={catatan}
			class="w-full bg-transparent text-sm font-medium py-1.5 px-2 border rounded-xl outline-none"
			style="border-color: var(--sys-sep); color: var(--sys-label)"
		></textarea>
	</div>

	<!-- 5. Foto Bukti Fisik Lapangan -->
	<div class="glass-panel rounded-2xl p-4">
		<label class="block text-xs font-bold uppercase tracking-widest mb-2" style="color: var(--sys-label3)">
			Foto Bukti Fisik di Site <span class="text-red-500">*</span>
		</label>
		{#if fotoBuktiPreview}
			<div class="relative rounded-xl overflow-hidden border" style="border-color: var(--sys-sep)">
				<img src={fotoBuktiPreview} alt="Bukti" class="w-full max-h-48 object-contain bg-black/5" />
				<button
					type="button"
					onclick={hapusFotoBukti}
					class="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center bg-black/60 text-white"
				>
					<IconX size={16} />
				</button>
			</div>
		{:else}
			<label
				class="flex flex-col items-center gap-2 py-6 rounded-xl cursor-pointer border-2 border-dashed transition-colors hover:border-orange-400"
				style="border-color: var(--sys-sep); background: var(--sys-bg2)"
			>
				<IconCamera size={26} style="color: var(--sys-label4)" />
				<span class="text-xs font-semibold" style="color: var(--sys-label2)">Foto dokumentasi puing / armada / unit di lokasi</span>
				<span class="text-[10px]" style="color: var(--sys-label4)">Otomatis dikompres</span>
				<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onFotoBuktiChange} />
			</label>
		{/if}
	</div>

	<!-- 6. Pengesahan & Tanda Tangan Mandor (Khusus Backcharge) -->
	{#if tipeKlaim === 'backcharge_pemborong'}
		<div class="glass-panel rounded-2xl p-4">
			<div class="flex items-center justify-between mb-3">
				<label class="block text-xs font-bold uppercase tracking-widest" style="color: var(--sys-label3)">
					Pengesahan Mandor Pemborong <span class="text-red-500">*</span>
				</label>
				<!-- Pilihan Tab: TTD Layar vs Foto BA Kertas -->
				<div class="flex rounded-lg p-0.5 border" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
					<button
						type="button"
						onclick={() => (metodeMandor = 'screen')}
						class="px-2.5 py-1 text-xs font-bold rounded-md transition-all"
						style={metodeMandor === 'screen'
							? 'background: #fff; color: var(--sys-label); box-shadow: 0 1px 3px rgba(0,0,0,0.1)'
							: 'color: var(--sys-label3)'}
					>
						✍️ TTD Layar
					</button>
					<button
						type="button"
						onclick={() => (metodeMandor = 'paper')}
						class="px-2.5 py-1 text-xs font-bold rounded-md transition-all"
						style={metodeMandor === 'paper'
							? 'background: #fff; color: var(--sys-label); box-shadow: 0 1px 3px rgba(0,0,0,0.1)'
							: 'color: var(--sys-label3)'}
					>
						📄 Foto BA Fisik
					</button>
				</div>
			</div>

			<div class="mb-3">
				<label class="block text-[11px] font-semibold mb-1" style="color: var(--sys-label3)">
					Nama Mandor / PIC yang Menyetujui <span class="text-red-500">*</span>
				</label>
				<input
					type="text"
					placeholder="Misal: Mandor Budi / Pak Joko"
					bind:value={namaMandor}
					class="w-full bg-transparent text-sm font-semibold py-1.5 px-2.5 border rounded-xl outline-none"
					style="border-color: var(--sys-sep); color: var(--sys-label)"
				/>
			</div>

			{#if metodeMandor === 'screen'}
				<div>
					<p class="text-xs mb-1.5" style="color: var(--sys-label3)">
						Minta mandor pemborong menandatangani di kotak bawah ini:
					</p>
					<SignaturePad bind:this={sigPadRef} height={150} />
				</div>
			{:else}
				<div>
					<p class="text-xs mb-1.5" style="color: var(--sys-label3)">
						Unggah foto lembar Berita Acara / memo yang ditandatangani basah oleh mandor:
					</p>
					{#if fotoBaPreview}
						<div class="relative rounded-xl overflow-hidden border" style="border-color: var(--sys-sep)">
							<img src={fotoBaPreview} alt="BA Kertas" class="w-full max-h-48 object-contain bg-black/5" />
							<button
								type="button"
								onclick={hapusFotoBa}
								class="absolute top-2 right-2 w-7 h-7 rounded-full flex items-center justify-center bg-black/60 text-white"
							>
								<IconX size={16} />
							</button>
						</div>
					{:else}
						<label
							class="flex flex-col items-center gap-2 py-5 rounded-xl cursor-pointer border-2 border-dashed transition-colors hover:border-blue-400"
							style="border-color: var(--sys-sep); background: var(--sys-bg2)"
						>
							<IconCamera size={24} style="color: var(--sys-label4)" />
							<span class="text-xs font-semibold" style="color: var(--sys-label2)">Foto Berita Acara / Memo Fisik</span>
							<input type="file" accept="image/*" capture="environment" class="hidden" onchange={onFotoBaChange} />
						</label>
					{/if}
				</div>
			{/if}
		</div>
	{/if}

	<!-- Error Alert -->
	{#if errorMsg}
		<div class="rounded-xl p-3 flex items-start gap-2.5 border border-red-300 bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300">
			<IconAlertTriangle size={18} class="shrink-0 mt-0.5" />
			<p class="text-xs font-semibold leading-relaxed">{errorMsg}</p>
		</div>
	{/if}

	<!-- Submit Button -->
	<button
		type="button"
		disabled={submitting}
		onclick={handleSubmit}
		class="w-full py-3.5 rounded-xl text-sm font-bold text-white gradient-bg hover:opacity-95 transition-opacity flex items-center justify-center gap-2 shadow-sm disabled:opacity-50"
	>
		{#if submitting}
			<IconLoader2 size={18} class="animate-spin" />
			<span>Menyimpan Klaim Lapangan…</span>
		{:else}
			<IconCheck size={18} />
			<span>Kirim Klaim {tipeKlaim === 'backcharge_pemborong' ? 'Backcharge' : 'Lapangan'}</span>
		{/if}
	</button>
</div>
