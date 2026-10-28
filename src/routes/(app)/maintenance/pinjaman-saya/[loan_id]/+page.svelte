<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { slide } from 'svelte/transition';
	import { authStore } from '$lib/stores/auth';
	import directus, { handleDirectusError } from '$lib/services/directus';
	import { readItem } from '@directus/sdk';
	import {
		resolveChecklistTemplate,
		fetchPeminjamanInternalDetail,
		submitLoanChecklist,
		uploadChecklistPhoto,
		fetchLastChecklist,
		type LoanChecklistItem,
		type LoanRow,
		type LoanSource
	} from '$lib/services/loanChecklist';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconCamera, IconX } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import { compressPhoto } from '$lib/utils/photoCompress';

	// Rute ini selalu punya segmen [loan_id], jadi param-nya tidak pernah undefined;
	// tanpa penegasan ini TS melihat `string | undefined` dan menolak readItem().
	const loanId = $page.params.loan_id as string;
	const jenis = ($page.url.searchParams.get('jenis') as 'serah_terima' | 'harian' | 'kembali') || 'harian';
	// Fase 3 (port BR-01 -> peminjaman_internal, 15 Sep 2026).
	const source: LoanSource = $page.url.searchParams.get('source') === 'peminjaman_internal' ? 'peminjaman_internal' : 'internal_loan_log';

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let success = $state(false);
	let queued = $state(false);
	let ticketCreated = $state(false);

	let loan = $state<LoanRow | null>(null);
	let items = $state<LoanChecklistItem[]>([]);
	let signature = $state('');
	let photoFiles = $state<File[]>([]);
	let gps = $state<{ lat: number | null; lng: number | null }>({ lat: null, lng: null });

	// §7 rekomendasi L3 — acuan kondisi P2H terakhir, ditampilkan HANYA saat mengisi
	// checklist 'kembali'. Read-only, tidak memengaruhi status yang diisi di bawah.
	let lastP2h = $state<{ tanggal: string; items: LoanChecklistItem[] } | null>(null);
	let showLastP2h = $state(false);

	// Jaring pengaman draf. Beda dari layar lain: di sini fotonya BANYAK, jadi tiap
	// file disimpan dengan kunci `foto_<i>` dan jumlahnya dicatat di draf. Dikunci per
	// pinjaman + jenis checklist (serah_terima/harian/kembali) — tiga form berbeda
	// untuk satu unit, drafnya tidak boleh saling menimpa.
	interface LoanDraft {
		statuses: (LoanChecklistItem['status'])[];
		catatan: (string | undefined)[];
		signature: string;
		photoCount: number;
	}
	const loanPersist = createFormPersist<LoanDraft>(`loan_checklist_${source}_${loanId}_${jenis}`);
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function loanSnapshot(): LoanDraft {
		return {
			statuses: items.map((i) => i.status),
			catatan: items.map((i) => i.catatan),
			signature,
			photoCount: photoFiles.length
		};
	}

	/** Tulis ulang SEMUA foto ke IndexedDB; dipanggil tiap daftar foto berubah. */
	async function persistPhotos() {
		await loanPersist.clearPhotos();
		await Promise.all(photoFiles.map((f, i) => loanPersist.savePhoto(`foto_${i}`, f)));
	}

	// Peta lokasi (Fase 6 open-source plan, MapLibre) — lazy-load (tombol).
	let showLocationMap = $state(false);
	let LocationMap = $state<any>(null);
	async function toggleLocationMap() {
		if (!LocationMap) LocationMap = (await import('$lib/components/shared/LocationMap.svelte')).default;
		showLocationMap = !showLocationMap;
	}

	onMount(async () => {
		try {
			if (source === 'peminjaman_internal' && jenis !== 'harian') {
				throw new Error('Untuk peminjaman ini, hanya checklist harian yang bisa diisi dari sini.');
			}

			let equipmentId: string;
			if (source === 'peminjaman_internal') {
				const piData = await fetchPeminjamanInternalDetail(loanId);
				if (!piData) throw new Error('Peminjaman tidak ditemukan.');
				equipmentId = piData.equipment_id;
				loan = {
					id: piData.id,
					equipment_id: equipmentId,
					project_id: null,
					pic_id: null,
					borrower_id: null,
					approved_by_id: null,
					status: piData.status,
					checklist_policy: true,
					kondisi_awal_id: null,
					kondisi_akhir_id: null,
					start_date: '',
					end_date_planned: null,
					purpose: '',
					equipment: piData.equipment,
					source: 'peminjaman_internal'
				};
			} else {
				const loanData: any = await directus.request(
					readItem('internal_loan_log', loanId, { fields: ['*', 'equipment_id.id', 'equipment_id.name', 'equipment_id.code'] })
				);
				// Dipakai langsung di resolveChecklistTemplate() — membacanya lewat `loan`
				// bikin TS melihatnya sebagai kemungkinan null (state bisa berubah di antara
				// dua await), padahal nilainya sudah pasti di sini.
				equipmentId = loanData.equipment_id?.id || loanData.equipment_id;
				loan = {
					...loanData,
					equipment: loanData.equipment_id && typeof loanData.equipment_id === 'object' ? loanData.equipment_id : null,
					equipment_id: equipmentId,
					source: 'internal_loan_log'
				};
			}

			const template = await resolveChecklistTemplate(equipmentId);
			items = template.items.map((i) => ({ ...i }));

			// §7 rekomendasi L3 — best-effort, jangan sampai gagalnya ini menghalangi
			// pengisian checklist kembali.
			if (jenis === 'kembali') {
				lastP2h = await fetchLastChecklist(loanId, 'harian').catch(() => null);
			}

			// Pulihkan draf hanya bila jumlah item masih sama. Kalau template berubah di
			// sisi admin, memasangkan status lama ke item baru bisa menghasilkan ceklist
			// yang salah tanpa disadari user — lebih aman buang drafnya.
			const draft = loanPersist.restore();
			if (draft) {
				if (draft.statuses?.length === items.length) {
					items = items.map((it, i) => ({
						...it,
						status: draft.statuses[i] ?? it.status,
						catatan: draft.catatan?.[i] ?? it.catatan
					}));
					signature = draft.signature || '';
					const blobs = await Promise.all(
						Array.from({ length: draft.photoCount || 0 }, (_, i) => loanPersist.restorePhoto(`foto_${i}`))
					);
					photoFiles = blobs
						.map((b, i) => (b ? new File([b], `foto_${i}.jpg`, { type: b.type || 'image/jpeg' }) : null))
						.filter((f): f is File => !!f);
					draftSavedAt = new Date();
				} else {
					loanPersist.clear();
					await loanPersist.clearPhotos();
				}
			}
			draftArmed = true;

			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(pos) => { gps = { lat: pos.coords.latitude, lng: pos.coords.longitude }; },
					() => { /* GPS opsional */ }
				);
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data checklist.';
			handleDirectusError(err);
		} finally {
			loading = false;
		}
	});

	function setStatus(index: number, status: 'ok' | 'tidak' | 'na') {
		items = items.map((it, i) => (i === index ? { ...it, status } : it));
	}

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void loanSnapshot();
		if (!draftArmed) return;
		loanPersist.save(loanSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(loanPersist, loanSnapshot));

	function handlePhotoAdd(e: Event) {
		const input = e.target as HTMLInputElement;
		const files = Array.from(input.files || []);
		photoFiles = [...photoFiles, ...files];
		persistPhotos();
	}

	let allFilled = $derived(items.length > 0 && items.every((i) => i.status));

	async function handleSubmit() {
		if (!loan || !allFilled || submitting) return;
		if (!signature.trim()) {
			errorMsg = 'Nama pengisi (tanda tangan) wajib diisi';
			return;
		}
		submitting = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName || 'PIC';
			const fotoIds: string[] = [];
			for (const file of photoFiles) {
				const compressed = await compressPhoto(file);
				const id = await uploadChecklistPhoto(compressed);
				if (id) fotoIds.push(id);
			}

			const result = await submitLoanChecklist({
				loan,
				jenis,
				items,
				foto: fotoIds,
				gps_lat: gps.lat,
				gps_lng: gps.lng,
				signature,
				pelaporName: karyawanName
			});
			if ('queued' in result) {
				queued = true;
			} else {
				ticketCreated = result.ticketCreated;
			}
			// Tersimpan ATAU masuk antrean offline — dua-duanya berarti draf lokal
			// (termasuk foto di IndexedDB) sudah tidak relevan lagi.
			loanPersist.clear();
			await loanPersist.clearPhotos();
			draftSavedAt = null;
			success = true;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan checklist.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/maintenance/pinjaman-saya')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat rincian pinjaman alat..." />
		</div>
	{:else if success}
		<div class="text-center py-16">
			<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
			<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">
				{queued ? 'Checklist diantre' : 'Checklist tersimpan'}
			</p>
			{#if queued}
				<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Sinyal sedang lemah — checklist disimpan di HP dan akan otomatis terkirim saat sinyal kembali.</p>
			{:else if ticketCreated}
				<p class="text-[12px] mt-1" style="color: #DC2626">Ada temuan — tiket kendala otomatis dibuat ke tim Maintenance.</p>
			{/if}
			<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--g)" onclick={() => goto('/maintenance/pinjaman-saya')}>
				Kembali ke Daftar
			</button>
		</div>
	{:else}
		<h1 class="text-[16px] font-bold mb-1" style="color: var(--sys-label)">
			Checklist {jenis === 'serah_terima' ? 'Serah-Terima' : jenis === 'harian' ? 'Harian (P2H)' : 'Pengembalian'}
		</h1>
		<div class="flex items-center justify-between gap-2 mb-4">
			<p class="text-[11px]" style="color: var(--sys-label3)">{loan?.equipment?.name || 'Unit'} {loan?.equipment?.code ? `(${loan.equipment.code})` : ''}</p>
			<DraftIndicator savedAt={draftSavedAt} hasPhotos={photoFiles.length > 0} />
		</div>

		<!-- §7 rekomendasi L3 — acuan kondisi P2H terakhir, mencegah sengketa kerusakan
		     ("sudah rusak dari awal" vs "rusak dipakai proyek"). Read-only. -->
		{#if jenis === 'kembali' && lastP2h}
			<div class="glass-panel rounded-xl p-3 mb-3" style="border: 1px solid var(--sys-separator)">
				<button
					type="button"
					class="w-full flex items-center justify-between text-[11px] font-semibold"
					style="color: var(--sys-label2)"
					onclick={() => (showLastP2h = !showLastP2h)}
				>
					<span>📋 Acuan: P2H terakhir ({lastP2h.tanggal})</span>
					<span>{showLastP2h ? '▾' : '▸'}</span>
				</button>
				<p class="text-[10px] mt-0.5" style="color: var(--sys-label3)">
					Bandingkan kondisi alat sekarang dengan hasil P2H ini sebelum menilai checklist pengembalian di bawah.
				</p>
				{#if showLastP2h}
					<div class="mt-2 space-y-1">
						{#each lastP2h.items as it}
							<div class="flex items-center justify-between text-[11px]">
								<span style="color: var(--sys-label)">{it.label}</span>
								<span
									class="px-1.5 py-0.5 rounded text-[10px] font-bold"
									style={it.status === 'ok' ? 'background:#DCFCE7; color:#16A34A' : it.status === 'tidak' ? 'background:#FEE2E2; color:#DC2626' : 'background:var(--sys-fill); color:var(--sys-label3)'}
								>{it.status === 'ok' ? 'OK' : it.status === 'tidak' ? 'Tidak' : 'N/A'}</span>
							</div>
							{#if it.catatan}<p class="text-[10px] pl-1" style="color: var(--sys-label3)">↳ {it.catatan}</p>{/if}
						{/each}
					</div>
				{/if}
			</div>
		{/if}

		<div class="flex flex-col gap-3">
			{#each items as item, i}
				<div class="glass-panel rounded-xl p-3">
					<div class="flex items-center justify-between gap-2 mb-2">
						<span class="text-[12px] font-semibold" style="color: var(--sys-label)">{item.label}</span>
					</div>
					<div class="grid grid-cols-3 gap-2">
						<button
							class="h-9 rounded-lg text-[11px] font-bold"
							style={item.status === 'ok' ? 'background:#16A34A; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
							onclick={() => setStatus(i, 'ok')}
						>OK</button>
						<button
							class="h-9 rounded-lg text-[11px] font-bold"
							style={item.status === 'tidak' ? 'background:#DC2626; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
							onclick={() => setStatus(i, 'tidak')}
						>Tidak</button>
						<button
							class="h-9 rounded-lg text-[11px] font-bold"
							style={item.status === 'na' ? 'background:#6B7280; color:#fff' : 'background:var(--sys-fill); color:var(--sys-label3)'}
							onclick={() => setStatus(i, 'na')}
						>N/A</button>
					</div>
					{#if item.status === 'tidak'}
						<input
							bind:value={item.catatan}
							placeholder="Catatan temuan..."
							class="w-full mt-2 rounded-lg border text-[12px] p-2"
							style="border-color: var(--sys-sep)"
						/>
					{/if}
				</div>
			{/each}

			<div>
				<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Kondisi (opsional)</p>
				<label class="w-20 h-20 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
					<IconCamera size={18} style="color: var(--sys-label4)" />
					<input type="file" accept="image/*" capture="environment" multiple class="hidden" onchange={handlePhotoAdd} />
				</label>
				{#if photoFiles.length > 0}
					<p class="text-[10px] mt-1" style="color: var(--sys-label3)">{photoFiles.length} foto dipilih</p>
				{/if}
			</div>

			<div>
				<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="signature">Nama Pengisi / Tanda Tangan</label>
				<input
					id="signature"
					bind:value={signature}
					placeholder="Ketik nama lengkap"
					class="w-full rounded-lg border text-[13px] p-2.5"
					style="border-color: var(--sys-sep)"
				/>
			</div>

			{#if gps.lat != null && gps.lng != null}
				<button type="button" class="text-[11px] font-semibold" style="color: var(--g)" onclick={toggleLocationMap}>
					📍 {showLocationMap ? 'Sembunyikan peta lokasi' : 'Lihat peta lokasi Anda saat ini'}
				</button>
				{#if showLocationMap && LocationMap}
					<div transition:slide={{ duration: 200 }}>
						<LocationMap lat={gps.lat} lng={gps.lng} label="Lokasi checklist peminjaman" height="200px" />
					</div>
				{/if}
			{/if}

			{#if errorMsg}
				<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
			{/if}

			<button
				class="w-full h-12 rounded-xl text-[14px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
				style="background: var(--g)"
				disabled={!allFilled || submitting}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
				Simpan Checklist
			</button>
		</div>
	{/if}
</div>
