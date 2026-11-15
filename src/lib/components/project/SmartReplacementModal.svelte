<!-- src/lib/components/project/SmartReplacementModal.svelte -->
<!-- Fase 5 — Smart Quick Replacement Modal (Mitigasi Komitmen & Tenaga Kerja Mangkir/Kabur) -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import {
		IconBolt, IconSearch, IconCheck, IconAlertTriangle,
		IconX, IconUserCheck, IconUsers, IconShieldCheck,
		IconFilter, IconLoader2, IconSparkles, IconUser
	} from '@tabler/icons-svelte';
	import directus from '$lib/services/directus';
	import { readItems } from '@directus/sdk';
	import { createAssignment } from '$lib/services/manpowerAssignment';

	interface Props {
		isOpen: boolean;
		projectId: number | null;
		projectName?: string;
		targetPosisi?: string;
		targetMandorId?: number | null;
		onClose: () => void;
		onAssigned?: () => void;
	}

	let {
		isOpen = false,
		projectId = null,
		projectName = '',
		targetPosisi = '',
		targetMandorId = null,
		onClose,
		onAssigned
	}: Props = $props();

	interface Candidate {
		id: number;
		nama: string;
		posisi: string;
		domisili: string;
		nik: string;
		no_telpon: string;
		reliability_score: number;
		status_komitmen: string;
		total_mangkir_count: number;
		penjamin_mandor_id: number | null;
		isIdle: boolean;
		activeAssignmentsCount: number;
		isBinaanMandor: boolean;
		isPosisiMatch: boolean;
		matchScore: number;
	}

	let loading = $state(false);
	let assigning = $state(false);
	let errorMsg = $state('');
	let successMsg = $state('');

	let rawCandidates = $state<Candidate[]>([]);
	let searchQuery = $state('');
	let filterPosisi = $state('');
	let filterOnlyIdle = $state(true);
	let filterMinScore = $state(true);

	// Selected worker for inline assignment form
	let selectedWorker = $state<Candidate | null>(null);
	let formJabatan = $state('');
	let formTanggalMulai = $state(new Date().toISOString().split('T')[0]);
	let formTanggalSelesai = $state(
		new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0]
	);
	let formRateHarian = $state<number | string>('');
	let formPenjaminMandorId = $state<number | null>(null);
	let mandors = $state<{ id: number; nama: string }[]>([]);

	// Reactive effect on open
	$effect(() => {
		if (isOpen) {
			errorMsg = '';
			successMsg = '';
			selectedWorker = null;
			formJabatan = targetPosisi || '';
			formPenjaminMandorId = targetMandorId || null;
			loadSmartCandidates();
		}
	});

	async function loadSmartCandidates() {
		loading = true;
		errorMsg = '';
		try {
			const today = new Date().toISOString().split('T')[0];

			// 1. Fetch master manpower yang bukan blacklist & aktif
			const [mpRes, assignRes] = await Promise.all([
				directus.request(
					readItems('manpower', {
						fields: [
							'id', 'nama', 'posisi', 'domisili', 'NIK', 'no_telpon',
							'reliability_score', 'status_komitmen', 'penjamin_mandor_id',
							'total_kabur_count', 'total_mangkir_count', 'status_pekerja'
						],
						filter: {
							status_pekerja: { _nin: ['daftar_hitam', 'tidak_aktif'] },
							status_komitmen: { _nin: ['blacklisted_kabur', 'blacklisted_indisipliner'] }
						},
						limit: -1
					})
				) as Promise<any[]>,
				directus.request(
					readItems('manpower_assignment', {
						fields: ['id', 'manpower_id', 'status', 'tanggal_selesai'],
						filter: { status: { _eq: 'aktif' } },
						limit: -1
					})
				) as Promise<any[]>
			]);

			// 2. Map assignment aktif yang belum kedaluwarsa
			const activeCountMap = new Map<number, number>();
			for (const a of assignRes || []) {
				const mId = typeof a.manpower_id === 'object' ? a.manpower_id?.id : a.manpower_id;
				if (!mId) continue;
				if (a.tanggal_selesai && a.tanggal_selesai < today) continue;
				activeCountMap.set(Number(mId), (activeCountMap.get(Number(mId)) || 0) + 1);
			}

			// 3. Kumpulkan mandor
			const mandorList: { id: number; nama: string }[] = [];
			for (const mp of mpRes || []) {
				const pos = (mp.posisi || '').toLowerCase();
				if (pos.includes('mandor') || pos.includes('leader') || pos.includes('kepala')) {
					mandorList.push({ id: mp.id, nama: mp.nama });
				}
			}
			mandors = mandorList;

			// 4. Kalkulasi Smart Recommendation Ranking
			const processed: Candidate[] = (mpRes || []).map((mp) => {
				const activeCount = activeCountMap.get(mp.id) || 0;
				const isIdle = activeCount === 0;
				const isBinaan = targetMandorId ? mp.penjamin_mandor_id === targetMandorId : false;
				const isMatchPos = targetPosisi
					? (mp.posisi || '').toLowerCase().includes(targetPosisi.toLowerCase())
					: false;

				let score = mp.reliability_score ?? 100;
				if (isBinaan) score += 30; // Prioritas mandor penjamin
				if (isMatchPos) score += 25; // Prioritas skill sama
				if (isIdle) score += 20; // Prioritas menganggur/siap kerja
				score -= (mp.total_mangkir_count || 0) * 5;

				return {
					id: mp.id,
					nama: mp.nama || `Manpower #${mp.id}`,
					posisi: mp.posisi || 'Helper/Tukang',
					domisili: mp.domisili || '-',
					nik: mp.NIK ? String(mp.NIK) : '-',
					no_telpon: mp.no_telpon ? String(mp.no_telpon) : '-',
					reliability_score: mp.reliability_score ?? 100,
					status_komitmen: mp.status_komitmen || 'aktif',
					total_mangkir_count: mp.total_mangkir_count || 0,
					penjamin_mandor_id: mp.penjamin_mandor_id || null,
					isIdle,
					activeAssignmentsCount: activeCount,
					isBinaanMandor: isBinaan,
					isPosisiMatch: isMatchPos,
					matchScore: score
				};
			});

			// Urutkan skor tertinggi di atas
			processed.sort((a, b) => b.matchScore - a.matchScore);
			rawCandidates = processed;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat rekomendasi manpower pengganti';
		} finally {
			loading = false;
		}
	}

	// Filtered candidates
	let visibleCandidates = $derived(
		rawCandidates.filter((c) => {
			if (filterOnlyIdle && !c.isIdle) return false;
			if (filterMinScore && c.reliability_score < 80) return false;
			if (filterPosisi && !c.posisi.toLowerCase().includes(filterPosisi.toLowerCase())) return false;
			if (searchQuery.trim()) {
				const q = searchQuery.toLowerCase().trim();
				return (
					c.nama.toLowerCase().includes(q) ||
					c.posisi.toLowerCase().includes(q) ||
					c.domisili.toLowerCase().includes(q)
				);
			}
			return true;
		})
	);

	// Unique list posisi untuk filter dropdown
	let uniquePosisi = $derived(
		Array.from(new Set(rawCandidates.map((c) => c.posisi).filter(Boolean)))
	);

	function handleSelectWorker(worker: Candidate) {
		selectedWorker = worker;
		formJabatan = targetPosisi || worker.posisi;
		formPenjaminMandorId = worker.penjamin_mandor_id || targetMandorId || null;
		successMsg = '';
		errorMsg = '';
	}

	async function handleSubmitAssignment() {
		if (!projectId) {
			errorMsg = 'ID Proyek tidak valid.';
			return;
		}
		if (!selectedWorker) {
			errorMsg = 'Pilih pekerja pengganti terlebih dahulu.';
			return;
		}
		if (!formJabatan) {
			errorMsg = 'Jabatan / peran wajib diisi.';
			return;
		}

		assigning = true;
		errorMsg = '';
		successMsg = '';
		try {
			const res = await createAssignment({
				project_id: projectId,
				manpower_id: selectedWorker.id,
				jabatan: formJabatan,
				rate_tipe: 'harian',
				rate_harian: formRateHarian ? Number(formRateHarian) : null,
				tanggal_mulai: formTanggalMulai,
				tanggal_selesai: formTanggalSelesai,
				penjamin_mandor_id: formPenjaminMandorId,
				status: 'aktif',
				catatan: `SPK Pengganti Cepat (Smart Replacement) — Rekomendasi skor ${selectedWorker.reliability_score}%`
			});

			if (res.success) {
				successMsg = `Berhasil menugaskan ${selectedWorker.nama} ke proyek! SPK aktif telah diterbitkan.`;
				if (typeof window !== 'undefined' && (window as any).__showToast) {
					(window as any).__showToast(successMsg, 'success');
				}
				if (onAssigned) onAssigned();
				setTimeout(() => {
					onClose();
				}, 1200);
			} else {
				errorMsg = res.error || 'Gagal menerbitkan penugasan pengganti';
			}
		} catch (err: any) {
			errorMsg = err?.message || 'Terjadi kesalahan sistem';
		} finally {
			assigning = false;
		}
	}
</script>

{#if isOpen}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-xs">
		<div class="relative w-full max-w-3xl max-h-[92vh] flex flex-col rounded-3xl bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 shadow-2xl overflow-hidden animate-in fade-in duration-200">
			<!-- Modal Header -->
			<div class="px-6 py-4 bg-gradient-to-r from-amber-600 via-amber-700 to-amber-800 text-white flex items-center justify-between shrink-0">
				<div class="flex items-center gap-3">
					<div class="p-2.5 rounded-2xl bg-white/20 backdrop-blur-md shadow-xs">
						<IconBolt size={24} class="text-amber-200" />
					</div>
					<div>
						<h2 class="text-lg font-extrabold tracking-tight flex items-center gap-2">
							<span>Cari Pengganti Cepat (Smart Pool)</span>
							<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-400 text-amber-950 uppercase">
								Prioritas
							</span>
						</h2>
						<p class="text-xs text-amber-100/90">
							Rekomendasi otomatis tenaga kerja siap pakai berintegritas tinggi untuk {projectName ? `proyek "${projectName}"` : 'proyek'}.
						</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onClose}
					class="p-2 rounded-xl text-amber-100 hover:text-white hover:bg-white/10 transition-colors"
				>
					<IconX size={20} />
				</button>
			</div>

			<!-- Search & Filter Controls -->
			<div class="p-4 bg-slate-50 dark:bg-slate-800/50 border-b border-gray-200 dark:border-slate-800 space-y-3 shrink-0">
				<div class="flex flex-col sm:flex-row gap-2.5">
					<div class="relative flex-1">
						<IconSearch size={16} class="absolute left-3 top-2.5 text-gray-400" />
						<input
							type="text"
							bind:value={searchQuery}
							placeholder="Cari nama, keahlian, atau kota domisili..."
							class="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
						/>
					</div>

					<select
						bind:value={filterPosisi}
						class="px-3 py-2 text-xs rounded-xl border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-amber-500"
					>
						<option value="">Semua Posisi / Keahlian</option>
						{#each uniquePosisi as pos}
							<option value={pos}>{pos}</option>
						{/each}
					</select>
				</div>

				<!-- Quick Filter Chips -->
				<div class="flex items-center gap-2 flex-wrap text-xs">
					<button
						type="button"
						onclick={() => (filterOnlyIdle = !filterOnlyIdle)}
						class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold transition-all {filterOnlyIdle ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'}"
					>
						<span class="w-2 h-2 rounded-full {filterOnlyIdle ? 'bg-white' : 'bg-emerald-500'}"></span>
						<span>Hanya Siap Kerja (Idle)</span>
					</button>

					<button
						type="button"
						onclick={() => (filterMinScore = !filterMinScore)}
						class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border text-[11px] font-semibold transition-all {filterMinScore ? 'bg-amber-600 text-white border-amber-600' : 'bg-white dark:bg-slate-900 text-gray-600 dark:text-gray-300 border-gray-200 dark:border-slate-700'}"
					>
						<IconShieldCheck size={14} />
						<span>Komitmen Baik (Skor &ge; 80%)</span>
					</button>

					<span class="ml-auto text-[11px] text-gray-500 dark:text-gray-400">
						Ditemukan <strong class="text-gray-900 dark:text-white font-mono">{visibleCandidates.length}</strong> kandidat
					</span>
				</div>
			</div>

			<!-- Messages -->
			{#if errorMsg}
				<div class="m-4 p-3 rounded-xl bg-red-500/10 border border-red-500/25 text-red-600 dark:text-red-400 text-xs font-semibold flex items-center gap-2">
					<IconAlertTriangle size={16} />
					<span>{errorMsg}</span>
				</div>
			{/if}
			{#if successMsg}
				<div class="m-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/25 text-emerald-600 dark:text-emerald-400 text-xs font-semibold flex items-center gap-2">
					<IconCheck size={16} />
					<span>{successMsg}</span>
				</div>
			{/if}

			<!-- Modal Body (Candidate List + Selection) -->
			<div class="p-4 overflow-y-auto flex-1 space-y-3">
				{#if loading}
					<div class="py-16 flex flex-col items-center justify-center">
						<CircularProgressGauge size={48} strokeWidth={4} label="Menghitung kecocokan smart pool..." />
					</div>
				{:else if visibleCandidates.length === 0}
					<div class="py-14 text-center rounded-2xl border border-dashed border-gray-200 dark:border-slate-800">
						<IconUsers size={36} class="mx-auto text-gray-400 mb-2" />
						<p class="text-sm font-bold text-gray-700 dark:text-gray-300">Tidak ada kandidat pengganti yang cocok</p>
						<p class="text-xs text-gray-400 mt-1 max-w-sm mx-auto">
							Coba longgarkan filter "Hanya Siap Kerja" atau ubah kata kunci pencarian.
						</p>
					</div>
				{:else}
					<div class="grid grid-cols-1 md:grid-cols-2 gap-3">
						{#each visibleCandidates as c (c.id)}
							{@const isSelected = selectedWorker?.id === c.id}
							<div
								class="p-3.5 rounded-2xl border transition-all text-left relative flex flex-col justify-between {isSelected ? 'bg-amber-50/80 dark:bg-amber-950/30 border-amber-500 ring-2 ring-amber-500/40 shadow-md' : 'bg-white dark:bg-slate-900 border-gray-200 dark:border-slate-800 hover:border-amber-300 dark:hover:border-slate-700 shadow-2xs'}"
							>
								<!-- Candidate Info Header -->
								<div>
									<div class="flex items-start justify-between gap-2 mb-1.5">
										<div>
											<div class="flex items-center gap-1.5 flex-wrap">
												<h4 class="text-xs font-bold text-gray-900 dark:text-white">{c.nama}</h4>
												{#if c.isBinaanMandor}
													<span class="px-1.5 py-0.5 rounded text-[9px] font-bold bg-indigo-100 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300">
														Binaan Mandor
													</span>
												{/if}
											</div>
											<p class="text-[11px] font-medium text-gray-500 dark:text-gray-400">{c.posisi} · Domisili: {c.domisili}</p>
										</div>

										<!-- Score Badge -->
										<div class="text-right shrink-0">
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold {c.reliability_score >= 90 ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : c.reliability_score >= 80 ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'}">
												<IconShieldCheck size={12} />
												{c.reliability_score}%
											</span>
										</div>
									</div>

									<!-- Availability & History Tags -->
									<div class="flex items-center gap-1.5 flex-wrap text-[10px] my-2">
										{#if c.isIdle}
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-200 dark:border-emerald-800/40">
												<span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span> Siap Kerja (Idle)
											</span>
										{:else}
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-medium">
												Penugasan Aktif ({c.activeAssignmentsCount})
											</span>
										{/if}

										{#if c.total_mangkir_count > 0}
											<span class="text-amber-600 dark:text-amber-400 font-medium">
												Mangkir: {c.total_mangkir_count}x
											</span>
										{/if}
									</div>
								</div>

								<!-- Action Button -->
								<div class="pt-2 border-t border-gray-100 dark:border-slate-800/60 mt-2 flex items-center justify-between">
									<span class="text-[10px] text-gray-400">NIK: {c.nik}</span>
									<button
										type="button"
										onclick={() => handleSelectWorker(c)}
										class="px-3 py-1 rounded-xl text-xs font-bold transition-all flex items-center gap-1 {isSelected ? 'bg-amber-600 text-white' : 'bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300'}"
									>
										{#if isSelected}
											<IconCheck size={14} /> Terpilih
										{:else}
											<IconBolt size={14} /> Pilih & Tugaskan
										{/if}
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}

				<!-- Form Penugasan Pengganti Cepat Jika Ada Pekerja Terpilih -->
				{#if selectedWorker}
					<div class="p-4 rounded-2xl border bg-amber-50/60 dark:bg-amber-950/20 border-amber-300 dark:border-amber-800/60 space-y-3 mt-4">
						<div class="flex items-center justify-between border-b border-amber-200 dark:border-amber-800/60 pb-2">
							<h4 class="text-xs font-bold uppercase tracking-wider text-amber-900 dark:text-amber-200 flex items-center gap-1.5">
								<IconSparkles size={16} />
								<span>Penerbitan SPK Pengganti Cepat — {selectedWorker.nama}</span>
							</h4>
							<span class="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
								Skor Reliabilitas: {selectedWorker.reliability_score}%
							</span>
						</div>

						<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
							<div>
								<label class="block font-bold text-gray-700 dark:text-gray-300 mb-1">Peran / Jabatan *</label>
								<input
									type="text"
									bind:value={formJabatan}
									placeholder="Tukang / Helper..."
									class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
								/>
							</div>

							<div>
								<label class="block font-bold text-gray-700 dark:text-gray-300 mb-1">Tanggal Mulai *</label>
								<input
									type="date"
									bind:value={formTanggalMulai}
									class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
								/>
							</div>

							<div>
								<label class="block font-bold text-gray-700 dark:text-gray-300 mb-1">Tanggal Selesai *</label>
								<input
									type="date"
									bind:value={formTanggalSelesai}
									class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
								/>
							</div>

							<div>
								<label class="block font-bold text-gray-700 dark:text-gray-300 mb-1">Mandor Penjamin (Opsional)</label>
								<select
									bind:value={formPenjaminMandorId}
									class="w-full px-2.5 py-1.5 rounded-lg border border-gray-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-gray-900 dark:text-white"
								>
									<option value={null}>-- Tanpa Mandor Penjamin --</option>
									{#each mandors as m}
										<option value={m.id}>{m.nama}</option>
									{/each}
								</select>
							</div>
						</div>

						<div class="flex items-center justify-end gap-2 pt-2">
							<button
								type="button"
								onclick={() => (selectedWorker = null)}
								class="px-3 py-1.5 rounded-xl text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-slate-800"
							>
								Batal Pilih
							</button>
							<button
								type="button"
								onclick={handleSubmitAssignment}
								disabled={assigning}
								class="px-5 py-2 rounded-xl text-xs font-bold text-white bg-amber-600 hover:bg-amber-700 shadow-md transition-all active:scale-95 disabled:opacity-50 flex items-center gap-1.5"
							>
								{#if assigning}
									<IconLoader2 size={14} class="animate-spin" />
									<span>Menerbitkan SPK...</span>
								{:else}
									<IconBolt size={14} />
									<span>🚀 Terbitkan SPK Pengganti Sekarang</span>
								{/if}
							</button>
						</div>
					</div>
				{/if}
			</div>

			<!-- Modal Footer -->
			<div class="px-6 py-3 bg-gray-50 dark:bg-slate-800/80 border-t border-gray-200 dark:border-slate-800 flex items-center justify-between text-xs text-gray-500 shrink-0">
				<span>💡 Sistem memprioritaskan pekerja bebas tugas binaan mandor dengan komitmen &ge; 80%.</span>
				<button
					type="button"
					onclick={onClose}
					class="px-4 py-1.5 rounded-xl border border-gray-300 dark:border-slate-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 font-semibold"
				>
					Tutup
				</button>
			</div>
		</div>
	</div>
{/if}
