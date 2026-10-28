<!-- src/lib/components/project/KebutuhanFaseSheet.svelte -->
<!-- "Kebutuhan Logistik & Alat Fase Ini" — Standarisasi Timeline v2 (TAJAM), Fase 6. Baca
     project_resource_forecast utk 1 proyek, dikelompokkan per tahap mobilisasi, status per
     item. Tombol "Ajukan Pengiriman Fase X" bikin pengajuan mobilisasi (approvalEngine admin)
     -> PM setuju -> gudang buat draft PL/SJ (keputusan Q5) -- TIDAK membuat SJ langsung dari
     sini. Pola sheet & style sama persis AdendumRequestSheet.svelte. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { IconX, IconLoader2 } from '@tabler/icons-svelte';
	import { fetchForecastForProject, fetchPlNumbers, type ForecastRow } from '$lib/services/forecastKebutuhan';
	import { requestMobilization } from '$lib/services/forecastMobilizationRequest';
	import { goto } from '$app/navigation';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { checkStockAvailability } from '$lib/services/packingList';

	let {
		open = $bindable(false),
		projectId,
		projectName = '',
		mobStagesSetting = [],
		requestedByName
	}: {
		open: boolean;
		projectId: number;
		projectName?: string;
		mobStagesSetting: Array<{ key: string; label: string }>;
		requestedByName: string;
	} = $props();

	let rows = $state<ForecastRow[]>([]);
	let loading = $state(false);
	let errorMsg = $state('');
	let requestingStage = $state<string | null>(null);
	let requestedStages = $state<Set<string>>(new Set());
	let plNumbers = $state<Record<string, string>>({});
	let stockMap = $state<Record<number, number>>({});
	let copiedStage = $state<string | null>(null);

	/** R4 — indikator stok gudang (info saja): 🟢 cukup · 🟡 sebagian · 🔴 habis · null = tak terhubung master. */
	function stockLevel(item: ForecastRow): { icon: string; text: string } | null {
		if (item.ref_type === 'equipment' || !item.ref_id || !/^\d+$/.test(String(item.ref_id))) return null;
		const stock = stockMap[Number(item.ref_id)];
		if (stock == null) return null;
		if (stock <= 0) return { icon: '🔴', text: 'Stok habis' };
		if (stock >= item.qty) return { icon: '🟢', text: `Stok cukup (${stock})` };
		return { icon: '🟡', text: `Stok sebagian (${stock} dari ${item.qty})` };
	}

	/** R5 — salin ringkasan satu tahap sebagai teks (siap tempel ke WhatsApp untuk gudang/vendor). */
	async function copyStageSummary(stageKey: string, items: ForecastRow[]) {
		const lines = items.map((r, i) => `${i + 1}. ${r.ref_name} — ${r.qty} ${r.unit || ''}${r.need_date ? ` (butuh ${r.need_date})` : ''}`);
		const text = `Kebutuhan ${projectName ? projectName + ' — ' : ''}${stageLabel(stageKey === '_none' ? null : stageKey)}\n${lines.join('\n')}`;
		try {
			await navigator.clipboard.writeText(text);
			copiedStage = stageKey;
			setTimeout(() => (copiedStage = null), 2000);
		} catch {
			errorMsg = 'Gagal menyalin — izinkan akses clipboard di browser.';
		}
	}

	/** Label dokumen tertaut di baris item: nomor PL, atau penanda pengajuan dari form PL lapangan. */
	function linkedLabel(item: ForecastRow): string | null {
		if (item.linked_ref_type === 'packing_list') {
			return `📦 ${plNumbers[String(item.linked_ref_id)] || `PL #${item.linked_ref_id}`}`;
		}
		if (item.linked_ref_type === 'packing_request') return '📦 Diajukan via Packing List';
		return null;
	}

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			rows = await fetchForecastForProject(projectId);
			plNumbers = await fetchPlNumbers(rows);
			stockMap = await checkStockAvailability(
				rows.filter((r) => r.ref_type !== 'equipment' && r.ref_id && /^\d+$/.test(String(r.ref_id))).map((r) => Number(r.ref_id))
			);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat kebutuhan.';
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (open && projectId) load();
	});

	function stageLabel(key: string | null): string {
		if (!key) return 'Belum Ditentukan Tahap';
		return mobStagesSetting.find((s) => s.key === key)?.label || key;
	}

	const STATUS_LABELS: Record<string, string> = {
		forecast: 'Direncanakan',
		acknowledged: 'Disiapkan Gudang',
		in_progress: 'Dalam Proses',
		ready: 'Siap',
		shipped: 'Dalam Pengiriman',
		arrived: 'Tiba',
		cancelled: 'Dibatalkan'
	};

	let groups = $derived.by(() => {
		const map = new Map<string, ForecastRow[]>();
		for (const r of rows) {
			const key = r.mob_stage || '_none';
			if (!map.has(key)) map.set(key, []);
			map.get(key)!.push(r);
		}
		return [...map.entries()].sort(([a], [b]) => (a === '_none' ? 'zzz' : a).localeCompare(b === '_none' ? 'zzz' : b));
	});

	function close() {
		open = false;
	}

	// Berdampingan dengan "Ajukan Pengiriman" (Q2): ini membuka form Packing List dengan item
	// tahap ini sudah ter-centang, bukan sekadar memberi tahu PM.
	function handleBuatPl(stageKey: string) {
		close();
		goto(`/packing-list/baru?project_id=${projectId}&mob_stage=${encodeURIComponent(stageKey)}&source=forecast`);
	}

	async function handleAjukanPengiriman(stageKey: string) {
		if (stageKey === '_none') return;
		requestingStage = stageKey;
		errorMsg = '';
		try {
			const itemRows = groups.find(([k]) => k === stageKey)?.[1] || [];
			const result = await requestMobilization({
				projectId,
				projectName,
				mobStage: stageKey,
				mobStageLabel: stageLabel(stageKey),
				requestedByName,
				items: itemRows.map((r) => ({ refName: r.ref_name, qty: r.qty, unit: r.unit, refType: r.ref_type }))
			});
			if (result.success) {
				requestedStages = new Set([...requestedStages, stageKey]);
			} else {
				errorMsg = result.error || 'Gagal mengajukan pengiriman.';
			}
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal mengajukan pengiriman.';
		} finally {
			requestingStage = null;
		}
	}
</script>

{#if open}
	<div class="sheet-overlay" onclick={close} role="presentation">
		<div class="sheet-content" onclick={(e) => e.stopPropagation()} role="dialog">
			<div class="sheet-handle"></div>
			<div class="sheet-header">
				<h3>📦 Kebutuhan Logistik & Alat Fase Ini</h3>
				<button class="sheet-close" onclick={close}><IconX size={20} /></button>
			</div>

			<div class="sheet-body">
				{#if loading}
					<div class="kf-loading"><CircularProgressGauge size={44} strokeWidth={3} label="Memuat kebutuhan barang/alat..." /></div>
				{:else if rows.length === 0}
					<p class="kf-empty">Belum ada kebutuhan barang/alat tercatat untuk proyek ini. Admin mengisinya lewat drawer spek subtask di Timeline.</p>
				{:else}
					<p class="kf-hint">
						Pastikan cat &amp; alat sudah siap sebelum pekerjaan dimulai. "📦 Buat PL" membuka form Packing List dengan barang
						tahap ini sudah terpilih. "Ajukan Pengiriman" hanya memberi tahu PM &amp; gudang — lakukan minimal 3 hari sebelum
						jadwal agar logistik pusat sempat mengirim.
					</p>
					{#each groups as [stageKey, items] (stageKey)}
						<div class="kf-stage-group">
							<div class="kf-stage-header">
								<span class="kf-stage-label">{stageLabel(stageKey === '_none' ? null : stageKey)}</span>
								<button class="kf-copy-btn" title="Salin daftar kebutuhan tahap ini sebagai teks (untuk WhatsApp gudang/vendor)" onclick={() => copyStageSummary(stageKey, items)}>
									{copiedStage === stageKey ? '✓ Tersalin' : '📋 Salin'}
								</button>
								{#if stageKey !== '_none'}
									<button
										class="kf-pl-btn"
										title="Buka form Packing List dengan barang tahap ini sudah terpilih"
										onclick={() => handleBuatPl(stageKey)}
									>
										📦 Buat PL
									</button>
									{#if requestedStages.has(stageKey)}
										<span class="kf-requested-badge">✓ Sudah diajukan</span>
									{:else}
										<button
											class="kf-request-btn"
											disabled={requestingStage === stageKey}
											onclick={() => handleAjukanPengiriman(stageKey)}
										>
											{requestingStage === stageKey ? 'Mengajukan…' : `Ajukan Pengiriman`}
										</button>
									{/if}
								{/if}
							</div>
							{#each items as item (item.id)}
								<div class="kf-item-row">
									<div class="kf-item-name">
										{item.ref_name}
										{#if stockLevel(item)}{@const sl = stockLevel(item)}<Tooltip text={sl?.text ?? ''} position="top"><span class="kf-item-stock">{sl?.icon}</span></Tooltip>{/if}
										{#if linkedLabel(item)}<span class="kf-item-link">{linkedLabel(item)}</span>{/if}
									</div>
									<div class="kf-item-qty">{item.qty} {item.unit || ''}</div>
									<div class="kf-item-status kf-status-{item.status}">{STATUS_LABELS[item.status] || item.status}</div>
								</div>
							{/each}
						</div>
					{/each}
				{/if}

				{#if errorMsg}
					<div class="error-msg">{errorMsg}</div>
				{/if}
			</div>
		</div>
	</div>
{/if}

<style>
	.sheet-overlay {
		position: fixed; inset: 0; background: rgba(0, 0, 0, 0.5); z-index: 1000;
		display: flex; align-items: flex-end; justify-content: center;
	}
	.sheet-content {
		background: white; width: 100%; max-width: 480px; border-radius: 20px 20px 0 0;
		max-height: 88vh; display: flex; flex-direction: column; overflow: hidden;
	}
	.sheet-handle { width: 36px; height: 4px; background: #d1d5db; border-radius: 2px; margin: 10px auto 0; }
	.sheet-header { display: flex; justify-content: space-between; align-items: center; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
	.sheet-header h3 { margin: 0; font-size: 15px; font-weight: 700; color: #1e293b; }
	.sheet-close { background: none; border: none; color: #64748b; padding: 4px; }
	.sheet-body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }

	.kf-loading { display: flex; align-items: center; gap: 8px; font-size: 13px; color: #64748b; padding: 20px 0; justify-content: center; }
	.kf-empty { font-size: 13px; color: #64748b; text-align: center; padding: 20px 8px; line-height: 1.6; }
	.kf-hint { font-size: 11px; color: #64748b; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 8px 10px; line-height: 1.5; }

	.kf-stage-group { border: 1px solid #e2e8f0; border-radius: 12px; padding: 10px 12px; }
	.kf-stage-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; flex-wrap: wrap; }
	.kf-stage-label { font-size: 12.5px; font-weight: 700; color: #1e293b; }
	.kf-request-btn {
		font-size: 11px; font-weight: 700; color: white; background: #2563eb;
		border: none; border-radius: 8px; padding: 5px 10px; cursor: pointer;
	}
	.kf-request-btn:disabled { opacity: 0.6; }
	.kf-pl-btn {
		font-size: 11px; font-weight: 700; color: #1d4ed8; background: #eff6ff;
		border: 1px solid #bfdbfe; border-radius: 8px; padding: 5px 10px; cursor: pointer; margin-left: auto;
	}
	.kf-requested-badge { font-size: 11px; font-weight: 700; color: #16a34a; }

	.kf-item-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 5px 0; border-top: 1px solid #f1f5f9; font-size: 12px; }
	.kf-item-row:first-of-type { border-top: none; }
	.kf-item-name { flex: 1; color: #334155; }
	.kf-copy-btn { font-size: 11px; font-weight: 600; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 5px 8px; cursor: pointer; }
	.kf-item-stock { margin-left: 4px; font-size: 10px; }
	.kf-item-link { display: block; font-size: 10px; color: #1d4ed8; margin-top: 1px; }
	.kf-item-qty { color: #64748b; font-variant-numeric: tabular-nums; }
	.kf-item-status { font-size: 10.5px; font-weight: 700; padding: 2px 7px; border-radius: 999px; background: #f1f5f9; color: #475569; white-space: nowrap; }
	.kf-status-forecast { background: #f1f5f9; color: #64748b; }
	.kf-status-acknowledged, .kf-status-in_progress { background: #fef3c7; color: #92400e; }
	.kf-status-ready, .kf-status-shipped { background: #dbeafe; color: #1d4ed8; }
	.kf-status-arrived { background: #dcfce7; color: #15803d; }

	.error-msg { font-size: 12px; color: #dc2626; background: #fef2f2; padding: 8px 10px; border-radius: 10px; }
</style>
