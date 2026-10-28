<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import {
		IconArrowLeft, IconLoader2, IconSearch, IconX,
		IconHelmet, IconUser, IconMapPin, IconPhone,
		IconId, IconCurrencyDollar, IconTag, IconHash,
		IconChevronDown, IconChevronUp, IconUsers,
		IconBuilding, IconClockPlus, IconStar, IconTools,
		IconBrandWhatsapp, IconCopy, IconCheck, IconBriefcase,
		IconPhoneCall, IconBadge
	} from '@tabler/icons-svelte';
	import { getAllManpower, getManpowerByIds, type Manpower } from '$lib/services/manpower';
	import { getProjects } from '$lib/services/projects';
	import { getProjectsForCurrentUser, getProjectScope } from '$lib/services/projectScope';
	import { getBatchedReports } from '$lib/services/reports';
	import FilterSort from '$lib/components/FilterSort.svelte';
	import { authStore } from '$lib/stores/auth';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import {
		getSkillsForManpower, getActiveSkillMaster, getManpowerIdsBySkill, levelLabel,
		type ManpowerSkillView
	} from '$lib/services/manpowerSkillView';
	import { getManpowerWidgetData, type ManpowerWidgetData } from '$lib/services/manpowerCommandWidget';
	import { createManpowerDokumen, MANPOWER_JENIS_DOKUMEN } from '$lib/services/manpower';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { compressPhoto } from '$lib/utils/photoCompress';
	import {
		enqueueManpowerDokumen, registerManpowerDokumenAutoFlush, flushManpowerDokumenQueue,
		type QueuedManpowerDokumen
	} from '$lib/utils/offlineManpowerDokumenQueue';
	import { IconCamera } from '@tabler/icons-svelte';

	interface ProjectGroup {
		projectId: string | number;
		projectName: string;
		leaderName: string;
		manpowers: Manpower[];
		harianCount: number;
		boronganCount: number;
	}

	let loading = $state(true);
	let searchQuery = $state('');
	let activeStatus = $state('');
	let expandedId = $state<number | null>(null);
	let expandedGroups = $state<Record<string, boolean>>({});
	let copiedKey = $state<string | null>(null);

	let allManpower = $state<Manpower[]>([]);
	let rateTipeByManpower = $state<Record<number, string>>({});
	let groupedManpower = $state<ProjectGroup[]>([]);
	let unassignedManpower = $state<Manpower[]>([]);

	// ── Skill Matrix (read-only, Fase 2 Manpower v2) ──
	let skillOptions = $state<{ id: number; nama: string }[]>([]);
	let skillFilter = $state('');
	let skillManpowerIds = $state<Set<number> | null>(null);
	let skillsByManpower = $state<Record<number, ManpowerSkillView[]>>({});
	let skillsLoadingId = $state<number | null>(null);

	// Derived metrics for hero section
	let statsSummary = $derived({
		total: Array.isArray(allManpower) ? allManpower.filter(Boolean).length : 0,
		harian: Object.values(rateTipeByManpower || {}).filter(v => v === 'harian').length,
		borongan: Object.values(rateTipeByManpower || {}).filter(v => v === 'borongan').length,
		proyekAktif: Array.isArray(groupedManpower) ? groupedManpower.filter(Boolean).length : 0
	});

	async function loadSkillOptions() {
		try {
			skillOptions = (await getActiveSkillMaster()) || [];
		} catch {
			skillOptions = [];
		}
	}

	async function handleSkillFilterChange() {
		try {
			skillManpowerIds = skillFilter ? await getManpowerIdsBySkill(Number(skillFilter)) : null;
			await loadManpower();
		} catch (err) {
			console.error('Error on skill filter change:', err);
		}
	}

	// ── Widget utilization & alert sertifikasi (Fase 5) — ditaruh di halaman
	// ini, bukan Command Center generik yang berbasis divisi (bukan proyek).
	let widgetData = $state<ManpowerWidgetData | null>(null);

	async function loadWidget() {
		try {
			const validIds = (allManpower || []).filter((m) => m && m.id != null).map((m) => m.id);
			widgetData = await getManpowerWidgetData(validIds);
		} catch (err) {
			console.warn('Gagal memuat widget manpower:', err);
		}
	}

	async function ensureSkillsLoaded(id: number) {
		if (!id || skillsByManpower[id]) return;
		skillsLoadingId = id;
		try {
			const loaded = await getSkillsForManpower(id);
			skillsByManpower = { ...skillsByManpower, [id]: loaded || [] };
		} catch {
			skillsByManpower = { ...skillsByManpower, [id]: [] };
		} finally {
			skillsLoadingId = null;
		}
	}

	let mpSort = $state('nama');

	const mpSorts = [
		{ value: 'nama', label: 'Nama (A-Z)' },
		{ value: '-nama', label: 'Nama (Z-A)' },
		{ value: 'posisi', label: 'Posisi' },
		{ value: 'domisili', label: 'Domisili' }
	];

	const statusOptions = [
		{ value: '', label: 'Semua Status' },
		{ value: 'borongan', label: 'Borongan' },
		{ value: 'harian', label: 'Harian' }
	];

	async function loadManpower() {
		loading = true;
		try {
			const options = {
				limit: 2000,
				search: searchQuery,
				sort: mpSort
			};

			const needsLeaderFilter = !getProjectScope().unrestricted;

			let activeProjects: any[] = [];
			let results: Manpower[] = [];
			const projectWorkers = new Map<string | number, Set<number>>();
			const rateTipeMap = new Map<number, string>();

			if (needsLeaderFilter) {
				const userProjects = await getProjectsForCurrentUser(true);
				activeProjects = Array.isArray(userProjects) ? userProjects.filter(p => p && p.id != null) : [];
				const projectIds = activeProjects.map((p: any) => p.id);
				
				for (const p of activeProjects) {
					projectWorkers.set(p.id, new Set());
				}

				if (projectIds.length > 0) {
					// 1. Fetch official assignments
					let assignments: any[] = [];
					try {
						assignments = await directus.request(
							readItems('manpower_assignment', {
								filter: {
									project_id: { _in: projectIds }
								},
								fields: ['id', 'manpower_id.id', 'project_id.id', 'status', 'rate_tipe'],
								limit: -1
							})
						);
					} catch (err) {
						console.error('Failed to load assignments', err);
					}

					const safeAssignments = Array.isArray(assignments) ? assignments.filter(Boolean) : [];
					for (const a of safeAssignments) {
						if (!a) continue;
						const mId = typeof a.manpower_id === 'object' ? a.manpower_id?.id : a.manpower_id;
						const pId = typeof a.project_id === 'object' ? a.project_id?.id : a.project_id;
						if (mId && pId && projectWorkers.has(pId)) {
							projectWorkers.get(pId)!.add(Number(mId));
						}
						if (mId && a.rate_tipe && (a.status === 'aktif' || !rateTipeMap.has(Number(mId)))) {
							rateTipeMap.set(Number(mId), a.rate_tipe);
						}
					}

					// 2. Fetch daily reports
					const reports = await getBatchedReports(projectIds);
					const safeReports = Array.isArray(reports) ? reports.filter(Boolean) : [];
					for (const report of safeReports) {
						if (!report) continue;
						const pId = typeof report.project_id === 'object' ? report.project_id?.id : report.project_id;
						if (!pId || !projectWorkers.has(pId)) continue;
						
						let manpowerData: any[] = [];
						try {
							const raw = typeof report.manpower === 'string'
								? JSON.parse(report.manpower)
								: (report.manpower || []);
							if (Array.isArray(raw)) {
								manpowerData = raw;
							}
						} catch {
							manpowerData = [];
						}
						
						for (const mpEntry of manpowerData) {
							if (mpEntry && typeof mpEntry === 'object') {
								const workers: any[] = Array.isArray(mpEntry.workers) ? mpEntry.workers : [];
								for (const w of workers) {
									if (w && w.id) {
										projectWorkers.get(pId)!.add(Number(w.id));
									}
								}
							}
						}
					}

					// 3. Collect all unique worker IDs under these projects
					const leaderWorkerIds = new Set<number>();
					for (const p of activeProjects) {
						const wIds = projectWorkers.get(p.id) || new Set();
						wIds.forEach(id => leaderWorkerIds.add(id));
					}

					if (leaderWorkerIds.size > 0) {
						const fetched = await getManpowerByIds(Array.from(leaderWorkerIds), options);
						results = Array.isArray(fetched) ? fetched.filter(Boolean) : [];
					}
				}
			} else {
				const [unfilteredManpower, unfilteredProjects] = await Promise.all([
					getAllManpower(options),
					getProjects(null, true)
				]);
				results = Array.isArray(unfilteredManpower) ? unfilteredManpower.filter(Boolean) : [];
				activeProjects = Array.isArray(unfilteredProjects) ? unfilteredProjects.filter(p => p && p.id != null) : [];

				for (const p of activeProjects) {
					projectWorkers.set(p.id, new Set());
				}

				const projectIds = activeProjects.map((p: any) => p.id);
				if (projectIds.length > 0) {
					// 1. Fetch official assignments
					let assignments: any[] = [];
					try {
						assignments = await directus.request(
							readItems('manpower_assignment', {
								filter: {
									project_id: { _in: projectIds }
								},
								fields: ['id', 'manpower_id.id', 'project_id.id', 'status', 'rate_tipe'],
								limit: -1
							})
						);
					} catch (err) {
						console.error('Failed to load assignments', err);
					}

					const safeAssignments = Array.isArray(assignments) ? assignments.filter(Boolean) : [];
					for (const a of safeAssignments) {
						if (!a) continue;
						const mId = typeof a.manpower_id === 'object' ? a.manpower_id?.id : a.manpower_id;
						const pId = typeof a.project_id === 'object' ? a.project_id?.id : a.project_id;
						if (mId && pId && projectWorkers.has(pId)) {
							projectWorkers.get(pId)!.add(Number(mId));
						}
						if (mId && a.rate_tipe && (a.status === 'aktif' || !rateTipeMap.has(Number(mId)))) {
							rateTipeMap.set(Number(mId), a.rate_tipe);
						}
					}

					// 2. Fetch daily reports
					const reports = await getBatchedReports(projectIds);
					const safeReports = Array.isArray(reports) ? reports.filter(Boolean) : [];
					for (const report of safeReports) {
						if (!report) continue;
						const pId = typeof report.project_id === 'object' ? report.project_id?.id : report.project_id;
						if (!pId || !projectWorkers.has(pId)) continue;
						
						let manpowerData: any[] = [];
						try {
							const raw = typeof report.manpower === 'string'
								? JSON.parse(report.manpower)
								: (report.manpower || []);
							if (Array.isArray(raw)) {
								manpowerData = raw;
							}
						} catch {
							manpowerData = [];
						}
						
						for (const mpEntry of manpowerData) {
							if (mpEntry && typeof mpEntry === 'object') {
								const workers: any[] = Array.isArray(mpEntry.workers) ? mpEntry.workers : [];
								for (const w of workers) {
									if (w && w.id) {
										projectWorkers.get(pId)!.add(Number(w.id));
									}
								}
							}
						}
					}
				}
			}

			rateTipeByManpower = Object.fromEntries(rateTipeMap);
			const safeResults = (results || []).filter((mp) => mp && mp.id != null);
			allManpower = activeStatus
				? safeResults.filter(mp => rateTipeMap.get(mp.id) === activeStatus)
				: safeResults;
			if (skillManpowerIds) {
				allManpower = allManpower.filter(mp => skillManpowerIds!.has(mp.id));
			}

			const groups: ProjectGroup[] = [];
			const assignedWorkerIds = new Set<number>();

			for (const p of activeProjects) {
				if (!p || p.id == null) continue;
				const workerIds = projectWorkers.get(p.id) || new Set();
				const pManpowers = allManpower.filter(mp => mp && workerIds.has(mp.id));
				
				if (needsLeaderFilter || pManpowers.length > 0) {
					let hCount = 0;
					let bCount = 0;
					pManpowers.forEach(mp => {
						if (!mp) return;
						assignedWorkerIds.add(mp.id);
						const rType = rateTipeMap.get(mp.id);
						if (rType === 'harian') hCount++;
						else if (rType === 'borongan') bCount++;
					});

					groups.push({
						projectId: p.id,
						projectName: p.name || 'Unknown Project',
						leaderName: p.leader || '-',
						manpowers: pManpowers,
						harianCount: hCount,
						boronganCount: bCount
					});
					expandedGroups[p.id] = true;
				}
			}

			groupedManpower = groups;
			
			if (needsLeaderFilter) {
				unassignedManpower = [];
			} else {
				unassignedManpower = allManpower.filter(mp => mp && !assignedWorkerIds.has(mp.id));
				if (unassignedManpower.length > 0) {
					expandedGroups['unassigned'] = true;
				}
			}

		} catch (e) {
			console.error('Failed to load manpower', e);
		} finally {
			loading = false;
		}
	}

	onMount(async () => {
		try {
			await loadManpower();
			await loadSkillOptions();
			await loadWidget();
		} catch (e) {
			console.error('Gagal memuat manpower:', e);
		} finally {
			loading = false;
		}

		registerManpowerDokumenAutoFlush(sendQueuedManpowerDokumen);
		flushManpowerDokumenQueue(sendQueuedManpowerDokumen).catch(() => {});
	});

	// ── Unggah Dokumen dari Lokasi (F4.4) ────────────────────────────────────────
	let uploadTarget = $state<Manpower | null>(null);
	let uploadJenis = $state('ktp');
	let uploadTanggalKedaluwarsa = $state('');
	let uploadFile = $state<File | null>(null);
	let uploading = $state(false);
	let uploadError = $state('');

	function openUploadModal(mp: Manpower) {
		uploadTarget = mp;
		uploadJenis = 'ktp';
		uploadTanggalKedaluwarsa = '';
		uploadFile = null;
		uploadError = '';
	}

	function closeUploadModal() {
		uploadTarget = null;
	}

	function onUploadFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		uploadFile = file || null;
	}

	async function sendQueuedManpowerDokumen(entry: QueuedManpowerDokumen) {
		const compressed = await compressPhoto(new File([entry.photoBlob], entry.photoName, { type: entry.photoBlob.type }));
		const fileId = await uploadEvidencePhoto(compressed, `manpower_dokumen:${entry.jenisDokumen}`);
		if (!fileId) throw new Error('Gagal mengunggah foto dokumen saat flush.');
		const created = await createManpowerDokumen({
			manpowerId: entry.manpowerId,
			jenisDokumen: entry.jenisDokumen,
			fileId,
			tanggalKedaluwarsa: entry.tanggalKedaluwarsa
		});
		if (!created) throw new Error('Gagal menyimpan dokumen saat flush.');
	}

	async function submitUploadDokumen() {
		if (!uploadTarget || !uploadFile) {
			uploadError = 'Pilih foto dokumen dulu.';
			return;
		}
		uploading = true;
		uploadError = '';
		try {
			const compressed = await compressPhoto(uploadFile);
			const fileId = await uploadEvidencePhoto(compressed, `manpower_dokumen:${uploadJenis}`);
			if (!fileId) throw new Error('Gagal mengunggah foto.');
			const created = await createManpowerDokumen({
				manpowerId: uploadTarget.id,
				jenisDokumen: uploadJenis,
				fileId,
				tanggalKedaluwarsa: uploadTanggalKedaluwarsa || null
			});
			if (!created) throw new Error('Gagal menyimpan dokumen.');
			closeUploadModal();
		} catch (err: any) {
			// Jaringan gagal (bukan validasi) — simpan offline, terkirim otomatis saat online kembali.
			if (err instanceof TypeError) {
				try {
					await enqueueManpowerDokumen({
						client_txn_id: crypto.randomUUID(),
						manpowerId: uploadTarget.id,
						manpowerNama: uploadTarget.nama || `#${uploadTarget.id}`,
						jenisDokumen: uploadJenis,
						tanggalKedaluwarsa: uploadTanggalKedaluwarsa || null,
						photoBlob: uploadFile,
						photoName: uploadFile.name || 'dokumen.jpg',
						createdAt: new Date().toISOString()
					});
					closeUploadModal();
				} catch (queueErr: any) {
					uploadError = queueErr?.message || 'Gagal menyimpan offline.';
				}
			} else {
				uploadError = err?.message || 'Gagal mengunggah dokumen.';
			}
		} finally {
			uploading = false;
		}
	}

	function toggleExpandGroup(groupId: string | number) {
		expandedGroups[groupId] = !expandedGroups[groupId];
	}

	function toggleExpand(id: number) {
		expandedId = expandedId === id ? null : id;
		if (expandedId === id) ensureSkillsLoaded(id);
	}

	function formatCurrency(value: number | null): string {
		if (value === null || value === undefined) return '-';
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: 'IDR',
			minimumFractionDigits: 0,
			maximumFractionDigits: 0
		}).format(value);
	}

	function getBreakdownBadgeClass(breakdown: string | null): string {
		if (!breakdown) return '';
		const b = breakdown.toLowerCase();
		if (b.includes('borongan')) return 'warn';
		if (b.includes('harian')) return 'ok';
		if (b.includes('bulanan')) return 'pend';
		return 'pend';
	}

	function getInitials(nama: string | null): string {
		if (!nama) return '?';
		return nama.trim().split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
	}

	function getAvatarColor(nama: string | null): string {
		if (!nama) return 'var(--g)';
		const colors = ['#1F6592', '#3B92C9', '#E0A016', '#1E9E6A', '#DC3B44', '#7C3AED'];
		const idx = nama.charCodeAt(0) % colors.length;
		return colors[idx];
	}

	function getSkillLevelBadge(level: string): { bg: string; text: string } {
		switch (level.toLowerCase()) {
			case 'expert':
				return { bg: 'rgba(124, 58, 237, 0.15)', text: '#A78BFA' };
			case 'mahir':
				return { bg: 'rgba(30, 158, 106, 0.15)', text: '#34D399' };
			case 'kompeten':
				return { bg: 'rgba(59, 130, 246, 0.15)', text: '#60A5FA' };
			default: // pemula
				return { bg: 'rgba(245, 158, 11, 0.15)', text: '#FBBF24' };
		}
	}

	function copyToClipboard(text: string, key: string) {
		if (!text) return;
		navigator.clipboard.writeText(text);
		copiedKey = key;
		setTimeout(() => {
			if (copiedKey === key) copiedKey = null;
		}, 2000);
	}

	function cleanPhoneNumber(no: string | number | null): { formatted: string; raw: string } {
		if (!no) return { formatted: '-', raw: '' };
		let str = no.toString().trim().replace(/[^0-9]/g, '');
		if (str.startsWith('8')) str = '0' + str;
		let waNum = str.startsWith('0') ? '62' + str.slice(1) : str;
		return { formatted: str, raw: waNum };
	}
</script>

<div class="flex-1 flex flex-col h-full">

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat data manpower..." />
		</div>
	{:else}
		<div class="scroll-body px-4 py-4 space-y-4">

			<!-- Hero Header Summary Card -->
			<div 
				class="p-4 rounded-2xl border transition-all duration-200" 
				style="background: var(--sys-bg2); border-color: var(--sys-sep); box-shadow: 0 2px 8px rgba(0,0,0,0.05)"
			>
				<div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
					<div class="flex items-start gap-3">
						<div class="w-11 h-11 rounded-xl bg-gradient-to-br from-[var(--g)] to-[var(--gd)] flex items-center justify-center text-white shrink-0 shadow-sm mt-0.5">
							<IconHelmet size={24} />
						</div>
						<div>
							<h2 class="text-[16px] font-bold leading-tight" style="color: var(--sys-label)">
								Daftar Manpower Lapangan
							</h2>
							<p class="text-[12px] mt-0.5" style="color: var(--sys-label3)">
								Kelola penugasan, keahlian, dan pengajuan lembur pekerja
							</p>
							
							<!-- Stat Badges Row -->
							<div class="flex flex-wrap items-center gap-2 mt-2.5">
								<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-[var(--gl)] text-[var(--g)] border border-[var(--g)]/20">
									<IconUsers size={12} />
									{statsSummary.total} Total Manpower
								</span>
								{#if statsSummary.proyekAktif > 0}
									<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
										<IconBuilding size={12} />
										{statsSummary.proyekAktif} Proyek Aktif
									</span>
								{/if}
								{#if statsSummary.harian > 0 || statsSummary.borongan > 0}
									<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium" style="background: var(--sys-fill2); color: var(--sys-label2)">
										{statsSummary.harian} Harian · {statsSummary.borongan} Borongan
									</span>
								{/if}
								{#if widgetData && widgetData.certExpiringCount > 0}
									<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
										⚠️ {widgetData.certExpiringCount} Sertifikat Kedaluwarsa ≤30 hari
									</span>
								{/if}
							</div>
						</div>
					</div>

					<!-- Quick Action Buttons -->
					<div class="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-dashed" style="border-color: var(--sys-sep)">
						<button
							onclick={() => goto('/manpower/daftar-baru')}
							class="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] bg-indigo-600 text-white shadow-sm"
						>
							<span class="text-base leading-none">＋</span>
							<span>Daftar Pekerja Baru</span>
						</button>
						<button
							onclick={() => goto('/manpower/lembur')}
							class="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] bg-[var(--gl)] text-[var(--g)] border border-[var(--g)]/20 shadow-sm"
						>
							<IconClockPlus size={16} />
							<span>Ajukan Lembur</span>
						</button>
						<button
							onclick={() => goto('/manpower/rating')}
							class="flex-1 sm:flex-initial inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] font-semibold transition-all hover:scale-[1.02] active:scale-[0.98] bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shadow-sm"
						>
							<IconStar size={16} />
							<span>Nilai Pekerja</span>
						</button>
					</div>
				</div>
			</div>

			<!-- Search, Sort & Skill Filters -->
			<div class="space-y-2.5">
				<FilterSort
					bind:searchQuery={searchQuery}
					bind:sortOption={mpSort}
					bind:filterOption={activeStatus}
					sortOptions={mpSorts}
					filterOptions={statusOptions}
					placeholder="Cari nama pekerja, posisi, domisili..."
					onSearch={() => loadManpower()}
					onSortChange={() => loadManpower()}
					onFilterChange={() => loadManpower()}
				/>

				<!-- Integrated Skill Filter Bar -->
				{#if skillOptions.length > 0}
					<div class="flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<IconTools size={16} class="shrink-0 text-[var(--g)]" />
						<select
							bind:value={skillFilter}
							onchange={handleSkillFilterChange}
							class="w-full text-[12px] font-medium bg-transparent outline-none cursor-pointer py-1"
							style="color: var(--sys-label)"
						>
							<option value="" style="background: var(--sys-bg2); color: var(--sys-label)">Filter Berdasarkan Skill (Semua Skill)</option>
							{#each skillOptions as s}
								<option value={String(s.id)} style="background: var(--sys-bg2); color: var(--sys-label)">{s.nama}</option>
							{/each}
						</select>
					</div>
				{/if}
			</div>

			<!-- List Content -->
			{#if groupedManpower.length === 0 && unassignedManpower.length === 0}
				<div class="text-center py-14 rounded-2xl border border-dashed" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
					<div class="w-14 h-14 rounded-2xl bg-[var(--gl)] flex items-center justify-center mx-auto mb-3 text-[var(--g)]">
						<IconHelmet size={28} />
					</div>
					<p class="text-[14px] font-semibold" style="color: var(--sys-label)">Tidak ada manpower ditemukan</p>
					<p class="text-[12px] mt-1" style="color: var(--sys-label3)">
						{#if searchQuery}
							Coba sesuaikan kata kunci pencarian atau reset filter.
						{:else}
							Belum ada data manpower yang terdaftar dalam proyek.
						{/if}
					</p>
				</div>
			{:else}
				
				<!-- Project Groups Accordion -->
				{#each groupedManpower as group (group.projectId)}
					<div class="rounded-2xl border overflow-hidden transition-all duration-200 shadow-sm" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<!-- Accordion Header -->
						<button 
							class="w-full flex items-center justify-between p-3.5 text-left transition-colors border-l-4 border-l-[var(--g)]"
							style="background: var(--sys-bg2)"
							onclick={() => toggleExpandGroup(group.projectId)}
						>
							<div class="flex items-center gap-3 min-w-0 pr-2">
								<div class="w-9 h-9 rounded-xl bg-[var(--gl)] flex items-center justify-center text-[var(--g)] shrink-0 font-bold">
									<IconBuilding size={20} />
								</div>
								<div class="min-w-0 flex-1">
									<h3 class="text-[13px] font-bold leading-snug truncate" style="color: var(--sys-label)">
										{group.projectName}
									</h3>
									<p class="text-[11px] font-semibold mt-0.5 flex items-center gap-1.5" style="color: var(--g)">
										<span>Leader: {group.leaderName}</span>
										{#if group.harianCount > 0 || group.boronganCount > 0}
											<span class="text-gray-300 dark:text-gray-600">·</span>
											<span class="font-normal text-[10px]" style="color: var(--sys-label3)">
												{group.harianCount > 0 ? `${group.harianCount} Harian` : ''} 
												{group.harianCount > 0 && group.boronganCount > 0 ? '· ' : ''}
												{group.boronganCount > 0 ? `${group.boronganCount} Borongan` : ''}
											</span>
										{/if}
									</p>
								</div>
							</div>
							<div class="flex items-center gap-2 shrink-0">
								<span class="text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[var(--gl)] text-[var(--g)] border border-[var(--g)]/15">
									{group.manpowers.length} Pekerja
								</span>
								<div class="p-1 rounded-lg text-gray-400 transition-transform duration-200" class:rotate-180={expandedGroups[group.projectId]}>
									<IconChevronDown size={18} />
								</div>
							</div>
						</button>

						<!-- Accordion Body -->
						{#if expandedGroups[group.projectId]}
							<div class="p-3 border-t space-y-2" style="background: var(--sys-fill); border-color: var(--sys-sep)">
								{#each group.manpowers as mp (mp.id)}
									{@render manpowerCard(mp)}
								{:else}
									<div class="p-3 text-center rounded-xl border border-dashed" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
										<p class="text-[11px]" style="color: var(--sys-label3)">Tidak ada manpower aktif ditugaskan pada proyek ini.</p>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				{/each}

				<!-- Unassigned Group Accordion -->
				{#if unassignedManpower.length > 0}
					<div class="rounded-2xl border overflow-hidden transition-all duration-200 shadow-sm" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<button 
							class="w-full flex items-center justify-between p-3.5 text-left transition-colors border-l-4 border-l-gray-400"
							style="background: var(--sys-bg2)"
							onclick={() => toggleExpandGroup('unassigned')}
						>
							<div class="flex items-center gap-3">
								<div class="w-9 h-9 rounded-xl bg-gray-500/10 flex items-center justify-center text-gray-500 shrink-0">
									<IconUser size={20} />
								</div>
								<div>
									<h3 class="text-[13px] font-bold leading-snug" style="color: var(--sys-label)">
										Belum Terhubung ke Proyek
									</h3>
									<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">Manpower mandiri / non-aktif proyek</p>
								</div>
							</div>
							<div class="flex items-center gap-2">
								<span class="text-[11px] font-semibold px-2.5 py-1 rounded-lg" style="background: var(--sys-fill2); color: var(--sys-label2)">
									{unassignedManpower.length} Pekerja
								</span>
								<div class="p-1 rounded-lg text-gray-400 transition-transform duration-200" class:rotate-180={expandedGroups['unassigned']}>
									<IconChevronDown size={18} />
								</div>
							</div>
						</button>

						{#if expandedGroups['unassigned']}
							<div class="p-3 border-t space-y-2" style="background: var(--sys-fill); border-color: var(--sys-sep)">
								{#each unassignedManpower as mp (mp.id)}
									{@render manpowerCard(mp)}
								{/each}
							</div>
						{/if}
					</div>
				{/if}

			{/if}

			<div class="h-6"></div>
		</div>
	{/if}
</div>

<!-- ── Unggah Dokumen dari Lokasi Modal (F4.4) ── -->
{#if uploadTarget}
	<div class="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/50 backdrop-blur-sm" onclick={closeUploadModal}>
		<div
			class="w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl overflow-hidden"
			style="background: var(--sys-bg)"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between p-4 border-b" style="border-color: var(--sys-sep)">
				<div>
					<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">Unggah Dokumen</h3>
					<p class="text-[11px]" style="color: var(--sys-label3)">{uploadTarget.nama}</p>
				</div>
				<button onclick={closeUploadModal} class="p-1.5 rounded-lg" style="color: var(--sys-label3)">
					<IconX size={18} />
				</button>
			</div>
			<div class="p-4 space-y-3">
				<div>
					<label class="text-[11px] font-semibold uppercase" style="color: var(--sys-label3)">Jenis Dokumen</label>
					<select bind:value={uploadJenis} class="f-select w-full mt-1">
						{#each MANPOWER_JENIS_DOKUMEN as jd}
							<option value={jd.value}>{jd.label}</option>
						{/each}
					</select>
				</div>
				<div>
					<label class="text-[11px] font-semibold uppercase" style="color: var(--sys-label3)">Tanggal Kedaluwarsa (opsional)</label>
					<input type="date" bind:value={uploadTanggalKedaluwarsa} class="f-input w-full mt-1" />
				</div>
				<div>
					<label class="text-[11px] font-semibold uppercase" style="color: var(--sys-label3)">Foto Dokumen *</label>
					<input type="file" accept="image/*" capture="environment" class="w-full mt-1 text-[12px]" onchange={onUploadFileChange} />
				</div>
				<p class="text-[10px]" style="color: var(--sys-label4)">Dokumen masuk antrean verifikasi HRD — belum otomatis terverifikasi.</p>
				{#if uploadError}
					<p class="text-[11px] text-red-500">{uploadError}</p>
				{/if}
			</div>
			<div class="p-4 border-t flex justify-end gap-2" style="border-color: var(--sys-sep)">
				<button onclick={closeUploadModal} class="px-4 py-2 text-[12px] font-semibold rounded-xl" style="background: var(--sys-fill2); color: var(--sys-label2)">Batal</button>
				<button onclick={submitUploadDokumen} disabled={uploading || !uploadFile} class="px-4 py-2 text-[12px] font-semibold rounded-xl text-white disabled:opacity-50 flex items-center gap-1.5" style="background: var(--g)">
					{#if uploading}<IconLoader2 size={14} class="animate-spin" /> Mengunggah...{:else}<IconCamera size={14} /> Unggah{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

{#snippet manpowerCard(mp: Manpower)}
	{@const phone = cleanPhoneNumber(mp.no_telpon)}
	<div 
		class="rounded-xl border transition-all duration-150 overflow-hidden" 
		style="background: var(--sys-bg2); border-color: var(--sys-sep)"
	>
		<!-- Main collapsed row -->
		<button
			class="w-full flex items-center gap-3 p-3 text-left transition-colors hover:bg-black/5 dark:hover:bg-white/5"
			onclick={() => toggleExpand(mp.id)}
		>
			<!-- Avatar -->
			<div
				class="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 text-[13px] font-bold text-white shadow-sm"
				style="background: {getAvatarColor(mp.nama)};"
			>
				{getInitials(mp.nama)}
			</div>

			<!-- Core Info -->
			<div class="flex-1 min-w-0">
				<div class="flex items-center gap-2">
					<p class="text-[13px] font-bold truncate" style="color: var(--sys-label)">
						{mp.nama || '-'}
					</p>
				</div>
				<div class="flex items-center gap-2 mt-0.5 flex-wrap">
					{#if mp.posisi}
						<p class="text-[11px] font-medium flex items-center gap-1" style="color: var(--sys-label2)">
							<IconBriefcase size={12} class="shrink-0 text-[var(--g)]" />
							<span>{mp.posisi}</span>
						</p>
					{/if}
					{#if mp.domisili}
						<span style="color: var(--sys-label4)">·</span>
						<p class="text-[11px] flex items-center gap-1" style="color: var(--sys-label3)">
							<IconMapPin size={12} class="shrink-0 text-amber-500" />
							<span>{mp.domisili}</span>
						</p>
					{/if}
				</div>
			</div>

			<!-- Right Status Badge & Toggle -->
			<div class="flex items-center gap-2.5 shrink-0">
				{#if rateTipeByManpower[mp.id]}
					<span class="badge {getBreakdownBadgeClass(rateTipeByManpower[mp.id])}">
						{rateTipeByManpower[mp.id] === 'borongan' ? 'Borongan' : 'Harian'}
					</span>
				{/if}
				<div class="text-gray-400 transition-transform duration-200" class:rotate-180={expandedId === mp.id}>
					<IconChevronDown size={16} />
				</div>
			</div>
		</button>

		<!-- Expanded detail panel -->
		{#if expandedId === mp.id}
			<div class="border-t p-3 space-y-2.5" style="background: var(--sys-fill); border-color: var(--sys-sep)">
				<div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
					
					<!-- NIK Card -->
					<div class="flex items-center justify-between p-2.5 rounded-xl border" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<div class="flex items-center gap-2.5 min-w-0">
							<div class="p-1.5 rounded-lg bg-[var(--gl)] text-[var(--g)]">
								<IconId size={16} />
							</div>
							<div class="min-w-0">
								<p class="text-[9px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">NIK Pekerja</p>
								<p class="text-[12px] font-semibold truncate" style="color: var(--sys-label)">{mp.NIK || '-'}</p>
							</div>
						</div>
						{#if mp.NIK}
							<button 
								onclick={(e) => { e.stopPropagation(); copyToClipboard(String(mp.NIK), `nik-${mp.id}`); }}
								class="p-1.5 rounded-lg transition-colors"
								style="background: var(--sys-fill2); color: var(--sys-label2)"
								title="Salin NIK"
							>
								{#if copiedKey === `nik-${mp.id}`}
									<IconCheck size={14} class="text-emerald-500" />
								{:else}
									<IconCopy size={14} />
								{/if}
							</button>
						{/if}
					</div>

					<!-- No Telpon Card -->
					<div class="flex items-center justify-between p-2.5 rounded-xl border" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<div class="flex items-center gap-2.5 min-w-0">
							<div class="p-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
								<IconPhone size={16} />
							</div>
							<div class="min-w-0">
								<p class="text-[9px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">No. Telepon</p>
								<p class="text-[12px] font-semibold truncate" style="color: var(--sys-label)">{phone.formatted}</p>
							</div>
						</div>
						{#if phone.raw}
							<div class="flex items-center gap-1">
								<a
									href="https://wa.me/{phone.raw}"
									target="_blank"
									rel="noopener noreferrer"
									onclick={(e) => e.stopPropagation()}
									class="p-1.5 rounded-lg bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/25 transition-colors"
									title="Hubungi WhatsApp"
								>
									<IconBrandWhatsapp size={14} />
								</a>
								<a
									href="tel:{phone.formatted}"
									onclick={(e) => e.stopPropagation()}
									class="p-1.5 rounded-lg transition-colors"
									style="background: var(--sys-fill2); color: var(--sys-label2)"
									title="Panggil Telepon"
								>
									<IconPhoneCall size={14} />
								</a>
							</div>
						{/if}
					</div>

					<!-- Total Jasa Card -->
					<div class="flex items-center gap-2.5 p-2.5 rounded-xl border" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
						<div class="p-1.5 rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
							<IconCurrencyDollar size={16} />
						</div>
						<div>
							<p class="text-[9px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">Total Jasa Pekerja</p>
							<p class="text-[12px] font-bold text-amber-600 dark:text-amber-400">{formatCurrency(mp.total_jasa)}</p>
						</div>
					</div>

					<!-- ID Reference Card -->
					{#if mp.id_reference}
						<div class="flex items-center justify-between p-2.5 rounded-xl border" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
							<div class="flex items-center gap-2.5 min-w-0">
								<div class="p-1.5 rounded-lg bg-gray-500/10 text-gray-500">
									<IconHash size={16} />
								</div>
								<div class="min-w-0">
									<p class="text-[9px] font-bold uppercase tracking-wider" style="color: var(--sys-label4)">ID Reference</p>
									<p class="text-[12px] font-semibold truncate" style="color: var(--sys-label)">{mp.id_reference}</p>
								</div>
							</div>
							<button 
								onclick={(e) => { e.stopPropagation(); copyToClipboard(String(mp.id_reference), `ref-${mp.id}`); }}
								class="p-1.5 rounded-lg transition-colors"
								style="background: var(--sys-fill2); color: var(--sys-label2)"
								title="Salin Reference"
							>
								{#if copiedKey === `ref-${mp.id}`}
									<IconCheck size={14} class="text-emerald-500" />
								{:else}
									<IconCopy size={14} />
								{/if}
							</button>
						</div>
					{/if}

				</div>

				<!-- Skill Matrix Section -->
				<div class="p-3 rounded-xl border space-y-1.5" style="background: var(--sys-bg2); border-color: var(--sys-sep)">
					<div class="flex items-center justify-between">
						<p class="text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5" style="color: var(--sys-label3)">
							<IconTools size={13} class="text-[var(--g)]" />
							<span>Daftar Keahlian / Skill</span>
						</p>
						<span class="text-[9px] px-2 py-0.5 rounded-full" style="background: var(--sys-fill2); color: var(--sys-label4)">
							Read-only HRD
						</span>
					</div>

					{#if skillsLoadingId === mp.id}
						<div class="flex items-center gap-2 py-1">
							<IconLoader2 size={14} class="animate-spin text-[var(--g)]" />
							<span class="text-[11px]" style="color: var(--sys-label3)">Memuat data skill...</span>
						</div>
					{:else if (skillsByManpower[mp.id] || []).length === 0}
						<p class="text-[11px] italic py-1" style="color: var(--sys-label4)">Belum ada keahlian tercatat untuk pekerja ini.</p>
					{:else}
						<div class="flex flex-wrap gap-1.5 pt-1">
							{#each skillsByManpower[mp.id] as sk (sk.id)}
								{@const levelBadge = getSkillLevelBadge(sk.level)}
								<span 
									class="inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-lg border shadow-2xs"
									style="background: {levelBadge.bg}; color: {levelBadge.text}; border-color: {levelBadge.text}30"
								>
									<span class="font-bold">{sk.skill_nama}</span>
									<span class="opacity-40">·</span>
									<span class="text-[10px] font-normal">{levelLabel(sk.level)}</span>
								</span>
							{/each}
						</div>
					{/if}
				</div>

				<!-- Unggah Dokumen dari Lokasi (F4.4) — masuk antrean verifikasi HRD -->
				<button
					onclick={(e) => { e.stopPropagation(); openUploadModal(mp); }}
					class="w-full flex items-center justify-center gap-1.5 p-2.5 rounded-xl border border-dashed text-[12px] font-semibold transition-colors"
					style="border-color: var(--sys-sep); color: var(--g)"
				>
					<IconCamera size={15} /> Unggah Dokumen (KTP/BPJS/SKK)
				</button>

			</div>
		{/if}
	</div>
{/snippet}

<style>
	.no-scrollbar::-webkit-scrollbar { display: none; }
	.no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>

