<!-- src/lib/components/project/DossierReadinessCard.svelte -->
<!-- Visibilitas Leader Fase 3: Kesiapan Dokumentasi Lapangan — Presensi, Log Harian, Surat Jalan (GR), Dokumen wajib.
     Setiap angka dihitung dari data nyata (BUKAN proksi seperti gauge dossier admin). TANPA nominal rupiah.
     Hanya penanda & jalan pintas: tidak memblokir pekerjaan apa pun. Gagal memuat TIDAK disamarkan sebagai lengkap. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { loadDossierReadiness, type DossierReadinessRaw } from '$lib/services/dossierReadinessApi';
	import { buildDossierReadiness, type ReadinessActionKey, type ReadinessLevel } from '$lib/utils/dossierReadiness';

	let {
		projectId,
		pendingGr = null,
		docsRequired = null,
		docsMissing = null,
		onAction
	}: {
		projectId: number | string;
		pendingGr?: number | null;
		docsRequired?: number | null;
		docsMissing?: number | null;
		onAction?: (key: ReadinessActionKey, ctx?: { lpjFirstId?: number | null }) => void;
	} = $props();

	let loading = $state(true);
	let raw = $state<DossierReadinessRaw | null>(null);
	let errorMsg = $state('');
	let hidden = $state(false);

	const LEVEL_STYLE: Record<ReadinessLevel, { bar: string; chip: string; label: string }> = {
		ok: { bar: '#16a34a', chip: 'background:#f0fdf4;color:#166534;border-color:#bbf7d0;', label: 'Lengkap' },
		warn: { bar: '#d97706', chip: 'background:#fffbeb;color:#92400e;border-color:#fde68a;', label: 'Perlu dilengkapi' },
		bad: { bar: '#dc2626', chip: 'background:#fef2f2;color:#991b1b;border-color:#fecaca;', label: 'Belum lengkap' },
		na: { bar: '#9ca3af', chip: 'background:#f9fafb;color:#6b7280;border-color:#e5e7eb;', label: 'Belum terukur' }
	};

	let result = $derived(
		raw && raw.applicable
			? buildDossierReadiness({
					days: raw.days,
					absensiDates: raw.absensiDates,
					absensiUnavailable: !!raw.absensiFailed,
					absensiMenunggu: raw.absensiMenunggu,
					reportDates: raw.reportDates,
					qcRequiredDays: raw.qcRequiredDays,
					qcDoneDays: raw.qcDoneDays,
					lpj: raw.lpj,
					pendingGr,
					docsRequired,
					docsMissing,
					thresholds: raw.thresholds
				})
			: null
	);

	async function refresh() {
		loading = true;
		errorMsg = '';
		try {
			raw = await loadDossierReadiness(projectId);
		} catch (e: any) {
			console.error('Gagal memuat kesiapan dokumentasi lapangan:', e);
			raw = null;
			// 403 = bukan pemegang proyek: kartu birokrasi sudah menjelaskan, jangan dobel pesan.
			if (e?.status === 403) hidden = true;
			else errorMsg = 'Kesiapan dokumentasi belum dapat dimuat.';
		} finally {
			loading = false;
		}
	}

	onMount(refresh);
</script>

{#if !hidden && !loading && (errorMsg || result)}
	<div class="px-4 pt-3" data-testid="dossier-readiness-card">
		{#if errorMsg}
			<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700 flex items-center justify-between gap-2" data-testid="dossier-readiness-error">
				<span>{errorMsg}</span>
				<button class="font-bold underline" onclick={refresh}>Coba lagi</button>
			</div>
		{:else if result}
			{@const overall = LEVEL_STYLE[result.overallLevel]}
			<div class="rounded-2xl border p-3.5 shadow-sm" style="border-color:var(--sys-sep, #e5e7eb); background:var(--card-bg, #fff);">
				<div class="flex items-center justify-between gap-3">
					<div>
						<p class="text-[13px] font-bold" style="color:var(--sys-label, #111827)">
							📑 Kesiapan Dokumentasi Lapangan
							<span title="Dihitung dari data nyata: presensi, laporan harian & QC ambient {raw && raw.applicable ? raw.days.length : 0} hari kerja terakhir (hari ini belum dihitung), Surat Jalan yang menunggu GR, LPJ uang muka yang belum dipertanggungjawabkan, dan dokumen wajib. QC di sini = pembacaan ambient (suhu baja/titik embun/RH); pembacaan DFT (tebal cat) belum terukur otomatis. Jendela & ambang diatur Admin di Settings > Project Management.">ⓘ</span>
						</p>
						<p class="text-[11px]" style="color:var(--sys-label3, #6b7280)">
							Dokumentasi yang lengkap membantu kantor menyiapkan BAST & penagihan termin tanpa bolak-balik.
						</p>
					</div>
					{#if result.overallPct != null}
						<span class="text-[12px] font-bold px-2.5 py-1 rounded-full border shrink-0" style={overall.chip} data-testid="dossier-readiness-overall">{result.overallPct}%</span>
					{/if}
				</div>

				{#if result.overallPct != null}
					<div class="mt-2 h-1.5 w-full rounded-full overflow-hidden" style="background:#f3f4f6">
						<div class="h-full" style="width:{result.overallPct}%; background:{overall.bar}"></div>
					</div>
				{/if}

				<ul class="mt-3 flex flex-col gap-2">
					{#each result.items as item (item.id)}
						{@const st = LEVEL_STYLE[item.level]}
						<li class="flex items-start justify-between gap-2 rounded-xl border px-2.5 py-2" style={st.chip} data-testid="dossier-readiness-item-{item.id}" title={item.missingDays?.length ? `Belum ada data: ${item.missingDays.join(', ')}` : undefined}>
							<div class="min-w-0">
								<p class="text-[12px] font-bold">{item.icon} {item.label}{#if item.pct != null} · {item.pct}%{/if}</p>
								<p class="text-[11px] opacity-90">{item.detail}</p>
							</div>
							{#if item.level === 'warn' || item.level === 'bad'}
								<button class="shrink-0 text-[11px] font-bold underline" onclick={() => onAction?.(item.id, raw && raw.applicable ? { lpjFirstId: raw.lpj?.firstId ?? null } : undefined)}>{item.actionLabel}</button>
							{/if}
						</li>
					{/each}
				</ul>
			</div>
		{/if}
	</div>
{/if}
