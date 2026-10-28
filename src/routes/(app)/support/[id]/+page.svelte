<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import { getProjectById } from '$lib/services/projects';
	import {
		getTicketById, resubmitTicket, uploadTicketPhoto, getTicketLogs,
		TIPE_OPTIONS, PRIORITAS_OPTIONS, DEPARTEMEN_OPTIONS,
		type SupportTicketRow, type SupportTicketLog
	} from '$lib/services/support';
	import { IconArrowLeft, IconLoader2, IconCircleCheck, IconAlertTriangle, IconCamera, IconX, IconEdit, IconCheck } from '@tabler/icons-svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import DraftIndicator from '$lib/components/shared/DraftIndicator.svelte';
	import directus from '$lib/services/directus';
	import { readItem } from '@directus/sdk';
	import { compressPhoto } from '$lib/utils/photoCompress';

	const DIRECTUS_URL = import.meta.env.VITE_DIRECTUS_API_URL;

	let ticketId = $derived($page.params.id as string);

	let loading = $state(true);
	let submitting = $state(false);
	let errorMsg = $state('');
	let ticket = $state<SupportTicketRow | null>(null);
	let projectName = $state('');
	let editing = $state(false);
	let resubmitted = $state(false);

	let logs = $state<SupportTicketLog[]>([]);
	let loadingLogs = $state(false);

	let tipe = $state('');
	let judul = $state('');
	let deskripsi = $state('');
	let prioritas = $state('');
	let departemenTujuan = $state('');
	let lokasi = $state('');
	let photoFile = $state<File | null>(null);
	let photoPreview = $state<string | null>(null);

	// Jaring pengaman draf untuk form "Edit & Ajukan Ulang". Tiket yang ditolak
	// biasanya diperbaiki sambil memfoto ulang bukti — kalau tab dibunuh OS di titik
	// itu, user harus mengulang perbaikan dari awal. Dikunci per tiket.
	interface TiketEditDraft {
		editing: boolean;
		tipe: string;
		judul: string;
		deskripsi: string;
		prioritas: string;
		departemenTujuan: string;
		lokasi: string;
	}
	const TIKET_PHOTO_KEY = 'lampiran';
	let editPersist = $derived(createFormPersist<TiketEditDraft>(`support_tiket_edit_${ticketId}`));
	let draftSavedAt = $state<Date | null>(null);
	let draftArmed = $state(false);

	function editSnapshot(): TiketEditDraft {
		return { editing, tipe, judul, deskripsi, prioritas, departemenTujuan, lokasi };
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_support', roles)) {
			goto('/');
		}
	});

	let userDivisi = $state<string>('');

	async function loadLogs() {
		loadingLogs = true;
		try {
			logs = await getTicketLogs(ticketId);
		} catch (err) {
			console.error('Gagal memuat log:', err);
		} finally {
			loadingLogs = false;
		}
	}

	function logIcon(tipe: string) {
		switch (tipe) {
			case 'Delegasi': return '➡️';
			case 'Status': return '🔄';
			case 'Verifikasi': return '✅';
			default: return '📝';
		}
	}

	function formatLogDate(d: string | null) {
		if (!d) return '-';
		return new Date(d).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
	}

	async function loadTicket() {
		ticket = await getTicketById(ticketId);
		if (!ticket) {
			errorMsg = 'Tiket tidak ditemukan.';
			loading = false;
			return;
		}
		if (ticket.project_id) {
			try {
				const proj: any = await getProjectById(ticket.project_id);
				projectName = proj?.name || '';
			} catch {
				projectName = '';
			}
		}
		if ($authStore.karyawanId) {
			try {
				const kary: any = await directus.request(
					readItem('karyawan', $authStore.karyawanId, { fields: ['divisi'] })
				);
				userDivisi = kary?.divisi || '';
			} catch (err) {
				console.error('Gagal memuat divisi karyawan:', err);
			}
		}
		tipe = ticket.tipe;
		judul = ticket.judul;
		deskripsi = ticket.deskripsi;
		prioritas = ticket.prioritas;
		departemenTujuan = ticket.departemen_tujuan || '';
		lokasi = ticket.lokasi || '';

		// Pulihkan draf SETELAH nilai dari server dipasang, supaya perbaikan yang belum
		// terkirim menang atas isi tiket lama.
		const draft = editPersist.restore();
		if (draft?.editing) {
			editing = true;
			tipe = draft.tipe;
			judul = draft.judul;
			deskripsi = draft.deskripsi;
			prioritas = draft.prioritas;
			departemenTujuan = draft.departemenTujuan;
			lokasi = draft.lokasi;
			const blob = await editPersist.restorePhoto(TIKET_PHOTO_KEY);
			if (blob) {
				photoFile = new File([blob], 'lampiran.jpg', { type: blob.type || 'image/jpeg' });
				photoPreview = URL.createObjectURL(photoFile);
			}
			draftSavedAt = new Date();
		}
		draftArmed = true;

		await loadLogs();
		loading = false;
	}

	onMount(loadTicket);

	// Autosave — baru aktif setelah draf lama sempat dipulihkan, biar tidak menimpanya.
	$effect(() => {
		void editSnapshot();
		if (!draftArmed) return;
		editPersist.save(editSnapshot());
		draftSavedAt = new Date();
	});

	$effect(() => registerFormPersistSaveTriggers(editPersist, editSnapshot));

	function verifikasiBadge(v: string) {
		if (v === 'Ditolak') return { bg: 'var(--rel)', color: 'var(--red)', label: 'Ditolak' };
		if (v === 'Terverifikasi') return { bg: 'var(--gg)', color: 'var(--ggd)', label: 'Terverifikasi' };
		return { bg: 'var(--aml)', color: 'var(--amd)', label: 'Menunggu Verifikasi' };
	}

	function statusBadge(status: string) {
		const map: Record<string, { bg: string; color: string }> = {
			'Open': { bg: 'var(--pl)', color: 'var(--pd)' },
			'In Progress': { bg: '#DBEAFE', color: '#1D4ED8' },
			'Resolved': { bg: 'var(--gg)', color: 'var(--ggd)' },
			'Closed': { bg: 'var(--sys-fill)', color: 'var(--sys-label3)' },
			'Cancelled': { bg: 'var(--rel)', color: 'var(--red)' }
		};
		return map[status] || { bg: 'var(--sys-fill)', color: 'var(--sys-label3)' };
	}

	function handlePhotoChange(e: Event) {
		const input = e.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		photoFile = file;
		photoPreview = URL.createObjectURL(file);
		editPersist.savePhoto(TIKET_PHOTO_KEY, file);
	}

	let canSubmit = $derived(judul.trim().length > 0 && deskripsi.trim().length > 0 && departemenTujuan.length > 0);

	async function handleResubmit() {
		if (!canSubmit || submitting || !ticket) return;
		submitting = true;
		errorMsg = '';
		try {
			const karyawanName = $authStore.karyawanName;
			if (!karyawanName) throw new Error('Nama pelapor tidak ditemukan di sesi login.');

			let lampiranId: string | null = ticket.lampiran;
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

			await resubmitTicket(
				ticket.id,
				{
					tipe,
					judul: judul.trim(),
					deskripsi: deskripsi.trim(),
					prioritas,
					departemen_tujuan: departemenTujuan,
					departemen_pelapor: mappedDept,
					lokasi: lokasi.trim() || null,
					lampiran: lampiranId
				},
				karyawanName
			);

			// Terkirim — draf perbaikan (termasuk foto di IndexedDB) sudah tidak relevan.
			editPersist.clear();
			await editPersist.clearPhotos();
			draftSavedAt = null;
			resubmitted = true;
			editing = false;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengajukan ulang tiket.';
		} finally {
			submitting = false;
		}
	}
</script>

<div class="max-w-2xl mx-auto p-4 pb-24">
	<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/support')}>
		<IconArrowLeft size={15} /> Kembali
	</button>

	{#if loading}
		<div class="py-16 flex justify-center">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Rincian Tiket..." sublabel="Mengambil status tindak lanjut kendala" />
		</div>
	{:else if errorMsg && !ticket}
		<div class="text-center py-16 text-[13px]" style="color: #DC2626">{errorMsg}</div>
	{:else if ticket}
		{@const vBadge = verifikasiBadge(ticket.verifikasi_status)}
		{@const sBadge = statusBadge(ticket.status)}

		{#if resubmitted}
			<div class="text-center py-16">
				<IconCircleCheck size={40} style="color: #16A34A; margin: 0 auto" />
				<p class="text-[14px] font-semibold mt-3" style="color: var(--sys-label)">Tiket diajukan ulang</p>
				<p class="text-[12px] mt-1" style="color: var(--sys-label3)">Menunggu verifikasi Admin/SPV Support kembali.</p>
				<button class="mt-5 px-4 py-2 rounded-lg text-[12px] font-semibold text-white" style="background: var(--p, #1F6592)" onclick={() => goto('/support')}>
					Kembali ke Tiket Saya
				</button>
			</div>
		{:else}
			<div class="mb-4">
				<p class="text-[11px] font-semibold" style="color: var(--sys-label4)">{ticket.nomor_tiket}</p>
				<h1 class="text-[16px] font-bold mt-0.5" style="color: var(--sys-label)">{ticket.judul}</h1>
				{#if editing}<DraftIndicator savedAt={draftSavedAt} hasPhotos={!!photoFile} />{/if}
				<div class="flex items-center gap-2 mt-2 flex-wrap">
					<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:{vBadge.bg}; color:{vBadge.color}">{vBadge.label}</span>
					{#if ticket.verifikasi_status === 'Terverifikasi'}
						<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:{sBadge.bg}; color:{sBadge.color}">{ticket.status}</span>
					{/if}
					<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--sys-fill); color:var(--sys-label3)">{ticket.tipe}</span>
				</div>
			</div>

			{#if ticket.verifikasi_status === 'Ditolak' && !editing}
				<div class="rounded-xl border p-3.5 mb-4" style="border-color: #FCA5A5; background: var(--rel)">
					<div class="flex items-start gap-2">
						<IconAlertTriangle size={16} style="color: var(--red); margin-top: 2px" />
						<div class="flex-1">
							<p class="text-[12px] font-semibold" style="color: var(--red)">Tiket ditolak Admin/SPV</p>
							{#if ticket.catatan_verifikasi}
								<p class="text-[12px] mt-1" style="color: #7F1D1D">{ticket.catatan_verifikasi}</p>
							{/if}
							<button
								class="mt-2.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold text-white"
								style="background: var(--red)"
								onclick={() => editing = true}
							>
								Edit &amp; Ajukan Ulang
							</button>
						</div>
					</div>
				</div>
			{/if}

			{#if editing}
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
						<input id="judul" type="text" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" bind:value={judul} />
					</div>

					<div>
						<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="deskripsi">Deskripsi / Kronologi</label>
						<textarea id="deskripsi" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" rows="4" bind:value={deskripsi}></textarea>
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
						<select id="departemen" class="w-full rounded-lg border text-[13px] p-3 bg-white" style="border-color: var(--sys-sep)" bind:value={departemenTujuan}>
							<option value="">— Pilih departemen —</option>
							{#each DEPARTEMEN_OPTIONS as d}<option value={d}>{d}</option>{/each}
						</select>
					</div>

					<div>
						<label class="text-[12px] font-semibold block mb-1.5" style="color: var(--sys-label)" for="lokasi">Lokasi</label>
						<input id="lokasi" type="text" class="w-full rounded-lg border text-[13px] p-3" style="border-color: var(--sys-sep)" bind:value={lokasi} />
					</div>

					<div>
						<p class="text-[12px] font-semibold mb-1.5" style="color: var(--sys-label)">Foto Bukti</p>
						{#if photoPreview}
							<div class="relative w-28 h-28 mb-2">
								<img src={photoPreview} alt="Preview" class="w-28 h-28 object-cover rounded-lg" />
								<button class="absolute -top-2 -right-2 w-6 h-6 rounded-full flex items-center justify-center text-white" style="background: #DC2626" onclick={() => { photoFile = null; photoPreview = null; }}>
									<IconX size={14} />
								</button>
							</div>
						{:else}
							<label class="w-28 h-28 rounded-lg border-2 border-dashed flex flex-col items-center justify-center gap-1 cursor-pointer" style="border-color: var(--sys-sep)">
								<IconCamera size={22} style="color: var(--sys-label4)" />
								<span class="text-[10px]" style="color: var(--sys-label4)">Ganti foto</span>
								<input type="file" accept="image/*" capture="environment" class="hidden" onchange={handlePhotoChange} />
							</label>
						{/if}
					</div>

					{#if errorMsg}
						<p class="text-[12px]" style="color: #DC2626">{errorMsg}</p>
					{/if}

					<div class="flex gap-2">
						<button class="flex-1 h-11 rounded-xl text-[13px] font-bold" style="background:var(--sys-fill); color:var(--sys-label3)" onclick={() => editing = false}>
							Batal
						</button>
						<button
							class="flex-1 h-11 rounded-xl text-[13px] font-bold text-white flex items-center justify-center gap-2 disabled:opacity-40"
							style="background: var(--p, #1F6592)"
							disabled={!canSubmit || submitting}
							onclick={handleResubmit}
						>
							{#if submitting}<IconLoader2 size={16} class="animate-spin" />{/if}
							Ajukan Ulang
						</button>
					</div>
				</div>
			{:else}
				<div class="flex flex-col gap-3">
					<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
						<p class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--sys-label4)">Deskripsi</p>
						<p class="text-[13px] mt-1" style="color: var(--sys-label)">{ticket.deskripsi}</p>
					</div>

					<div class="grid grid-cols-2 gap-3">
						<div class="rounded-xl border p-3" style="border-color: var(--sys-sep)">
							<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: var(--sys-label4)">Departemen Tujuan</p>
							<p class="text-[13px] mt-0.5" style="color: var(--sys-label)">{ticket.departemen_tujuan || '-'}</p>
						</div>
						<div class="rounded-xl border p-3" style="border-color: var(--sys-sep)">
							<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: var(--sys-label4)">Prioritas</p>
							<p class="text-[13px] mt-0.5" style="color: var(--sys-label)">{ticket.prioritas}</p>
						</div>
						<div class="rounded-xl border p-3" style="border-color: var(--sys-sep)">
							<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: var(--sys-label4)">Lokasi</p>
							<p class="text-[13px] mt-0.5" style="color: var(--sys-label)">{ticket.lokasi || '-'}</p>
						</div>
						<div class="rounded-xl border p-3" style="border-color: var(--sys-sep)">
							<p class="text-[10px] font-semibold uppercase tracking-wide" style="color: var(--sys-label4)">Proyek</p>
							<p class="text-[13px] mt-0.5" style="color: var(--sys-label)">{projectName || '-'}</p>
						</div>
					</div>

					{#if ticket.pic}
						<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
							<p class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--sys-label4)">PIC Penanganan</p>
							<p class="text-[13px] mt-1" style="color: var(--sys-label)">{ticket.pic}</p>
						</div>
					{/if}

					{#if ticket.solusi}
						<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep); background: var(--g6)">
							<p class="text-[11px] font-semibold uppercase tracking-wide" style="color: var(--green)">Solusi</p>
							<p class="text-[13px] mt-1" style="color: var(--sys-label)">{ticket.solusi}</p>
						</div>
					{/if}

					<!-- Riwayat Progress Timeline -->
					<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
						<p class="text-[11px] font-semibold uppercase tracking-wide mb-2.5" style="color: var(--sys-label4)">Riwayat Progress</p>
						{#if loadingLogs}
							<p class="text-[12px] text-gray-400">Memuat riwayat…</p>
						{:else if logs.length === 0}
							<p class="text-[12px] text-gray-400">Belum ada riwayat update progress.</p>
						{:else}
							<ol class="space-y-3.5 pl-1.5 border-l-2 border-slate-100 ml-1.5">
								{#each logs as l (l.id)}
									<li class="relative pl-4 text-[12px]">
										<span class="absolute -left-[11px] top-1 bg-white text-base leading-none w-[18px] h-[18px] flex items-center justify-center rounded-full border border-slate-200">
											{logIcon(l.tipe)}
										</span>
										<div class="flex-1 min-w-0">
											<div class="flex items-center gap-1.5 flex-wrap">
												<span class="font-bold text-slate-800">{l.tipe === 'Delegasi' ? 'Delegasi' : l.tipe === 'Status' ? 'Status' : 'Progress'}</span>
												<span class="text-slate-400 text-[11px]">{formatLogDate(l.date_created)}</span>
												{#if l.oleh}<span class="text-slate-400 text-[11px]">oleh {l.oleh}</span>{/if}
											</div>
											{#if l.tipe === 'Delegasi'}
												<div class="text-slate-500 font-medium text-[11px] mt-0.5">
													{#if l.pic_ke}PIC: {l.pic_dari || '-'} → <strong>{l.pic_ke}</strong>{/if}
													{#if l.departemen_ke}{l.pic_ke ? ' · ' : ''}Dept: {l.departemen_dari || '-'} → <strong>{l.departemen_ke}</strong>{/if}
												</div>
											{:else if l.status_ke}
												<div class="text-slate-500 font-medium text-[11px] mt-0.5">Status: {l.status_dari || '-'} → <strong>{l.status_ke}</strong></div>
											{/if}
											{#if l.catatan}<div class="text-slate-650 whitespace-pre-wrap mt-1 p-2 bg-slate-50 border border-slate-100 rounded-lg">{l.catatan}</div>{/if}
											{#if l.lampiran}
												<div class="mt-1 max-w-full rounded-lg overflow-hidden border border-slate-200 bg-slate-50 cursor-pointer hover:opacity-95 transition-opacity" style="max-height: 120px; display: inline-block;">
													<img 
														src="{DIRECTUS_URL}/assets/{l.lampiran}" 
														alt="Lampiran Progress" 
														class="object-contain" 
														style="max-height: 120px; max-width: 100%; display: block;"
														onclick={() => window.open(`${DIRECTUS_URL}/assets/${l.lampiran}`, '_blank')}
													/>
												</div>
											{/if}
										</div>
									</li>
								{/each}
							</ol>
						{/if}
					</div>

					{#if ticket.verifikasi_status === 'Terverifikasi' && ticket.verified_by}
						<p class="text-[11px]" style="color: var(--sys-label4)">
							Diverifikasi oleh {ticket.verified_by}{ticket.verified_at ? ` · ${new Date(ticket.verified_at).toLocaleString('id-ID')}` : ''}
						</p>
					{/if}
				</div>
			{/if}
		{/if}
	{/if}
</div>
