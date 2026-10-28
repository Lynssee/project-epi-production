<!-- src/routes/(app)/proyek/[project_id]/dokumentasi-ba/+page.svelte -->
<!-- Fase 6 (Foto Before/After per Subtask, Gate Keras Disiplin Data & Laporan Harian,
     17 Sep 2026). Hanya subtask yang SUDAH DIMULAI (actual > 0, keputusan user) yang
     wajib didokumentasikan. Satu subtask boleh punya BANYAK kunjungan (keputusan user
     17 Sep 2026) — bukan 1 pasang before/after seumur proyek. Kamera langsung (bukan
     galeri) + watermark GPS, infrastruktur sudah ada di laporan harian. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { onMount } from 'svelte';
	import { getProjectById } from '$lib/services/projects';
	import { uploadFile } from '$lib/services/reports';
	import {
		getSubtaskDocumentationForProject,
		createSubtaskDocumentationBefore,
		completeSubtaskDocumentationAfter,
		type SubtaskDocumentationRow
	} from '$lib/services/subtaskDocumentationApi';
	import { getCurrentPosition, type DevicePosition } from '$lib/utils/geoClient';
	import { watermarkPhoto, compressImageFile } from '$lib/utils/photoWatermark';
	import { authStore } from '$lib/stores/auth';
	import { get } from 'svelte/store';
	import { IconArrowLeft, IconCamera, IconCheck, IconClock } from '@tabler/icons-svelte';

	const projectId = $page.params.project_id;

	let loading = $state(true);
	let project = $state<any>(null);
	let subtasks = $state<{ task_index: number; subtask_index: number; name: string; actualPct: number }[]>([]);
	let docsBySubtask = $state<Map<string, SubtaskDocumentationRow[]>>(new Map());
	let position: DevicePosition | null = null;
	let uploadingKey: string | null = null; // `${task_index}.${subtask_index}` atau `${docId}-after`

	function subKey(taskIndex: number, subtaskIndex: number) {
		return `${taskIndex}.${subtaskIndex}`;
	}

	function parseTimeline(raw: any) {
		if (!raw) return null;
		if (typeof raw === 'string') {
			try { return JSON.parse(raw); } catch { return null; }
		}
		return raw;
	}

	async function stampOrCompress(file: File): Promise<File> {
		if (!position) {
			try { return await compressImageFile(file); } catch { return file; }
		}
		try {
			return await watermarkPhoto(file, { lat: position.lat, lng: position.lng, accuracy: position.accuracy });
		} catch {
			try { return await compressImageFile(file); } catch { return file; }
		}
	}

	async function load() {
		loading = true;
		try {
			const [proj, docs] = await Promise.all([
				getProjectById(projectId),
				getSubtaskDocumentationForProject(projectId)
			]);
			project = proj;

			const planning = parseTimeline(proj?.timeline_planning);
			const categories = planning?.categories || [];
			const started: typeof subtasks = [];
			categories.forEach((cat: any, ci: number) => {
				(cat.subtasks || []).forEach((sub: any, si: number) => {
					const actualVolume = Object.values(sub.daily_actual || {}).reduce((s: number, v: any) => s + (parseFloat(v) || 0), 0);
					if (actualVolume <= 0) return;
					const subVol = parseFloat(sub.volume) || 0;
					const pct = subVol > 0 ? Math.min(100, Math.round((actualVolume / subVol) * 100)) : (actualVolume > 0 ? 100 : 0);
					started.push({ task_index: ci, subtask_index: si, name: sub.name || sub.pekerjaan || sub.activity || `Subtask ${ci}.${si}`, actualPct: pct });
				});
			});
			subtasks = started;

			const grouped = new Map<string, SubtaskDocumentationRow[]>();
			for (const d of docs) {
				const k = subKey(d.task_index, d.subtask_index);
				if (!grouped.has(k)) grouped.set(k, []);
				grouped.get(k)!.push(d);
			}
			docsBySubtask = grouped;
		} catch (e) {
			console.error('Gagal memuat dokumentasi before/after:', e);
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		getCurrentPosition().then((pos) => { position = pos; }).catch(() => {});
		load();
	});

	function subtaskStatus(k: string): 'none' | 'partial' | 'complete' {
		const rows = docsBySubtask.get(k) || [];
		if (rows.some((r) => r.status === 'complete')) return 'complete';
		if (rows.length > 0) return 'partial';
		return 'none';
	}

	async function handleBeforePhoto(sub: (typeof subtasks)[number], event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const key = subKey(sub.task_index, sub.subtask_index);
		uploadingKey = key;
		try {
			const stamped = await stampOrCompress(file);
			const uploaded = await uploadFile(stamped);
			const fileId = (uploaded as any)?.id || (uploaded as any)?.data?.id;
			if (!fileId) throw new Error('Upload foto gagal — tidak ada ID file.');
			const { karyawanId } = get(authStore);
			const created = await createSubtaskDocumentationBefore({
				project_id: Number(projectId),
				task_index: sub.task_index,
				subtask_index: sub.subtask_index,
				subtask_name: sub.name,
				progress_snapshot: sub.actualPct,
				foto_before: fileId,
				foto_before_gps: position ? { lat: position.lat, lng: position.lng } : null,
				uploaded_by: (karyawanId as any) || null
			});
			if (created) {
				const list = docsBySubtask.get(key) || [];
				docsBySubtask.set(key, [created as any, ...list]);
				docsBySubtask = new Map(docsBySubtask);
			}
		} catch (e: any) {
			alert(e?.message || 'Gagal mengunggah foto before.');
		} finally {
			uploadingKey = null;
			input.value = '';
		}
	}

	async function handleAfterPhoto(docId: number, key: string, event: Event) {
		const input = event.target as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;
		const busyKey = `${docId}-after`;
		uploadingKey = busyKey;
		try {
			const stamped = await stampOrCompress(file);
			const uploaded = await uploadFile(stamped);
			const fileId = (uploaded as any)?.id || (uploaded as any)?.data?.id;
			if (!fileId) throw new Error('Upload foto gagal — tidak ada ID file.');
			const gps = position ? { lat: position.lat, lng: position.lng } : null;
			const updated = await completeSubtaskDocumentationAfter(docId, fileId, gps);
			if (updated) {
				const list = (docsBySubtask.get(key) || []).map((r) => (r.id === docId ? { ...r, ...(updated as any) } : r));
				docsBySubtask.set(key, list);
				docsBySubtask = new Map(docsBySubtask);
			}
		} catch (e: any) {
			alert(e?.message || 'Gagal mengunggah foto after.');
		} finally {
			uploadingKey = null;
			input.value = '';
		}
	}

	let summary = $derived.by(() => {
		const total = subtasks.length;
		const complete = subtasks.filter((s) => subtaskStatus(subKey(s.task_index, s.subtask_index)) === 'complete').length;
		return { total, complete };
	});
</script>

<svelte:head><title>Dokumentasi Before/After — {project?.name || 'Proyek'}</title></svelte:head>

<div class="max-w-2xl mx-auto px-4 py-5 pb-24">
	<div class="flex items-center gap-2 mb-3">
		<a href="/proyek/{projectId}" class="p-2 -ml-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800">
			<IconArrowLeft size={20} />
		</a>
		<div>
			<h1 class="text-lg font-bold text-slate-800 dark:text-slate-100">Dokumentasi Before/After</h1>
			<p class="text-xs text-slate-500 dark:text-slate-400">{project?.name || ''}</p>
		</div>
	</div>

	<p class="text-xs text-slate-500 dark:text-slate-400 mb-4">
		Hanya pekerjaan yang SUDAH DIMULAI yang wajib didokumentasikan. Satu pekerjaan boleh punya beberapa kunjungan — tekan "+ Tambah Kunjungan" tiap kali ada progres baru yang signifikan. Foto diambil langsung dari kamera (bukan galeri) supaya tidak ada foto lama yang diunggah ulang.
	</p>

	{#if !loading && summary.total > 0}
		<div class="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 mb-4 flex items-center justify-between">
			<span class="text-xs font-semibold text-slate-600 dark:text-slate-300">Kelengkapan Dokumentasi</span>
			<span class="text-sm font-black {summary.complete === summary.total ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}">
				{summary.complete}/{summary.total} pekerjaan
			</span>
		</div>
	{/if}

	{#if loading}
		<div class="flex flex-col items-center justify-center py-14">
		<CircularProgressGauge size={54} strokeWidth={4} label="Memuat dokumentasi berita acara..." />
	</div>
	{:else if subtasks.length === 0}
		<div class="text-center py-10 text-slate-400 text-sm">Belum ada pekerjaan yang dimulai di timeline proyek ini.</div>
	{:else}
		<div class="space-y-3">
			{#each subtasks as sub (subKey(sub.task_index, sub.subtask_index))}
				{@const key = subKey(sub.task_index, sub.subtask_index)}
				{@const st = subtaskStatus(key)}
				{@const rows = docsBySubtask.get(key) || []}
				<div class="rounded-xl border p-4 {st === 'complete' ? 'border-emerald-300 bg-emerald-50 dark:border-emerald-800/60 dark:bg-emerald-950/20' : st === 'partial' ? 'border-amber-300 bg-amber-50 dark:border-amber-800/60 dark:bg-amber-950/20' : 'border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900'}">
					<div class="flex items-center justify-between gap-2">
						<div>
							<p class="text-sm font-semibold text-slate-800 dark:text-slate-100">{sub.name}</p>
							<p class="text-[11px] text-slate-500 dark:text-slate-400">Progres: {sub.actualPct}%</p>
						</div>
						<span class="shrink-0 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase {st === 'complete' ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : st === 'partial' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300' : 'bg-slate-500/15 text-slate-600 dark:text-slate-300'}">
							{#if st === 'complete'}<IconCheck size={12} /> Lengkap{:else if st === 'partial'}<IconClock size={12} /> Hanya Before{:else}Belum ada{/if}
						</span>
					</div>

					{#if rows.length > 0}
						<div class="mt-3 space-y-2">
							{#each rows as r (r.id)}
								<div class="flex items-center gap-2 bg-white/70 dark:bg-black/20 rounded-lg p-2">
									<span class="text-[10px] text-slate-400 shrink-0 w-16">{r.date_created ? new Date(r.date_created).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : ''}</span>
									<span class="text-[10px] px-1.5 py-0.5 rounded {r.status === 'complete' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}">
										{r.status === 'complete' ? 'Before+After' : 'Before saja'}
									</span>
									{#if r.status === 'before_only' && r.id}
										<label class="ml-auto text-[11px] px-2 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer">
											{uploadingKey === `${r.id}-after` ? 'Mengunggah…' : 'Ambil Foto After'}
											<input type="file" accept="image/*" capture="environment" class="hidden" disabled={uploadingKey !== null} onchange={(e) => handleAfterPhoto(r.id!, key, e)} />
										</label>
									{/if}
								</div>
							{/each}
						</div>
					{/if}

					<label class="mt-3 flex items-center justify-center gap-1.5 w-full py-2 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
						<IconCamera size={14} />
						{uploadingKey === key ? 'Mengunggah…' : '+ Tambah Kunjungan (Foto Before)'}
						<input type="file" accept="image/*" capture="environment" class="hidden" disabled={uploadingKey !== null} onchange={(e) => handleBeforePhoto(sub, e)} />
					</label>
				</div>
			{/each}
		</div>
	{/if}
</div>
