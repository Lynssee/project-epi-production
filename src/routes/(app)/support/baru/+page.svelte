<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { resolveOperatorId } from '$lib/services/preventive';
	import { getProjects } from '$lib/services/projects';
	import {
		createFieldTicket, uploadTicketPhoto,
		TIPE_OPTIONS, PRIORITAS_OPTIONS, DEPARTEMEN_OPTIONS
	} from '$lib/services/support';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconCamera, IconX } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import directus from '$lib/services/directus';
	import { readItem } from '@directus/sdk';
	import { compressPhoto } from '$lib/utils/photoCompress';

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	let nomorTiketHasil = $state('');

	let projects = $state<{ id: number; name: string }[]>([]);

	const prefillTipe = page.url.searchParams.get('tipe');
	const prefillDepartemen = page.url.searchParams.get('departemen');
	const prefillLokasi = page.url.searchParams.get('lokasi');
	const prefillJudul = page.url.searchParams.get('judul');

	let tipe = $state(prefillTipe && TIPE_OPTIONS.includes(prefillTipe) ? prefillTipe : 'Komplain');
	let judul = $state(prefillJudul || '');
	let deskripsi = $state('');
	let prioritas = $state('Sedang');
	let departemenTujuan = $state(prefillDepartemen && DEPARTEMEN_OPTIONS.includes(prefillDepartemen) ? prefillDepartemen : '');
	let projectId = $state<string>('');
	let lokasi = $state(prefillLokasi || '');
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_support', roles)) {
			goto('/');
		}
	});

	let userDivisi = $state<string>('');

	// Jaring pengaman draf: tiket lapangan sering diketik panjang lalu difoto —
	// tab dibunuh OS di titik itu berarti seluruh laporan hilang.
	interface TiketDraft {
		tipe: string;
		judul: string;
		deskripsi: string;
		prioritas: string;
		departemenTujuan: string;
		projectId: string;
		lokasi: string;
	}
	const TIKET_PHOTO_KEY = 'lampiran';
	const tiketPersist = createFormPersist<TiketDraft>('support_tiket_baru');
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function tiketSnapshot(): TiketDraft {
		return { tipe, judul, deskripsi, prioritas, departemenTujuan, projectId, lokasi };
	}

	onMount(async () => {
		try {
			projects = (await getProjects(undefined, true)) as any[];
			if ($authStore.karyawanId) {
				const kary: any = await directus.request(
					readItem('karyawan', $authStore.karyawanId, { fields: ['divisi'] })
				);
				userDivisi = kary?.divisi || '';
			}
		} catch (err) {
			console.error('Gagal memuat daftar proyek/divisi:', err);
		} finally {
			const draft = tiketPersist.restore();
			if (draft) {
				// Prefill dari query string menang atas draf — itu konteks yang baru
				// saja dipilih user saat membuka halaman ini.
				tipe = prefillTipe && TIPE_OPTIONS.includes(prefillTipe) ? prefillTipe : draft.tipe;
				departemenTujuan =
					prefillDepartemen && DEPARTEMEN_OPTIONS.includes(prefillDepartemen)
						? prefillDepartemen
						: draft.departemenTujuan;
				judul = prefillJudul || draft.judul;
				deskripsi = draft.deskripsi;
				prioritas = draft.prioritas;
				projectId = draft.projectId;
				lokasi = prefillLokasi || draft.lokasi;
				const blob = await tiketPersist.restorePhoto(TIKET_PHOTO_KEY);
				if (blob) {
					photoFile = new File([blob], 'lampiran.jpg', { type: blob.type || 'image/jpeg' });
					photoPreview = URL.createObjectURL(photoFile);
				}
				draftSavedAt = new Date();
			}
			draftArmed = true;
			loading = false;
		}
	});

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void tiketSnapshot();
		if (!draftArmed) return;
		tiketPersist.save(tiketSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(tiketPersist, tiketSnapshot));

	function handlePhotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		photoFile = file;
		photoPreview = URL.createObjectURL(file);
		tiketPersist.savePhoto(TIKET_PHOTO_KEY, file);
	}

	let canSubmit = $derived(judul.trim().length > 0 && deskripsi.trim().length > 0 && departemenTujuan.length > 0);

	async function handleSubmit() {
		if (!canSubmit || submitting) return;
		submitting = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama pelapor tidak ditemukan di sesi login.');
			const personnelId = await resolveOperatorId(karyawanName);

			let lampiranId: string | null = null;
			if (photoFile) {
				const compressed = await compressPhoto(photoFile);
				lampiranId = await uploadTicketPhoto(compressed);
			}

			let mappedDept: string | null = null;
			if (userDivisi) {
				const clean = userDivisi.trim().toLowerCase();
				if (clean.includes('sales') || clean.includes('marketing')) mappedDept = 'Sales';
				else if (clean.includes('produksi') || clean.includes('manufacture')) mappedDept = 'Produksi';
				else if (clean.includes('it') || clean.includes('media')) mappedDept = 'IT';
				else if (clean.includes('finance')) mappedDept = 'Finance';
				else if (clean.includes('qc') || clean.includes('quality')) mappedDept = 'QC';
				else if (clean.includes('logistik') || clean.includes('inventory')) mappedDept = 'Logistik';
				else if (clean.includes('procurement')) mappedDept = 'Procurement';
				else if (clean.includes('project')) mappedDept = 'Project';
				else if (clean.includes('ciketing')) mappedDept = 'Ciketing';
				else if (clean.includes('hrd') || clean.includes('general & hrd') || clean.includes('general manager') || clean.includes('direksi') || clean.includes('direktur')) mappedDept = 'HRD';
				else {
					const opt = DEPARTEMEN_OPTIONS.find(d => d.toLowerCase() === clean);
					mappedDept = opt || 'Lainnya';
				}
			}

			const ticket = await createFieldTicket({
				tipe,
				judul: judul.trim(),
				deskripsi: deskripsi.trim(),
				prioritas,
				departemen_tujuan: departemenTujuan,
				departemen_pelapor: mappedDept,
				project_id: projectId || null,
				lokasi: lokasi.trim() || null,
				lampiran: lampiranId,
				pelapor_id: personnelId,
				pelapor_nama: karyawanName
			});

			nomorTiketHasil = ticket.nomor_tiket;
			// Terkirim — draf lokal (termasuk foto di IndexedDB) sudah tidak relevan.
			tiketPersist.clear();
			await tiketPersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim tiket.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/support')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Tiket {nomorTiketHasil} terkirim</p>
			<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Menunggu verifikasi Admin/SPV Support.</p>
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, #1F6592)" onclick={() => goto('/support')}>
				Kembali ke Tiket Saya
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold" style="color: var(--sys-label)">Tiket Baru</h1>
		<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />
		<p class="text-[11px] mb-4" style="color: var(--sys-label3)">Laporkan komplain, permintaan, atau kendala dari lokasi</p>

		{#if loading}
			<div class="py-16 flex justify-center">
				<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Form Tiket..." sublabel="Inisialisasi form pelaporan kendala" />
			</div>
		{:else}
			<div class="flex flex-col gap-4">
				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Tipe</p>
					<div class="grid grid-cols-3 gap-2">
						{#each TIPE_OPTIONS as opt}
							<button
								class="h-10 rounded-lg text-[12px] font-bold"
								style={tipe === opt ? 'background: var(--p, #1F6592); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
								onclick={() => tipe = opt}
							>
								{opt}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="judul">Judul</label>
					<input
						id="judul"
						type="text"
						class="w-full rounded-lg border text-[13px] p-3"
						style="border-color: var(--sys-sep)"
						placeholder="Ringkasan masalah"
						bind:value={judul}
					/>
				</div>

				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="deskripsi">Deskripsi / Kronologi</label>
					<textarea
						id="deskripsi"
						class="w-full rounded-lg border text-[13px] p-3"
						style="border-color: var(--sys-sep)"
						rows="4"
						placeholder="Ceritakan kejadian secara lengkap"
						bind:value={deskripsi}
					></textarea>
				</div>

				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Prioritas</p>
					<div class="grid grid-cols-4 gap-2">
						{#each PRIORITAS_OPTIONS as opt}
							<button
								class="h-10 rounded-lg text-[11px] font-bold"
								style={prioritas === opt ? 'background: var(--p, #1F6592); color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
								onclick={() => prioritas = opt}
							>
								{opt}
							</button>
						{/each}
					</div>
				</div>

				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="departemen">Departemen Tujuan</label>
					<select
						id="departemen"
						class="w-full rounded-lg border text-[13px] p-3 bg-white"
						style="border-color: var(--sys-sep)"
						bind:value={departemenTujuan}
					>
						<option value="">— Pilih departemen —</option>
						{#each DEPARTEMEN_OPTIONS as d}<option value={d}>{d}</option>{/each}
					</select>
				</div>

				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="proyek">Proyek (opsional)</label>
					<select
						id="proyek"
						class="w-full rounded-lg border text-[13px] p-3 bg-white"
						style="border-color: var(--sys-sep)"
						bind:value={projectId}
					>
						<option value="">— Tidak terkait proyek —</option>
						{#each projects as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
					</select>
				</div>

				<div>
					<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="lokasi">Lokasi</label>
					<input
						id="lokasi"
						type="text"
						class="w-full rounded-lg border text-[13px] p-3"
						style="border-color: var(--sys-sep)"
						placeholder="Site / lokasi kejadian"
						bind:value={lokasi}
					/>
				</div>

				<div>
					<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Bukti (opsional)</p>
					{#if photoPreview}
						<div class="relative w-28 h-28 mb-2">
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
						<label class="w-28 h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
							<IconCamera size={22} style="color: var(--sys-label4)" />
							<span class="text-[10px]" style="color: var(--sys-label4)">Ambil foto</span>
							<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handlePhotoChange} />
						</label>
					{/if}
				</div>

				{#if errorMsg}
					<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
				{/if}

				<button
					class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
					style="background: var(--p, #1F6592)"
					disabled={!canSubmit || submitting}
					onclick={handleSubmit}
				>
					{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
					Kirim Tiket
				</button>
			</div>
		{/if}
	{/if}
</div>
