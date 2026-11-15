<!-- src/lib/components/project/AiBriefingLapanganCard.svelte -->
<!-- Kartu "Briefing Lapangan" (PASIF): rangkuman 1–7 hari ke depan untuk Project Leader, dihitung server erp-epi dari data
     proyek ini. Leader HANYA menerima hasil — tidak ada tombol hitung ulang (hemat server & biaya). Gagal memuat =>
     tampil salinan terakhir di perangkat (diberi label), atau pesan ringan; halaman tetap normal.
     Centang langkah = catatan pribadi di perangkat ini, per hari; tidak dikirim ke server. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import {
		fetchFieldBriefing, loadOfflineBriefing, loadChecked, saveChecked, ageLabel,
		type FieldBriefing, type BriefingStatus
	} from '$lib/services/projectAiBriefing';

	let { projectId }: { projectId: number | string } = $props();

	let briefing = $state<FieldBriefing | null>(null);
	let loading = $state(true);
	/** Bila bukan null: data berasal dari salinan perangkat (offline / server gagal) per tanggal ini. */
	let offlineSavedAt = $state<string | null>(null);
	let errorMsg = $state('');
	let checked = $state<Set<string>>(new Set());
	let open = $state(true);

	const COLOR: Record<BriefingStatus, string> = { ok: '#22c55e', info: '#38bdf8', warning: '#f59e0b', danger: '#ef4444', unknown: '#cbd5e1' };
	const LABEL: Record<BriefingStatus, string> = { ok: 'Aman', info: 'Info', warning: 'Perhatian', danger: 'Mendesak', unknown: 'Belum terukur' };

	async function load() {
		loading = true;
		errorMsg = '';
		offlineSavedAt = null;
		try {
			briefing = await fetchFieldBriefing(projectId);
		} catch (e: any) {
			const off = loadOfflineBriefing(projectId);
			if (off) {
				briefing = off.briefing;
				offlineSavedAt = off.savedAt;
			} else {
				errorMsg = e?.message || 'Gagal memuat briefing.';
			}
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		checked = loadChecked(projectId);
		load();
	});

	function toggle(key: string) {
		const next = new Set(checked);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		checked = next;
		saveChecked(projectId, next);
	}

	let items = $derived(briefing?.items ?? []);
	let actionable = $derived(items.filter((i) => i.action));
	let doneCount = $derived(actionable.filter((i) => checked.has(i.key)).length);
	let status = $derived<BriefingStatus>(briefing?.status ?? 'unknown');
	let ageText = $derived(ageLabel(briefing?.generated_at));
	let offlineDate = $derived(
		offlineSavedAt ? new Date(offlineSavedAt).toLocaleString('id-ID', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''
	);
</script>

{#if loading}
	<div class="ab-card ab-muted" data-testid="ab-loading"><CircularProgressGauge size={42} strokeWidth={3} label="Menyiapkan briefing 1–7 hari..." /></div>
{:else if errorMsg}
	<div class="ab-card ab-muted" data-testid="ab-error">
		Briefing lapangan belum bisa dimuat ({errorMsg}).
		<button class="ab-btn" onclick={load}>Coba lagi</button>
	</div>
{:else if briefing && !briefing.available}
	{#if briefing.reason}
		<div class="ab-card ab-muted" data-testid="ab-unavailable">{briefing.reason}</div>
	{/if}
{:else if briefing}
	<div class="ab-card" data-testid="ab-card">
		<button class="ab-head" onclick={() => (open = !open)} aria-expanded={open} title="Buka / tutup briefing">
			<span class="ab-title">
				<span class="ab-dot" style="background:{COLOR[status]}"></span>
				🧭 Briefing Lapangan · 1–7 Hari
			</span>
			<span class="ab-badge" style="color:{COLOR[status]}" data-testid="ab-status">{LABEL[status]}</span>
		</button>

		{#if offlineSavedAt}
			<div class="ab-offline" data-testid="ab-offline">📴 Data offline per {offlineDate} — tersambung kembali untuk melihat yang terbaru.</div>
		{/if}

		{#if open}
			<p class="ab-hint">
				Dihitung otomatis dari data proyek ini (material, jadwal, kehadiran, pengajuan dana). Anda tidak perlu menekan apa pun —
				kartu ini diperbarui server{ageText ? `, terakhir ${ageText}` : ''}. Centang hanyalah catatan pribadi di HP ini.
			</p>

			{#if briefing.coverage && briefing.coverage !== 'terukur'}
				<div class="ab-gap" data-testid="ab-coverage">{briefing.summary}</div>
			{:else if items.length === 0}
				<div class="ab-ok" data-testid="ab-clear">✓ {briefing.summary || 'Tidak ada hal mendesak untuk 1–7 hari ke depan.'}</div>
			{/if}

			{#each items as it (it.key)}
				<div class="ab-row" class:ab-done={checked.has(it.key)} data-testid="ab-item">
					<span class="ab-dot ab-dot-top" style="background:{COLOR[it.status]}" title={LABEL[it.status]}></span>
					<div class="ab-main">
						<div class="ab-name">{it.title}</div>
						<div class="ab-sub">{it.evidence}</div>
						{#if it.action}
							<label class="ab-act">
								<input type="checkbox" checked={checked.has(it.key)} onchange={() => toggle(it.key)} />
								<span><b>Lakukan:</b> {it.action}{#if it.pic} <span class="ab-pic">(PIC: {it.pic})</span>{/if}</span>
							</label>
						{/if}
					</div>
				</div>
			{/each}

			{#if actionable.length > 0}
				<div class="ab-progress" data-testid="ab-progress">{doneCount}/{actionable.length} langkah dicentang hari ini</div>
			{/if}

			{#each briefing.gaps ?? [] as g (g.key)}
				<div class="ab-gap">Belum terukur — {g.title}. {g.reason}</div>
			{/each}
		{/if}
	</div>
{/if}

<style>
	.ab-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
	.ab-muted { font-size: 12px; color: #64748b; flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; }
	.ab-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; background: none; border: none; padding: 0; cursor: pointer; width: 100%; text-align: left; }
	.ab-title { display: inline-flex; align-items: center; gap: 7px; font-size: 13px; font-weight: 700; color: #1e293b; }
	.ab-badge { font-size: 11px; font-weight: 700; }
	.ab-dot { width: 10px; height: 10px; border-radius: 50%; flex-shrink: 0; }
	.ab-dot-top { margin-top: 4px; }
	.ab-btn { font-size: 11px; font-weight: 600; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 8px; cursor: pointer; }
	.ab-hint { font-size: 11px; color: #64748b; line-height: 1.5; margin: 0; }
	.ab-offline { font-size: 11.5px; color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 10px; padding: 6px 10px; }
	.ab-row { display: flex; gap: 10px; align-items: flex-start; padding: 7px 0; border-top: 1px solid #f1f5f9; }
	.ab-row.ab-done .ab-name { text-decoration: line-through; color: #94a3b8; }
	.ab-main { flex: 1; min-width: 0; }
	.ab-name { font-size: 12.5px; font-weight: 600; color: #1e293b; }
	.ab-sub { font-size: 11px; color: #64748b; margin-top: 1px; }
	.ab-act { display: flex; gap: 8px; align-items: flex-start; margin-top: 6px; font-size: 12px; color: #0f172a; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 7px 9px; cursor: pointer; }
	.ab-act input { margin-top: 2px; width: 16px; height: 16px; flex-shrink: 0; }
	.ab-pic { color: #64748b; }
	.ab-progress { font-size: 11px; color: #475569; font-weight: 600; }
	.ab-ok { font-size: 12px; color: #15803d; background: #f0fdf4; border-radius: 10px; padding: 7px 10px; }
	.ab-gap { font-size: 11.5px; color: #475569; background: #f8fafc; border: 1px dashed #cbd5e1; border-radius: 10px; padding: 6px 10px; }
</style>
