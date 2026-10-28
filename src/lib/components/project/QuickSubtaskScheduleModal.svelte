<!-- src/lib/components/project/QuickSubtaskScheduleModal.svelte -->
<!-- Modal Quick Auto-Schedule: Membantu tim lapangan menentukan tanggal mulai & selesai
     serta membagi rata daily_plan subtask secara instan tanpa harus keluar dari form Laporan. -->
<script lang="ts">
	import {
		IconCalendar, IconClock, IconUser, IconCheck, IconX,
		IconLoader2, IconSparkles, IconAlertTriangle
	} from '@tabler/icons-svelte';
	import { autoDistributePlanVolume } from '$lib/utils/timelineDisiplin.js';
	import { updateProject } from '$lib/services/projects';

	let {
		open = false,
		subtask = null,
		project = null,
		onSaved,
		onClose
	}: {
		open: boolean;
		subtask: any;
		project: any;
		onSaved: (updatedSubtask: any) => void;
		onClose: () => void;
	} = $props();

	const todayStr = new Date().toISOString().slice(0, 10);

	let startDate = $state(todayStr);
	let endDate = $state('');
	let picName = $state('');
	let isSaving = $state(false);
	let errorMessage = $state('');

	// Inisialisasi tanggal default saat subtask berubah atau modal dibuka
	$effect(() => {
		if (open && subtask) {
			const subStart = subtask.start_date || subtask.start;
			const subEnd = subtask.end_date || subtask.end;
			startDate = subStart ? String(subStart).slice(0, 10) : todayStr;

			if (subEnd) {
				endDate = String(subEnd).slice(0, 10);
			} else {
				// Default 3 hari ke depan dari start date
				const d = new Date(startDate);
				d.setDate(d.getDate() + 2);
				endDate = d.toISOString().slice(0, 10);
			}

			picName = subtask.pic || subtask.mandor || '';
			errorMessage = '';
		}
	});

	// Hitung pembagian volume rencana secara reaktif
	let distributionPreview = $derived.by(() => {
		const vol = parseFloat(subtask?.volume || subtask?.target_qty || 0);
		if (vol <= 0 || !startDate || !endDate) {
			return { dailyMap: {}, workDays: 0, perDay: 0, total: 0 };
		}
		const dailyMap = autoDistributePlanVolume(vol, startDate, endDate);
		const days = Object.keys(dailyMap).length;
		const perDay = days > 0 ? (vol / days).toFixed(2) : '0';
		return { dailyMap, workDays: days, perDay, total: vol };
	});

	async function handleSaveSchedule() {
		if (!subtask || !project?.id) return;
		if (!startDate || !endDate) {
			errorMessage = 'Harap tentukan tanggal mulai dan tanggal selesai.';
			return;
		}
		if (startDate > endDate) {
			errorMessage = 'Tanggal mulai tidak boleh lebih lambat dari tanggal selesai.';
			return;
		}

		isSaving = true;
		errorMessage = '';

		try {
			let rawPlanning = project.timeline_planning;
			let planningObj: any = null;
			if (typeof rawPlanning === 'string') {
				try { planningObj = JSON.parse(rawPlanning); } catch { planningObj = null; }
			} else if (rawPlanning && typeof rawPlanning === 'object') {
				planningObj = JSON.parse(JSON.stringify(rawPlanning));
			}

			if (!planningObj || !Array.isArray(planningObj.categories)) {
				throw new Error('Data perencanaan timeline proyek tidak ditemukan.');
			}

			const vol = parseFloat(subtask.volume || subtask.target_qty || 0);
			const newDailyPlan = autoDistributePlanVolume(vol, startDate, endDate);

			let found = false;
			for (const cat of planningObj.categories) {
				for (const s of (cat.subtasks || [])) {
					if (String(s.id) === String(subtask.id)) {
						s.daily_plan = newDailyPlan;
						s.start_date = startDate;
						s.end_date = endDate;
						if (picName && picName.trim()) {
							s.pic = picName.trim();
						}
						found = true;
						break;
					}
				}
				if (found) break;
			}

			if (!found) {
				throw new Error('Subtask tidak ditemukan dalam struktur timeline proyek.');
			}

			// Simpan perubahan ke Directus
			const updatedPlanningString = JSON.stringify(planningObj);
			const updateRes = await updateProject(project.id, {
				timeline_planning: updatedPlanningString
			});

			if (!updateRes) {
				throw new Error('Gagal menyimpan pembaruan ke server Directus.');
			}

			// Perbarui objek lokal agar reaktif di UI
			project.timeline_planning = updatedPlanningString;
			subtask.daily_plan = newDailyPlan;
			subtask.start_date = startDate;
			subtask.end_date = endDate;
			if (picName && picName.trim()) {
				subtask.pic = picName.trim();
			}

			onSaved(subtask);
			onClose();
		} catch (err: any) {
			console.error('[QuickSubtaskScheduleModal] Gagal simpan:', err);
			errorMessage = err.message || 'Terjadi kesalahan saat menyimpan jadwal.';
		} finally {
			isSaving = false;
		}
	}
</script>

{#if open && subtask}
	<div class="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
		<div
			class="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150"
			role="dialog"
			aria-modal="true"
		>
			<!-- Header Modal -->
			<div class="p-4 border-b border-gray-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/70 dark:bg-slate-950/40">
				<div class="flex items-center gap-2">
					<div class="p-2 rounded-xl bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400">
						<IconCalendar size={18} />
					</div>
					<div>
						<h3 class="text-sm font-bold text-gray-900 dark:text-white leading-tight">Tentukan Jadwal Subtask</h3>
						<p class="text-[11px] text-gray-500 dark:text-slate-400">Quick Auto-Schedule untuk Linimasa & Kurva S</p>
					</div>
				</div>
				<button
					type="button"
					class="p-1 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-slate-300 transition-colors"
					onclick={onClose}
					disabled={isSaving}
				>
					<IconX size={18} />
				</button>
			</div>

			<!-- Body Modal -->
			<div class="p-4 space-y-4 text-xs">
				<!-- Ringkasan Info Subtask -->
				<div class="p-3 rounded-xl bg-gray-50 dark:bg-slate-850 border border-gray-200/60 dark:border-slate-800 space-y-1">
					<span class="text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-slate-500 block">Aktivitas / Pekerjaan</span>
					<div class="text-sm font-black text-gray-900 dark:text-white">{subtask.name || subtask.activity || 'Subtask'}</div>
					<div class="flex items-center gap-2 text-[11px] text-gray-600 dark:text-slate-400 pt-0.5">
						<span>Target Volume: <strong class="text-gray-900 dark:text-white">{subtask.volume ?? subtask.target_qty ?? 0} {subtask.unit || 'm²'}</strong></span>
					</div>
				</div>

				{#if errorMessage}
					<div class="p-3 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800/60 text-red-700 dark:text-red-300 flex items-start gap-2">
						<IconAlertTriangle size={15} class="shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
						<span>{errorMessage}</span>
					</div>
				{/if}

				<!-- Form Input Tanggal -->
				<div class="grid grid-cols-2 gap-3">
					<div>
						<label class="block text-[11px] font-bold text-gray-700 dark:text-slate-300 mb-1">
							Tanggal Mulai <span class="text-red-500">*</span>
						</label>
						<input
							type="date"
							class="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl font-medium text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
							bind:value={startDate}
							disabled={isSaving}
						/>
					</div>
					<div>
						<label class="block text-[11px] font-bold text-gray-700 dark:text-slate-300 mb-1">
							Tanggal Selesai <span class="text-red-500">*</span>
						</label>
						<input
							type="date"
							class="w-full px-3 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl font-medium text-gray-900 dark:text-white text-xs focus:ring-2 focus:ring-amber-500 focus:outline-none"
							bind:value={endDate}
							disabled={isSaving}
						/>
					</div>
				</div>

				<!-- Form Input PIC / Mandor -->
				<div>
					<label class="block text-[11px] font-bold text-gray-700 dark:text-slate-300 mb-1">
						Nama PIC / Mandor Penanggung Jawab
					</label>
					<div class="relative">
						<span class="absolute left-3 top-2.5 text-gray-400 dark:text-slate-500 pointer-events-none">
							<IconUser size={14} />
						</span>
						<input
							type="text"
							class="w-full pl-8 pr-3 py-2 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-700 rounded-xl text-gray-900 dark:text-white text-xs placeholder:text-gray-400 dark:placeholder:text-slate-500 focus:ring-2 focus:ring-amber-500 focus:outline-none"
							placeholder="Contoh: Ridho Akbar / Mandor Asep"
							bind:value={picName}
							disabled={isSaving}
						/>
					</div>
				</div>

				<!-- Kartu Pratinjau Alokasi Harian Otomatis -->
				{#if distributionPreview.workDays > 0}
					<div class="p-3 rounded-xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200/80 dark:border-amber-900/40 space-y-2">
						<div class="flex items-center justify-between text-amber-900 dark:text-amber-200 font-bold">
							<span class="flex items-center gap-1.5">
								<IconSparkles size={14} class="text-amber-600 dark:text-amber-400" />
								<span>Estimasi Alokasi Otomatis</span>
							</span>
							<span class="font-mono text-[11px]">{distributionPreview.workDays} Hari Kerja</span>
						</div>
						<div class="text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
							Volume rata-rata per hari kerja: <strong>{distributionPreview.perDay} {subtask.unit || 'm²'}/hari</strong>.
							Hari Minggu secara otomatis dilewati dari jadwal rencana kerja.
						</div>
					</div>
				{/if}
			</div>

			<!-- Footer Modal -->
			<div class="p-4 border-t border-gray-100 dark:border-slate-800 flex items-center justify-end gap-2 bg-slate-50/50 dark:bg-slate-950/30">
				<button
					type="button"
					class="px-4 py-2 rounded-xl text-xs font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-800 transition-colors"
					onclick={onClose}
					disabled={isSaving}
				>
					Batal
				</button>
				<button
					type="button"
					class="px-4 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
					onclick={handleSaveSchedule}
					disabled={isSaving}
				>
					{#if isSaving}
						<IconLoader2 size={14} class="animate-spin" />
						<span>Menyimpan...</span>
					{:else}
						<IconCheck size={14} />
						<span>Simpan Jadwal ke Timeline</span>
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
