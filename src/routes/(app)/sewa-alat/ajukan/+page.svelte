<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Fase 4, Rencana Pertajam Rental Order v2 §9.2 L1 — "Ajukan Sewa Alat" ringkas khusus
	// lapangan. Field DIBATASI ke yang disebut rencana (jenis alat, qty, durasi, lokasi,
	// alasan, foto kondisi) -- TIDAK mereplikasi form PA lengkap (anggaran/baru, ~1000
	// baris: CategoryPicker/budget_category_config, dynamic fields, BBM split, dst).
	//
	// Keputusan user 18 Sep 2026: selalu jadi PA kategori_item='sewa_vendor' (bukan PR),
	// payment_method='Transfer' dengan penerima_dana PLACEHOLDER ("Vendor akan ditentukan
	// Procurement") -- detail rekening vendor asli diisi Finance/Procurement setelah
	// disetujui, sama seperti PR yang juga belum tahu vendor final saat diajukan.
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { IconArrowLeft, IconLoader2, IconCheck, IconPhoto, IconX } from '@tabler/icons-svelte';
	import directus from '$lib/services/directus';
	import { uploadFiles, readItems } from '@directus/sdk';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { createPengajuanAnggaran } from '$lib/services/finance';
	import { getKaryawanByEmail } from '$lib/services/karyawan';
	import { authStore } from '$lib/stores/auth';
	import { FieldHint } from '$lib/components/hints';
	import ProjectSelect from '$lib/components/anggaran/ProjectSelect.svelte';

	let currentUser = $state<any>(null);
	let currentKaryawanName = $state('');
	let currentKaryawanDivisi = $state('');
	let currentKaryawanEmail = $state('');
	let currentKaryawanId = $state<number | null>(null);
	let departmentId = $state<number | null>(null);

	let projects = $state<any[]>([]);
	let selectedProject = $state('');

	let namaAlat = $state('');
	let qty = $state(1);
	let satuan = $state('Unit');
	let tanggalMulai = $state(new Date().toISOString().split('T')[0]);
	let tanggalKembali = $state(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]);
	let lokasi = $state('');
	let alasan = $state('');

	let fotoFiles = $state<Array<{ file: File; id: string | null; uploading: boolean; preview: string }>>([]);
	let fotoInputEl: HTMLInputElement;

	let loading = $state(true);
	let submitting = $state(false);
	let successNomor = $state('');

	onMount(() => {
		const unsub = authStore.subscribe(async (s) => {
			currentUser = s.user;
			if (!s.checked || !currentUser?.email) return;
			try {
				const kary = await getKaryawanByEmail(currentUser.email);
				if (kary) {
					currentKaryawanName = kary.nama_karyawan;
					currentKaryawanDivisi = kary.divisi;
					currentKaryawanEmail = kary.email_company;
					currentKaryawanId = kary.id;
				}
			} catch (e) {
				console.warn('Gagal memuat data karyawan:', e);
			}
			// G1 (gate department valid) butuh department_id terisi -- resolusi dari nama
			// divisi karyawan, pola sama dgn anggaran/baru/+page.svelte.
			try {
				const deptResult = (await directus.request(
					readItems('department' as any, {
						filter: { is_active: { _eq: true } },
						fields: ['id', 'nama_department'],
						limit: -1
					})
				)) as any[];
				if (currentKaryawanDivisi) {
					const match = (deptResult || []).find(
						(d) => d.nama_department.trim().toUpperCase() === currentKaryawanDivisi.trim().toUpperCase()
					);
					if (match) departmentId = match.id;
				}
			} catch (e) {
				console.warn('Gagal memuat master department:', e);
			}
			try {
				projects = (await getProjectsForCurrentUser(true)) || [];
				if (projects.length > 0) selectedProject = String(projects[0].id);
			} catch (e) {
				console.warn('Gagal memuat daftar proyek:', e);
			}
			loading = false;
		});
		return unsub;
	});

	async function handleFotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		for (const file of files) {
			const entry = { file, id: null as string | null, uploading: true, preview: URL.createObjectURL(file) };
			fotoFiles = [...fotoFiles, entry];
			const idx = fotoFiles.length - 1;
			try {
				const compressed = file.type.startsWith('image/') ? await compressPhoto(file) : file;
				const formData = new FormData();
				formData.append('file', compressed);
				formData.append('title', file.name);
				const result = (await directus.request(uploadFiles(formData))) as any;
				fotoFiles[idx] = { ...fotoFiles[idx], id: result?.id || null, uploading: false };
				if (!result?.id) {
					alert(`Gagal mengunggah "${file.name}".`);
					fotoFiles = fotoFiles.filter((_, i) => i !== idx);
				}
			} catch (err) {
				console.error('Gagal mengunggah foto:', err);
				alert(`Gagal mengunggah "${file.name}". Coba lagi.`);
				fotoFiles = fotoFiles.filter((_, i) => i !== idx);
			}
		}
		if (fotoInputEl) fotoInputEl.value = '';
	}

	function removeFoto(idx: number) {
		fotoFiles = fotoFiles.filter((_, i) => i !== idx);
	}

	async function handleSubmit() {
		if (!namaAlat.trim()) return alert('Jenis/nama alat wajib diisi.');
		if (!selectedProject) return alert('Proyek wajib dipilih.');
		if (!lokasi.trim()) return alert('Lokasi penggunaan wajib diisi.');
		if (!alasan.trim()) return alert('Alasan/tujuan sewa wajib diisi.');
		if (new Date(tanggalKembali) < new Date(tanggalMulai)) return alert('Tanggal rencana kembali tidak boleh sebelum tanggal mulai.');
		if (fotoFiles.some((f) => f.uploading)) return alert('Tunggu foto selesai diunggah.');

		submitting = true;
		try {
			const uploadedFotoIds = fotoFiles.map((f) => f.id).filter(Boolean) as string[];
			const durasiHari = Math.max(1, Math.round((new Date(tanggalKembali).getTime() - new Date(tanggalMulai).getTime()) / 86400000));

			const formData = {
				pengaju_id: currentKaryawanId || null,
				nama_pengaju: currentKaryawanName || currentUser?.displayName || 'Leader',
				department: currentKaryawanDivisi || 'Project',
				department_id: departmentId,
				lampiran_file_ids: uploadedFotoIds,
				kategori: 'operasional',
				kategori_belanja: null,
				dynamic_fields: null,
				urgency: 'Normal',
				tujuan_pengajuan: `Sewa alat: ${namaAlat} — ${alasan}`,
				tanggal_dibutuhkan: tanggalMulai,
				payment_method: 'Transfer',
				total_amount: 0,
				comments: `Lokasi: ${lokasi}. Rencana sewa ${tanggalMulai} s/d ${tanggalKembali} (${durasiHari} hari).`,
				project_id: Number(selectedProject),
				// Placeholder — Finance/Procurement melengkapi rekening vendor asli setelah
				// disetujui & vendor ditentukan (keputusan user 18 Sep 2026).
				penerima_dana_type: 'vendor',
				penerima_dana_nama: 'Vendor akan ditentukan Procurement',
				bank_name: '',
				bank_account_number: '',
				bank_account_name: '',
				rekening_penerima_id: null,
				created_by_email: currentKaryawanEmail || currentUser?.email || null,
				lampiran_exception_reason: uploadedFotoIds.length > 0 ? null : 'kondisi_darurat_lapangan',
				lampiran_exception_note: uploadedFotoIds.length > 0 ? null : 'Sewa mendesak, foto kondisi menyusul.'
			};

			const items = [{
				deskripsi: namaAlat,
				kategori_item: 'sewa_vendor',
				vendor_name: '',
				quantity: qty,
				units: satuan,
				harga: 0,
				notes: `Durasi rencana: ${tanggalMulai} s/d ${tanggalKembali} (${durasiHari} hari). Lokasi: ${lokasi}.`
			}];

			const created = await createPengajuanAnggaran(formData, items);
			if (created) {
				successNomor = created.nomor_pengajuan;
			} else {
				alert('Gagal mengirim pengajuan.');
			}
		} catch (e: any) {
			console.error(e);
			alert(e?.message || 'Gagal mengirim pengajuan.');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex-1 flex flex-col h-full">
	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat form pengajuan sewa alat..." />
		</div>
	{:else if successNomor}
		<div class="flex-1 flex flex-col items-center justify-center gap-3 px-4 text-center">
			<div class="w-14 h-14 rounded-full flex items-center justify-center" style="background: #fff7ed; color: #ea580c">
				<IconCheck size={28} />
			</div>
			<p class="text-base font-bold" style="color: var(--sys-label)">Pengajuan Sewa Alat Terkirim</p>
			<p class="text-sm" style="color: var(--sys-label3)">Nomor pengajuan: <span class="font-mono font-semibold">{successNomor}</span></p>
			<button class="mt-2 px-4 py-2 rounded-lg text-sm font-semibold text-white" style="background: #ea580c" onclick={() => goto('/anggaran')}>
				Lihat Status Pengajuan
			</button>
		</div>
	{:else}
		<div class="scroll-body px-4 py-4 max-w-2xl mx-auto w-full space-y-4">
			<button type="button" class="flex items-center gap-1 text-sm text-gray-500" onclick={() => goto('/anggaran')}>
				<IconArrowLeft size={16} /> Kembali
			</button>

			<div class="rounded-xl p-3 border-l-4" style="background: #fff7ed; border-color: #ea580c;">
				<p class="text-sm font-bold" style="color: #9a3412">🔶 Ajukan Sewa Alat dari Vendor</p>
				<p class="text-xs mt-1" style="color: var(--sys-label3)">
					Untuk alat yang kita SEWA dari pihak luar (bukan alat milik sendiri). Pengajuan ini otomatis diproses sebagai Pengajuan Anggaran kategori "Sewa Alat dari Vendor" — begitu disetujui, item alat & jadwal kedatangan langsung tercatat di sistem gudang.
				</p>
			</div>

			<div>
				<label class="f-label" for="proyek">Proyek *</label>
				<ProjectSelect projects={projects.map((p) => ({ id: p.id, name: p.nama_project || p.name }))} bind:value={selectedProject} />
			</div>

			<div>
				<label class="f-label" for="nama-alat">Jenis / Nama Alat *</label>
				<input id="nama-alat" class="f-input" placeholder="Contoh: Compressor Airman PDS 390, Genset 25kVA" bind:value={namaAlat} />
				<FieldHint text="Sebutkan jenis alat sejelas mungkin — nama ini akan dipakai sebagai nama barang saat item sewa dibuat di sistem." />
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="f-label" for="qty">Jumlah Unit</label>
					<input id="qty" type="number" min="1" class="f-input" bind:value={qty} />
				</div>
				<div>
					<label class="f-label" for="satuan">Satuan</label>
					<select id="satuan" class="f-select" bind:value={satuan}>
						<option value="Unit">Unit</option>
						<option value="Set">Set</option>
						<option value="Pcs">Pcs</option>
					</select>
				</div>
			</div>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label class="f-label" for="tgl-mulai">Tanggal Mulai Sewa *</label>
					<input id="tgl-mulai" type="date" class="f-input" bind:value={tanggalMulai} />
				</div>
				<div>
					<label class="f-label" for="tgl-kembali">Rencana Kembali *</label>
					<input id="tgl-kembali" type="date" class="f-input" bind:value={tanggalKembali} />
				</div>
			</div>

			<div>
				<label class="f-label" for="lokasi">Lokasi Penggunaan *</label>
				<input id="lokasi" class="f-input" placeholder="Contoh: Site Ciketing, Workshop Balaraja" bind:value={lokasi} />
			</div>

			<div>
				<label class="f-label" for="alasan">Alasan / Tujuan Sewa *</label>
				<textarea id="alasan" class="f-input" rows="3" placeholder="Jelaskan kebutuhan sewa alat ini" bind:value={alasan}></textarea>
			</div>

			<div>
				<label class="f-label">Foto Kondisi Alat Saat Ini (opsional, tapi disarankan)</label>
				<FieldHint text="Foto kondisi eksisting jadi baseline pembanding saat alat dikembalikan ke vendor — melindungi Anda dari klaim kerusakan yang bukan tanggung jawab Anda." />
				<div class="flex flex-wrap gap-2 mt-1">
					{#each fotoFiles as f, idx}
						<div class="relative w-16 h-16 rounded-lg overflow-hidden border border-gray-200">
							<img src={f.preview} alt="preview" class="w-full h-full object-cover" />
							{#if f.uploading}
								<div class="absolute inset-0 bg-black/40 flex items-center justify-center">
									<IconLoader2 size={16} class="animate-spin text-white" />
								</div>
							{:else}
								<button type="button" class="absolute top-0 right-0 bg-black/60 text-white rounded-bl-lg p-0.5" onclick={() => removeFoto(idx)}>
									<IconX size={12} />
								</button>
							{/if}
						</div>
					{/each}
					<button
						type="button"
						class="w-16 h-16 rounded-lg border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400"
						onclick={() => fotoInputEl?.click()}
					>
						<IconPhoto size={20} />
					</button>
					<input bind:this={fotoInputEl} type="file" accept="image/*" multiple class="hidden" onchange={handleFotoChange} />
				</div>
			</div>

			<button
				type="button"
				class="w-full py-2.5 rounded-lg text-sm font-bold text-white disabled:opacity-50"
				style="background: #ea580c"
				disabled={submitting}
				onclick={handleSubmit}
			>
				{submitting ? 'Mengirim…' : 'Kirim Pengajuan Sewa Alat'}
			</button>
		</div>
	{/if}
</div>

<style>
	.f-label { display: block; font-size: 12px; font-weight: 600; color: var(--sys-label); margin-bottom: 4px; }
	.f-input, .f-select {
		width: 100%; padding: 8px 12px; border-radius: 8px; font-size: 13px;
		background: var(--sys-fill); border: 1px solid var(--sys-sep); color: var(--sys-label);
	}
</style>
