<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { 
		IconX, IconCheck, IconLoader2, IconUser, IconUsers, 
		IconAlertTriangle, IconClock, IconPlus, IconMinus, IconCalendar,
		IconChecklist, IconDeviceFloppy, IconRefresh, IconSearch,
		IconCamera, IconPhoto, IconTrash
	} from '@tabler/icons-svelte';
	import { getAssignments } from '$lib/services/manpowerAssignment';
	import { upsertTimesheetAbsensi, findAbsensiTodayOtherProject } from '$lib/services/manpowerAbsensi';
	import { uploadFile } from '$lib/services/reports';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import { authStore } from '$lib/stores/auth';
	import { getIdToken } from '$lib/services/secureDirectus';
	import { onMount } from 'svelte';

	let { projectId, onClose, onSuccess } = $props<{
		projectId: string | number;
		onClose: () => void;
		onSuccess: () => void;
	}>();

	let activeTab = $state<'bulk' | 'single'>('bulk');
	let loading = $state(false);
	let saving = $state(false);
	let isUploadingFoto = $state(false);
	let activeAssignments = $state<any[]>([]);
	let selectedDate = $state(new Date().toISOString().split('T')[0]);
	let searchQuery = $state('');

	// Mandatory site briefing documentation photo
	let fotoFile = $state<File | null>(null);
	let fotoPreviewUrl = $state<string | null>(null);
	let fotoUploadId = $state<string | null>(null);

	function handleFotoSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		const file = target.files?.[0];
		if (!file) return;
		fotoFile = file;
		fotoPreviewUrl = URL.createObjectURL(file);
	}

	function clearFoto() {
		fotoFile = null;
		if (fotoPreviewUrl) URL.revokeObjectURL(fotoPreviewUrl);
		fotoPreviewUrl = null;
		fotoUploadId = null;
	}

	// Bulk workers state map
	interface BulkWorkerState {
		assignmentId: number;
		manpowerId: number;
		nama: string;
		posisi: string;
		tanggalSelesai: string | null;
		status: 'hadir' | 'setengah_hari' | 'standby' | 'izin' | 'sakit' | 'alpha' | '';
		jam: number;
		ot_hours: number;
		is_holiday: boolean;
		is_standby: boolean;
		notes: string;
		otherProjectConflict: { id: number; name: string } | null;
		overrideConflict: boolean;
	}

	let bulkWorkers = $state<BulkWorkerState[]>([]);

	// Single worker form state
	let form = $state({
		tanggal: new Date().toISOString().split('T')[0],
		assignmentId: '',
		shift: 'Non-Shift',
		jam: 8,
		ot_hours: 0,
		is_holiday: false,
		is_standby: false,
		notes: ''
	});

	const SHIFT_OPTIONS = [
		{ value: 'Non-Shift', label: 'Non-Shift (Normal)' },
		{ value: 'Shift 1', label: 'Shift 1 (Pagi)' },
		{ value: 'Shift 2', label: 'Shift 2 (Siang)' },
		{ value: 'Shift 3', label: 'Shift 3 (Malam)' }
	];

	const asId = (v: any) => (v && typeof v === 'object' ? v.id : v);

	onMount(() => {
		loadData();
	});

	async function loadData() {
		loading = true;
		try {
			const res = await getAssignments({ project_id: Number(projectId), status: 'aktif' });
			activeAssignments = res.success ? (res.data || []) : [];
			await initBulkState();
		} catch (e) {
			console.error('loadData error:', e);
		} finally {
			loading = false;
		}
	}

	async function initBulkState() {
		if (activeAssignments.length === 0) {
			bulkWorkers = [];
			return;
		}

		// 1. Fetch existing absensi on selectedDate for this project
		let existingAbsensiMap = new Map<number, any>();
		try {
			const existingRows: any[] = await directus.request(
				readItems('manpower_absensi', {
					fields: ['id', 'assignment_id', 'manpower_id', 'tanggal', 'status', 'jam_kerja', 'ot_hours', 'is_standby', 'is_holiday', 'dobel_proyek_flag', 'dobel_proyek_proyek_lain_id'],
					filter: {
						project_id: { _eq: Number(projectId) },
						tanggal: { _eq: selectedDate }
					},
					limit: -1
				})
			);
			for (const row of existingRows || []) {
				const mid = asId(row.manpower_id);
				if (mid) existingAbsensiMap.set(Number(mid), row);
			}
		} catch (err) {
			console.warn('Gagal membaca absensi tersimpan:', err);
		}

		// 2. Check conflicts in other projects for workers
		const states: BulkWorkerState[] = [];
		for (const a of activeAssignments) {
			const mId = asId(a.manpower_id);
			const nama = (typeof a.manpower_id === 'object' ? a.manpower_id?.nama : '') || `#${mId}`;
			const existing = mId ? existingAbsensiMap.get(Number(mId)) : null;

			let conflict: { id: number; name: string } | null = null;
			if (mId) {
				try {
					const otherAbsen = await findAbsensiTodayOtherProject(Number(mId), selectedDate, Number(projectId));
					if (otherAbsen) {
						conflict = {
							id: asId(otherAbsen.project_id),
							name: otherAbsen.project_id?.name || `#${asId(otherAbsen.project_id)}`
						};
					}
				} catch {
					// Ignore fail soft
				}
			}

			let initialStatus: BulkWorkerState['status'] = '';
			let jam = 8;
			let ot_hours = 0;
			let is_standby = false;
			let is_holiday = false;
			let notes = '';

			if (existing) {
				initialStatus = (existing.status as any) || (existing.is_standby ? 'standby' : 'hadir');
				jam = existing.jam_kerja != null ? Number(existing.jam_kerja) : (existing.is_standby ? 0 : 8);
				ot_hours = Number(existing.ot_hours) || 0;
				is_standby = !!existing.is_standby;
				is_holiday = !!existing.is_holiday;
				notes = existing.notes || '';
			}

			states.push({
				assignmentId: a.id,
				manpowerId: Number(mId),
				nama,
				posisi: a.posisi || a.jabatan || 'Pekerja Lapangan',
				tanggalSelesai: a.tanggal_selesai || null,
				status: initialStatus,
				jam,
				ot_hours,
				is_holiday,
				is_standby,
				notes,
				otherProjectConflict: conflict,
				overrideConflict: !!existing?.dobel_proyek_flag
			});
		}
		bulkWorkers = states;
	}

	function handleDateChange(newDate: string) {
		selectedDate = newDate;
		form.tanggal = newDate;
		initBulkState();
	}

	// Bulk 1-tap actions
	function bulkMarkAllPresent(hours = 8) {
		for (const w of bulkWorkers) {
			w.status = 'hadir';
			w.jam = hours;
			w.is_standby = false;
		}
	}

	function bulkMarkAllStandby() {
		for (const w of bulkWorkers) {
			w.status = 'standby';
			w.jam = 0;
			w.ot_hours = 0;
			w.is_standby = true;
		}
	}

	function bulkClearAll() {
		for (const w of bulkWorkers) {
			w.status = '';
			w.jam = 8;
			w.ot_hours = 0;
			w.is_standby = false;
		}
	}

	function setWorkerStatus(w: BulkWorkerState, targetStatus: BulkWorkerState['status']) {
		if (w.status === targetStatus) {
			w.status = '';
			return;
		}
		w.status = targetStatus;
		if (targetStatus === 'hadir') {
			w.jam = 8;
			w.is_standby = false;
		} else if (targetStatus === 'setengah_hari') {
			w.jam = 4;
			w.ot_hours = 0;
			w.is_standby = false;
		} else if (targetStatus === 'standby') {
			w.jam = 0;
			w.ot_hours = 0;
			w.is_standby = true;
		} else {
			// izin, sakit, alpha
			w.jam = 0;
			w.ot_hours = 0;
			w.is_standby = false;
		}
	}

	function stepJam(w: BulkWorkerState, delta: number) {
		const cur = Number(w.jam) || 0;
		w.jam = Math.max(0, Math.min(24, Math.round((cur + delta) * 10) / 10));
	}

	function setOtPreset(w: BulkWorkerState, hours: number) {
		w.ot_hours = w.ot_hours === hours ? 0 : hours;
	}

	function isSPKExpiring(endStr: string | null) {
		if (!endStr) return false;
		const diff = (new Date(endStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
		return diff <= 7;
	}

	let filteredBulkWorkers = $derived(
		bulkWorkers.filter(w => {
			if (!searchQuery.trim()) return true;
			const q = searchQuery.toLowerCase();
			return w.nama.toLowerCase().includes(q) || w.posisi.toLowerCase().includes(q);
		})
	);

	let bulkCounts = $derived.by(() => {
		let hadir = 0;
		let setengah = 0;
		let standby = 0;
		let absen = 0;
		let unset = 0;
		let conflicts = 0;
		for (const w of bulkWorkers) {
			if (w.status === 'hadir') hadir++;
			else if (w.status === 'setengah_hari') setengah++;
			else if (w.status === 'standby') standby++;
			else if (w.status === 'izin' || w.status === 'sakit' || w.status === 'alpha') absen++;
			else unset++;
			if (w.otherProjectConflict && w.status) conflicts++;
		}
		return { total: bulkWorkers.length, hadir, setengah, standby, absen, unset, conflicts };
	});

	async function handleBulkSubmit() {
		const toSave = bulkWorkers.filter(w => w.status !== '');
		if (toSave.length === 0) {
			alert('Pilih status kehadiran minimal satu pekerja.');
			return;
		}

		// Validasi wajib foto dokumentasi briefing / kehadiran di site
		if (!fotoFile && !fotoUploadId) {
			alert('⚠️ Wajib melampirkan foto briefing pagi / dokumentasi tim di site sebelum menyimpan presensi.');
			return;
		}

		// Conflict check confirmation
		const activeConflicts = toSave.filter(w => w.otherProjectConflict && !w.overrideConflict);
		if (activeConflicts.length > 0) {
			const msg = activeConflicts
				.map(c => `• ${c.nama} (sudah di: ${c.otherProjectConflict?.name})`)
				.join('\n');
			const ok = confirm(
				`⚠️ Terdeteksi pekerja yang sudah diabsenkan di proyek lain hari ini:\n${msg}\n\nTetap simpan presensi ganda?`
			);
			if (!ok) return;
		}

		saving = true;
		try {
			// Unggah foto jika belum terunggah
			let fotoId = fotoUploadId;
			if (fotoFile && !fotoId) {
				isUploadingFoto = true;
				try {
					const upRes: any = await uploadFile(fotoFile);
					fotoId = upRes?.id || null;
					fotoUploadId = fotoId;
				} catch (uploadErr: any) {
					alert('Gagal mengunggah foto dokumentasi: ' + (uploadErr?.message || uploadErr));
					saving = false;
					isUploadingFoto = false;
					return;
				} finally {
					isUploadingFoto = false;
				}
			}

			const userName = ($authStore?.user as any)?.first_name || 'Project Leader';

			await Promise.all(
				toSave.map(async (w) => {
					await upsertTimesheetAbsensi({
						assignmentId: w.assignmentId,
						manpowerId: w.manpowerId,
						projectId: Number(projectId),
						tanggal: selectedDate,
						jamKerja: w.jam,
						ot_hours: w.ot_hours,
						is_standby: w.is_standby,
						is_holiday: w.is_holiday,
						notes: w.notes,
						status: w.status,
						foto_masuk: fotoId,
						dicatatOleh: userName,
						dobelProyekFlag: !!w.otherProjectConflict,
						dobelProyekProyekLainId: w.otherProjectConflict?.id
					});
				})
			);

			onSuccess();

			// Alert defisit manpower lapangan ke n8n jika kehadiran < 80% dari rencana SPK
			if (bulkWorkers.length > 0) {
				const plan = bulkWorkers.length;
				const actual = toSave.filter(w => ['hadir', 'setengah_hari', 'standby'].includes(w.status)).length;
				const deficitPct = Math.round(((plan - actual) / plan) * 100);
				if (deficitPct > 20) {
					getIdToken().then((idToken) => {
						fetch('/api/laporan/notify-submitted', {
							method: 'POST',
							headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
							body: JSON.stringify({
								projectId,
								projectName: 'Proyek Site',
								headcountActual: actual,
								headcountPlan: plan
							})
						}).catch(() => {});
					}).catch(() => {});
				}
			}
		} catch (err: any) {
			alert('Terjadi kesalahan saat menyimpan presensi: ' + (err?.message || err));
		} finally {
			saving = false;
		}
	}

	async function handleSingleSubmit() {
		if (!form.assignmentId || !form.tanggal) {
			alert('Mohon isi tanggal dan pilih pekerja');
			return;
		}
		saving = true;
		try {
			const assignment = activeAssignments.find(a => String(a.id) === String(form.assignmentId));
			if (!assignment) {
				alert('Penugasan tidak ditemukan');
				saving = false;
				return;
			}
			const manpowerId = asId(assignment.manpower_id);
			const userName = ($authStore?.user as any)?.first_name || 'Project Leader';

			const res = await upsertTimesheetAbsensi({
				assignmentId: assignment.id,
				manpowerId: Number(manpowerId),
				projectId: Number(projectId),
				tanggal: form.tanggal,
				jamKerja: form.jam,
				shift: form.shift,
				notes: form.notes,
				is_holiday: form.is_holiday,
				ot_hours: form.ot_hours,
				is_standby: form.is_standby,
				status: form.is_standby ? 'standby' : (form.jam === 4 ? 'setengah_hari' : 'hadir'),
				dicatatOleh: userName
			});
			if (res.success) {
				onSuccess();
			} else {
				alert(res.error || 'Gagal menyimpan absensi');
			}
		} catch (err) {
			alert('Terjadi kesalahan saat menyimpan');
		} finally {
			saving = false;
		}
	}
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
	<div class="bg-white rounded-2xl w-full max-w-2xl sm:max-w-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] border border-gray-100">
		<!-- Modal Header with Tab Selector -->
		<div class="p-4 border-b border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/50">
			<div>
				<div class="flex items-center gap-2">
					<span class="p-1.5 rounded-lg bg-emerald-100 text-emerald-800">
						<IconUsers size={18} />
					</span>
					<h3 class="font-bold text-gray-800 text-[15px]">Presensi Manpower Proyek</h3>
				</div>
				<p class="text-[12px] text-gray-500 mt-0.5">Catat kehadiran dan jam kerja tim lapangan langsung ke Directus.</p>
			</div>

			<div class="flex items-center gap-2 self-end sm:self-center">
				<div class="inline-flex rounded-xl bg-gray-100 p-1">
					<button
						type="button"
						onclick={() => (activeTab = 'bulk')}
						class="px-3 py-1 rounded-lg text-xs font-semibold transition {activeTab === 'bulk' ? 'bg-white text-gray-800 shadow-xs' : 'text-gray-500 hover:text-gray-700'}"
					>
						⚡ Presensi Cepat Tim (1-Tap)
					</button>
					<button
						type="button"
						onclick={() => (activeTab = 'single')}
						class="px-3 py-1 rounded-lg text-xs font-semibold transition {activeTab === 'single' ? 'bg-white text-gray-800 shadow-xs' : 'text-gray-500 hover:text-gray-700'}"
					>
						👤 Input Per Orang
					</button>
				</div>

				<button
					class="w-8 h-8 flex items-center justify-center rounded-full bg-white text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors shadow-xs"
					onclick={onClose}
				>
					<IconX size={18} />
				</button>
			</div>
		</div>

		<!-- Modal Body -->
		<div class="p-4 sm:p-5 overflow-y-auto space-y-4 flex-1">
			{#if loading}
				<CircularProgressGauge size={50} strokeWidth={4} label="Memuat data tim dan status presensi..." />
			{:else if activeAssignments.length === 0}
				<div class="text-center py-12 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
					<IconUsers size={32} class="mx-auto text-gray-400 mb-2" />
					<p class="text-[13px] font-semibold text-gray-700">Belum Ada SPK / Penugasan Aktif</p>
					<p class="text-[12px] text-gray-500 mt-1 max-w-sm mx-auto">
						Pekerja harus ditugaskan ke proyek ini terlebih dahulu melalui modul Manpower Assignment sebelum dapat diabsenkan.
					</p>
				</div>
			{:else if activeTab === 'bulk'}
				<!-- ─── BULK 1-TAP ATTENDANCE MODE ─── -->
				<!-- Date & Bulk Actions Bar -->
				<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 bg-emerald-50/60 rounded-xl border border-emerald-100">
					<div class="flex items-center gap-2">
						<IconCalendar size={16} class="text-emerald-700 shrink-0" />
						<label class="text-xs font-bold text-emerald-950 shrink-0">Tanggal Presensi:</label>
						<input
							type="date"
							value={selectedDate}
							onchange={(e) => handleDateChange(e.currentTarget.value)}
							class="text-xs font-semibold px-2.5 py-1 rounded-lg border border-emerald-200 bg-white text-gray-800 focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
						<button
							type="button"
							onclick={() => handleDateChange(new Date().toISOString().split('T')[0])}
							class="text-[11px] font-semibold text-emerald-700 hover:underline px-1"
						>
							Hari Ini
						</button>
					</div>

					<div class="flex items-center gap-1.5 flex-wrap">
						<button
							type="button"
							onclick={() => bulkMarkAllPresent(8)}
							class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 active:scale-95 transition shadow-xs flex items-center gap-1"
						>
							<IconCheck size={13} /> Hadir Semua (8j)
						</button>
						<button
							type="button"
							onclick={bulkMarkAllStandby}
							class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-amber-500 text-white hover:bg-amber-600 active:scale-95 transition shadow-xs"
						>
							Standby Semua
						</button>
						<button
							type="button"
							onclick={bulkClearAll}
							class="px-2.5 py-1 rounded-lg text-xs font-semibold bg-white border border-gray-200 text-gray-600 hover:bg-gray-50 transition"
						>
							Kosongkan
						</button>
					</div>
				</div>

				<!-- Foto Dokumentasi Briefing / Kehadiran Site (Wajib) -->
				<div class="p-3 rounded-xl border {fotoFile || fotoUploadId ? 'bg-emerald-50/50 border-emerald-200' : 'bg-amber-50/60 border-amber-200'}">
					<div class="flex items-center justify-between mb-2">
						<div class="flex items-center gap-1.5">
							<IconCamera size={16} class="{fotoFile || fotoUploadId ? 'text-emerald-700' : 'text-amber-700'}" />
							<span class="text-xs font-bold {fotoFile || fotoUploadId ? 'text-emerald-950' : 'text-amber-950'}">
								Foto Briefing / Dokumentasi Tim di Site <span class="text-red-500">* (Wajib)</span>
							</span>
						</div>
						{#if fotoFile || fotoUploadId}
							<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800 flex items-center gap-1">
								<IconCheck size={12} /> Foto Siap
							</span>
						{:else}
							<span class="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-800">
								Wajib Dilampirkan
							</span>
						{/if}
					</div>

					{#if fotoPreviewUrl}
						<div class="flex items-center gap-3 p-2 bg-white rounded-lg border border-gray-200">
							<img src={fotoPreviewUrl} alt="Foto Briefing" class="w-14 h-14 object-cover rounded-md border border-gray-100 shrink-0" />
							<div class="flex-1 min-w-0">
								<p class="text-xs font-semibold text-gray-800 truncate">{fotoFile?.name || 'Dokumentasi-site.jpg'}</p>
								<p class="text-[10px] text-gray-500">{fotoFile ? (fotoFile.size / 1024).toFixed(1) + ' KB' : 'Tersimpan'}</p>
							</div>
							<button
								type="button"
								onclick={clearFoto}
								class="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition"
								title="Hapus foto"
							>
								<IconTrash size={16} />
							</button>
						</div>
					{:else}
						<label class="flex flex-col sm:flex-row items-center justify-center gap-2 p-3 rounded-lg border-2 border-dashed border-amber-300 hover:border-amber-400 bg-white cursor-pointer transition text-center sm:text-left">
							<input
								type="file"
								accept="image/*"
								capture="environment"
								onchange={handleFotoSelect}
								class="hidden"
							/>
							<div class="w-8 h-8 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
								<IconCamera size={18} />
							</div>
							<div>
								<p class="text-xs font-semibold text-gray-800">Ketuk untuk Ambil Foto / Pilih dari Galeri</p>
								<p class="text-[11px] text-gray-500">Ambil foto briefing pagi, safety talk, atau kehadiran tim di lokasi proyek</p>
							</div>
						</label>
					{/if}
				</div>

				<!-- Search Filter -->
				{#if bulkWorkers.length > 3}
					<div class="relative">
						<IconSearch size={14} class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Cari nama pekerja atau posisi..."
							class="w-full pl-8 pr-3 py-1.5 text-xs bg-gray-50 border border-gray-200 rounded-lg focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-500"
						/>
					</div>
				{/if}

				<!-- Conflict Alert Summary -->
				{#if bulkCounts.conflicts > 0}
					<div class="p-2.5 rounded-xl bg-red-50 border border-red-200 text-red-700 flex items-center gap-2 text-xs">
						<IconAlertTriangle size={16} class="shrink-0 text-red-600" />
						<span><strong>Peringatan Konflik:</strong> {bulkCounts.conflicts} pekerja terdeteksi sudah tercatat absen di proyek lain hari ini. Periksa tanda merah sebelum menyimpan.</span>
					</div>
				{/if}

				<!-- Workers Roster -->
				<div class="space-y-2.5">
					{#each filteredBulkWorkers as w (w.assignmentId)}
						{@const isPresent = w.status === 'hadir' || w.status === 'setengah_hari'}
						{@const isStandby = w.status === 'standby'}
						{@const isAbsen = w.status === 'izin' || w.status === 'sakit' || w.status === 'alpha'}

						<div class="p-3 rounded-xl border transition-all {isPresent ? (w.status === 'setengah_hari' ? 'bg-sky-50/40 border-sky-200' : 'bg-emerald-50/40 border-emerald-200') : isStandby ? 'bg-amber-50/40 border-amber-200' : isAbsen ? 'bg-purple-50/40 border-purple-200' : 'bg-white border-gray-200 opacity-80 hover:opacity-100'}">
							<!-- Row Header -->
							<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
								<div class="flex items-center gap-2.5">
									<div class="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs shrink-0 {isPresent ? 'bg-emerald-100 text-emerald-800' : isStandby ? 'bg-amber-100 text-amber-800' : isAbsen ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-600'}">
										{w.nama.substring(0, 2).toUpperCase()}
									</div>
									<div>
										<div class="flex items-center gap-2 flex-wrap">
											<span class="text-[13px] font-bold text-gray-900">{w.nama}</span>
											<span class="text-[10px] px-1.5 py-0.5 rounded font-medium bg-gray-100 text-gray-600">
												{w.posisi}
											</span>
											{#if isSPKExpiring(w.tanggalSelesai)}
												<span class="text-[10px] px-1.5 py-0.2 rounded font-bold bg-red-100 text-red-700">
													SPK s.d. {w.tanggalSelesai}
												</span>
											{/if}
										</div>

										<!-- Conflict Notice -->
										{#if w.otherProjectConflict}
											<p class="text-[10px] text-red-600 font-semibold mt-0.5 flex items-center gap-1">
												<IconAlertTriangle size={11} /> Sudah absen di proyek: {w.otherProjectConflict.name}
											</p>
										{/if}
									</div>
								</div>

								<!-- Status Selector Buttons -->
								<div class="flex items-center gap-1 flex-wrap self-end sm:self-center">
									<button
										type="button"
										onclick={() => setWorkerStatus(w, 'hadir')}
										class="px-2 py-1 rounded-lg text-[11px] font-semibold transition {w.status === 'hadir' ? 'bg-emerald-600 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}"
									>
										Hadir (8j)
									</button>
									<button
										type="button"
										onclick={() => setWorkerStatus(w, 'setengah_hari')}
										class="px-2 py-1 rounded-lg text-[11px] font-semibold transition {w.status === 'setengah_hari' ? 'bg-sky-600 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}"
									>
										½ Hari (4j)
									</button>
									<button
										type="button"
										onclick={() => setWorkerStatus(w, 'standby')}
										class="px-2 py-1 rounded-lg text-[11px] font-semibold transition {w.status === 'standby' ? 'bg-amber-500 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}"
									>
										Standby
									</button>
									<button
										type="button"
										onclick={() => setWorkerStatus(w, 'izin')}
										class="px-2 py-1 rounded-lg text-[11px] font-semibold transition {w.status === 'izin' ? 'bg-purple-600 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}"
									>
										Izin
									</button>
									<button
										type="button"
										onclick={() => setWorkerStatus(w, 'sakit')}
										class="px-2 py-1 rounded-lg text-[11px] font-semibold transition {w.status === 'sakit' ? 'bg-rose-600 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}"
									>
										Sakit
									</button>
									<button
										type="button"
										onclick={() => setWorkerStatus(w, 'alpha')}
										class="px-2 py-1 rounded-lg text-[11px] font-semibold transition {w.status === 'alpha' ? 'bg-gray-700 text-white shadow-xs' : 'bg-gray-100 hover:bg-gray-200 text-gray-700'}"
									>
										Alpha
									</button>
								</div>
							</div>

							<!-- Fine-tuning Jam Kerja & Lembur if Hadir -->
							{#if isPresent}
								<div class="mt-2.5 pt-2 border-t border-emerald-100 flex flex-wrap items-center justify-between gap-2 text-xs">
									<div class="flex items-center gap-1.5">
										<span class="text-[11px] text-gray-600 font-medium">Jam Normal:</span>
										<div class="flex items-center border border-gray-200 rounded-lg bg-white overflow-hidden">
											<button
												type="button"
												onclick={() => stepJam(w, -1)}
												class="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100"
											>
												<IconMinus size={11} />
											</button>
											<input
												type="number"
												bind:value={w.jam}
												min="0"
												max="24"
												step="0.5"
												class="w-10 h-6 text-center font-bold bg-transparent border-x border-gray-200 text-gray-800 text-xs focus:outline-none"
											/>
											<button
												type="button"
												onclick={() => stepJam(w, 1)}
												class="w-6 h-6 flex items-center justify-center text-gray-500 hover:bg-gray-100"
											>
												<IconPlus size={11} />
											</button>
										</div>
										<span class="text-[10px] text-gray-500">jam</span>
									</div>

									<div class="flex items-center gap-1.5">
										<span class="text-[11px] text-gray-600 font-medium">Lembur:</span>
										<input
											type="number"
											bind:value={w.ot_hours}
											min="0"
											max="24"
											step="0.5"
											class="w-12 h-6 px-1 text-center font-bold border border-gray-200 rounded-lg bg-white text-gray-800 text-xs focus:outline-none"
										/>
										<div class="flex items-center gap-0.5">
											{#each [1, 2, 3, 4] as otVal}
												<button
													type="button"
													onclick={() => setOtPreset(w, otVal)}
													class="h-6 px-1.5 rounded text-[10px] font-bold transition {w.ot_hours === otVal ? 'bg-amber-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-amber-100'}"
												>
													+{otVal}j
												</button>
											{/each}
										</div>
									</div>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<!-- ─── SINGLE WORKER DETAILED MODE ─── -->
				<div class="grid grid-cols-2 gap-3">
					<div class="col-span-2">
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tanggal</label>
						<input type="date" bind:value={form.tanggal} class="w-full text-xs border border-gray-200 rounded-lg p-2 bg-gray-50" />
					</div>

					<div class="col-span-2">
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Pekerja</label>
						<select bind:value={form.assignmentId} class="w-full text-xs border border-gray-200 rounded-lg p-2 bg-gray-50">
							<option value="">-- Pilih Pekerja --</option>
							{#each activeAssignments as a}
								<option value={a.id}>{a.manpower_id?.nama || `#${a.manpower_id}`} {a.jabatan ? `— ${a.jabatan}` : ''}</option>
							{/each}
						</select>
					</div>

					<div class="col-span-2">
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Shift Kerja *</label>
						<select bind:value={form.shift} class="w-full text-xs border border-gray-200 rounded-lg p-2 bg-gray-50 font-semibold text-gray-700">
							{#each SHIFT_OPTIONS as s}
								<option value={s.value}>{s.label}</option>
							{/each}
						</select>
					</div>

					<div>
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Jam Normal (IN)</label>
						<input type="number" bind:value={form.jam} min="0" step="0.5" disabled={form.is_standby} 
							class="w-full text-xs border border-gray-200 rounded-lg p-2 bg-gray-50 disabled:opacity-50" />
					</div>
					<div>
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Jam Lembur (OT)</label>
						<input type="number" bind:value={form.ot_hours} min="0" step="0.5" disabled={form.is_standby} 
							class="w-full text-xs border border-gray-200 rounded-lg p-2 bg-gray-50 disabled:opacity-50" />
					</div>

					<div class="col-span-2 border rounded-xl p-3 border-gray-200 mt-1">
						<div class="flex flex-col gap-2.5">
							<label class="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
								<input type="checkbox" bind:checked={form.is_holiday} class="w-4 h-4 rounded border-gray-300 text-emerald-600" />
								Hari Libur (Rate IN 1.5x)
							</label>
							<div class="flex gap-5">
								<label class="flex items-center gap-2 text-[13px] text-gray-700 cursor-pointer">
									<input type="checkbox" bind:checked={form.is_standby} 
										onchange={() => {
											if (form.is_standby) {
												form.jam = 0;
												form.ot_hours = 0;
											} else {
												form.jam = 8;
											}
										}}
										class="w-4 h-4 rounded border-gray-300 text-emerald-600" />
									Standby (SB)
								</label>
							</div>
						</div>
					</div>

					<div class="col-span-2">
						<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Catatan</label>
						<input type="text" bind:value={form.notes} class="w-full text-xs border border-gray-200 rounded-lg p-2 bg-gray-50" placeholder="Keterangan pekerjaan..." />
					</div>
				</div>
			{/if}
		</div>

		<!-- Modal Footer -->
		<div class="p-3.5 sm:p-4 border-t border-gray-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gray-50/70">
			<!-- Summary Counter (Bulk mode) -->
			{#if activeTab === 'bulk'}
				<div class="flex items-center gap-1.5 flex-wrap text-[11px] text-gray-600">
					<span class="px-2 py-0.5 rounded-full bg-gray-200 font-semibold">Total: {bulkCounts.total}</span>
					<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-semibold">Hadir: {bulkCounts.hadir + bulkCounts.setengah}</span>
					<span class="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-semibold">Standby: {bulkCounts.standby}</span>
					<span class="px-2 py-0.5 rounded-full bg-purple-100 text-purple-800 font-semibold">Absen: {bulkCounts.absen}</span>
				</div>
			{:else}
				<div></div>
			{/if}

			<div class="flex items-center gap-2 justify-end">
				<button
					type="button"
					class="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 transition-colors shadow-xs"
					onclick={onClose}
				>
					Batal
				</button>

				{#if activeTab === 'bulk'}
					<button
						type="button"
						class="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50 shadow-xs"
						onclick={handleBulkSubmit}
						disabled={saving || (!fotoFile && !fotoUploadId) || bulkWorkers.filter(w => w.status !== '').length === 0}
					>
						{#if saving}
							<IconLoader2 size={16} class="animate-spin" /> {isUploadingFoto ? 'Mengunggah Foto...' : 'Menyimpan Presensi...'}
						{:else}
							<IconDeviceFloppy size={16} /> Simpan Presensi Tim ({bulkWorkers.filter(w => w.status !== '').length})
						{/if}
					</button>
				{:else}
					<button
						type="button"
						class="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-emerald-600 hover:bg-emerald-700 transition-colors flex items-center gap-2 disabled:opacity-50 shadow-xs"
						onclick={handleSingleSubmit}
						disabled={saving || !form.assignmentId}
					>
						{#if saving}
							<IconLoader2 size={16} class="animate-spin" /> Menyimpan...
						{:else}
							<IconCheck size={16} /> Simpan Data
						{/if}
					</button>
				{/if}
			</div>
		</div>
	</div>
</div>
