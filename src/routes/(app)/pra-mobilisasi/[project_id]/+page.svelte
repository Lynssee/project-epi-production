<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Pertajam Fase Planning — Fase 2. Checklist Pra-Mobilisasi: PL/Manpower Leader mencentang
	// item setiap hari sebelum tim berangkat ke site. Master item diatur admin di erp-epi
	// (Settings > Project Management); submission harian disimpan per project+tanggal.
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import {
		listActiveChecklistItems,
		getTodaySubmission,
		saveTodaySubmission,
		getProjectMobilizationContext,
		canFillChecklist,
		type MobilizationChecklistItem,
		type MobilizationProjectContext
	} from '$lib/services/mobilizationChecklist';
	import { fetchProjectFulfillment, type ChecklistSource, type ProjectFulfillment } from '$lib/services/projectFulfillment';
	import { IconArrowLeft, IconLoader2, IconCheck } from '@tabler/icons-svelte';

	const KATEGORI_LABEL: Record<string, string> = {
		umum: 'Umum',
		site: 'Site / Lapangan',
		workshop: 'Workshop / Produksi',
		finance: 'Finance / Admin'
	};

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let saving = $state(false);
	let saved = $state(false);
	let project = $state<MobilizationProjectContext | null>(null);
	let items = $state<MobilizationChecklistItem[]>([]);
	let checked = $state<Record<number, boolean>>({});
	let catatan = $state('');
	let allowed = $state(true);
	// L4 — sinyal kesiapan dari sistem: item yang dipetakan admin dicentang otomatis (hanya saat checklist hari ini belum
	// pernah disimpan, dan hanya bila data sistem menunjukkan SIAP). PL tetap bisa membatalkan centang.
	let signals = $state<ProjectFulfillment['checklistSignals'] | null>(null);
	let autoMap = $state<Record<number, ChecklistSource>>({});
	let autoChecked = $state<Set<number>>(new Set());

	let grouped = $derived(
		items.reduce((acc: Record<string, MobilizationChecklistItem[]>, it) => {
			(acc[it.kategori] = acc[it.kategori] || []).push(it);
			return acc;
		}, {})
	);
	let requiredCount = $derived(items.filter((i) => i.is_required).length);
	let checkedRequiredCount = $derived(items.filter((i) => i.is_required && checked[i.id]).length);
	let allRequiredDone = $derived(requiredCount > 0 ? checkedRequiredCount >= requiredCount : true);

	async function load() {
		loading = true;
		try {
			const auth = get(authStore);
			const [ctx, existing] = await Promise.all([
				getProjectMobilizationContext(projectId),
				getTodaySubmission(projectId)
			]);
			project = ctx;
			allowed = canFillChecklist(ctx, auth.karyawanId);

			const jenisProyek = ctx?.workshop ? 'workshop' : 'site';
			items = await listActiveChecklistItems(jenisProyek);

			const initial: Record<number, boolean> = {};
			if (existing) {
				for (const row of existing.items_snapshot || []) initial[row.item_id] = !!row.checked;
				catatan = existing.catatan || '';
			}
			// Sinyal kesiapan bersifat tambahan: gagal memuat TIDAK boleh mengganggu pengisian manual.
			signals = null;
			autoMap = {};
			autoChecked = new Set();
			try {
				const f = await fetchProjectFulfillment(projectId);
				signals = f.checklistSignals || null;
				autoMap = Object.fromEntries((f.config?.checklistAutocheck || []).map((r) => [r.item_id, r.source]));
				if (!existing && signals) {
					const auto = new Set<number>();
					for (const it of items) {
						const src = autoMap[it.id];
						if (src && signals[src]?.state === 'ok') {
							initial[it.id] = true;
							auto.add(it.id);
						}
					}
					autoChecked = auto;
				}
			} catch (e) {
				console.warn('[pra-mobilisasi] sinyal kesiapan tidak termuat:', e);
			}
			checked = initial;
		} finally {
			loading = false;
		}
	}

	async function submit() {
		if (!allowed) return;
		saving = true;
		saved = false;
		try {
			const auth = get(authStore);
			await saveTodaySubmission({
				projectId,
				karyawanId: auth.karyawanId,
				karyawanName: auth.karyawanName || auth.user?.displayName || auth.user?.email || null,
				items: items.map((it) => ({ item_id: it.id, label: it.label, kategori: it.kategori, checked: !!checked[it.id] })),
				allRequiredChecked: allRequiredDone,
				catatan
			});
			saved = true;
			setTimeout(() => (saved = false), 3000);
		} catch (e: any) {
			alert(e?.message || 'Gagal menyimpan checklist');
		} finally {
			saving = false;
		}
	}

	function handleBack() {
		goto(`/proyek/${projectId}`);
	}

	$effect(() => {
		if (projectId) load();
	});
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="px-4 pt-4 max-w-4xl mx-auto w-full">
		<button
			type="button"
			onclick={handleBack}
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
		>
			<IconArrowLeft size={16} />
			<span>Kembali ke Detail Proyek</span>
		</button>
		<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">
			Checklist Pra-Mobilisasi — {project?.name || `Proyek #${projectId}`}
		</h2>
		<p class="text-[12px]" style="color: var(--sys-label3)">
			Centang sebelum tim berangkat ke site hari ini. Diisi ulang setiap hari kerja.
		</p>
	</div>

	{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16" style="background: var(--sys-bg)">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat checklist pra-mobilisasi..." />
		</div>
	{:else if !allowed}
		<div class="scroll-body px-4 py-4" style="background: var(--sys-bg)">
			<div class="card-section text-center py-8">
				<p class="text-[13px]" style="color: var(--sys-label3)">
					Hanya Project Leader atau Manpower Leader proyek ini yang bisa mengisi checklist pra-mobilisasi.
				</p>
			</div>
		</div>
	{:else}
		<div class="scroll-body px-4 py-4 flex flex-col gap-3" style="background: var(--sys-bg)">
			<a href="/pra-mobilisasi/{projectId}/survei" class="card-section flex items-center justify-between no-underline" title="Isi data lokasi & foto survei dari HP; otomatis jadi acuan Charter">
				<span class="text-[13px] font-semibold" style="color: var(--sys-label)">📸 Survei Lapangan &amp; Foto</span>
				<span class="text-[11px]" style="color: var(--sys-label3)">Isi data lokasi, listrik, air, foto →</span>
			</a>

			<div class="card-section">
				<div class="flex items-center justify-between mb-1">
					<p class="text-[13px] font-semibold" style="color: var(--sys-label)">
						{checkedRequiredCount}/{requiredCount} item wajib tercentang
					</p>
					<span
						class="text-[11px] font-bold px-2 py-1 rounded-full"
						style="background: {allRequiredDone ? 'var(--gl)' : 'var(--pl)'}; color: {allRequiredDone ? 'var(--gd)' : 'var(--pd)'}"
					>
						{allRequiredDone ? 'Siap Berangkat' : 'Belum Lengkap'}
					</span>
				</div>
			</div>

			{#each Object.entries(grouped) as [kategori, groupItems] (kategori)}
				<div class="card-section">
					<h4 class="text-[13px] font-semibold mb-2" style="color: var(--sys-label)">{KATEGORI_LABEL[kategori] || kategori}</h4>
					<div class="flex flex-col gap-2">
						{#each groupItems as it (it.id)}
							<label class="flex items-start gap-2.5 border rounded-lg p-2.5 cursor-pointer" style="border-color: var(--sys-sep)">
								<input type="checkbox" bind:checked={checked[it.id]} class="mt-0.5 w-4 h-4 shrink-0" />
								<div>
									<p class="text-[13px] font-medium" style="color: var(--sys-label)">
										{it.label} {#if !it.is_required}<span class="text-[11px]" style="color: var(--sys-label3)">(opsional)</span>{/if}
									</p>
									{#if it.hint}<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">💡 {it.hint}</p>{/if}
									{#if autoMap[it.id] && signals?.[autoMap[it.id]] && signals[autoMap[it.id]].state !== 'na'}
										{@const sig = signals[autoMap[it.id]]}
										<p class="text-[11px] mt-0.5 font-medium" style="color: {sig.state === 'ok' ? 'var(--gd)' : 'var(--re)'}">
											{#if sig.state === 'ok'}
												✨ {autoChecked.has(it.id) ? 'Dicentang otomatis' : 'Data sistem siap'}: {sig.detail}. Batalkan centang bila di lapangan ternyata belum.
											{:else}
												⚠️ Data sistem: {sig.detail} — cek dulu sebelum mencentang.
											{/if}
										</p>
									{/if}
								</div>
							</label>
						{/each}
					</div>
				</div>
			{/each}

			<div class="card-section">
				<label class="text-[13px] font-semibold mb-1.5 block" style="color: var(--sys-label)">Catatan (opsional)</label>
				<textarea
					bind:value={catatan}
					rows="2"
					placeholder="Catatan tambahan untuk hari ini"
					class="w-full border rounded-lg px-2 py-1.5 text-[13px]"
					style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
				></textarea>
			</div>

			<button
				type="button"
				onclick={submit}
				disabled={saving}
				class="w-full py-3 rounded-lg font-semibold text-[14px] flex items-center justify-center gap-2"
				style="background: var(--g); color: white;"
			>
				{#if saving}
					<IconLoader2 size={18} class="animate-spin" />
				{:else if saved}
					<IconCheck size={18} />
				{/if}
				{saving ? 'Menyimpan...' : saved ? 'Tersimpan' : 'Simpan Checklist Hari Ini'}
			</button>
		</div>
	{/if}
</div>
