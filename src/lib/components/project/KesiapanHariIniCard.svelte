<!-- src/lib/components/project/KesiapanHariIniCard.svelte -->
<!-- Kartu "Kesiapan Hari Ini" (Status Realisasi Subtask, Fase 5): subtask yang aktif hari ini atau mulai dalam H-N,
     beserta material/alat/manpower yang belum siap. Data dari erp-epi /fulfillment (read-only). Gagal memuat ->
     kartu menampilkan pesan ringan, halaman tetap normal. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import Tooltip from '$lib/components/ui/Tooltip.svelte';
	import { IconLoader2, IconRefresh } from '@tabler/icons-svelte';
	import { fetchProjectFulfillment, reportShortage, type ProjectFulfillment, type FulfillmentSubtask } from '$lib/services/projectFulfillment';
	import { authStore, getUserDisplay } from '$lib/stores/auth';

	let { projectId }: { projectId: number | string } = $props();

	let data = $state<ProjectFulfillment | null>(null);
	let loading = $state(true);
	let errorMsg = $state('');
	// H-N dari setelan admin, dikirim server bersama datanya (default 3 bila belum ada).
	let lookahead = $derived(data?.config?.notReadyDays || 3);

	// L3 — lapor kekurangan 1-klik: form catatan inline per subtask; server meneruskan ke dept Project (in-app).
	let reportingId = $state<string | null>(null);
	let reportNote = $state('');
	let sending = $state(false);
	let reportedIds = $state<Set<string>>(new Set());
	let reportMsg = $state<{ id: string; ok: boolean; text: string } | null>(null);

	async function sendReport(s: FulfillmentSubtask) {
		sending = true;
		reportMsg = null;
		const res = await reportShortage(projectId, {
			subtaskId: s.id,
			note: reportNote.trim(),
			reportedByName: getUserDisplay($authStore.user) || $authStore.karyawanName || 'Leader'
		});
		sending = false;
		if (res.success) {
			reportedIds = new Set([...reportedIds, s.id]);
			reportingId = null;
			reportNote = '';
		} else {
			reportMsg = { id: s.id, ok: false, text: res.error || 'Gagal melapor.' };
		}
	}

	const STATE_LABEL: Record<string, string> = {
		none: 'Belum ada kebutuhan tercatat',
		ready: 'Siap',
		partial: 'Sebagian siap',
		problem: 'Terlambat / kurang'
	};
	const STATE_COLOR: Record<string, string> = { none: '#cbd5e1', ready: '#22c55e', partial: '#facc15', problem: '#ef4444' };

	async function load(force = false) {
		loading = true;
		errorMsg = '';
		try {
			data = await fetchProjectFulfillment(projectId, force);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat kesiapan.';
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
	});

	function addDays(d: string, n: number): string {
		const x = new Date(`${d}T00:00:00Z`);
		x.setUTCDate(x.getUTCDate() + n);
		return x.toISOString().slice(0, 10);
	}

	// Subtask relevan: aktif hari ini, atau mulai dalam H-N. Yang sudah lewat seluruhnya / terlalu jauh disembunyikan.
	let relevant = $derived.by<FulfillmentSubtask[]>(() => {
		if (!data) return [];
		const horizon = addDays(data.today, lookahead);
		return (data.subtasks || [])
			.filter((s) => s.first && s.last && s.first <= horizon && s.last >= data!.today)
			.sort((a, b) => Number(b.activeToday) - Number(a.activeToday) || (a.first || '').localeCompare(b.first || ''));
	});
	let issues = $derived(relevant.filter((s) => s.readiness.state === 'problem' || s.readiness.state === 'partial'));
	let shortRoles = $derived((data?.manpowerToday?.roles || []).filter((r) => r.shortage > 0));
</script>

{#if loading}
	<div class="kh-card kh-muted"><CircularProgressGauge size={42} strokeWidth={3} label="Memuat kesiapan hari ini..." /></div>
{:else if errorMsg}
	<div class="kh-card kh-muted">
		Kesiapan hari ini belum bisa dimuat ({errorMsg}).
		<button class="kh-btn" onclick={() => load(true)}>Coba lagi</button>
	</div>
{:else if data && relevant.length > 0}
	<div class="kh-card">
		<div class="kh-head">
			<span>🚦 Kesiapan Hari Ini</span>
			<button class="kh-btn" title="Ambil ulang data terbaru" onclick={() => load(true)}><IconRefresh size={13} /> Segarkan</button>
		</div>
		<p class="kh-hint">
			Subtask yang berjalan hari ini atau mulai ≤ {lookahead} hari lagi. Titik hijau = material, alat &amp; manpower sudah siap.
			Merah/kuning = ada yang belum — hubungi PM/gudang atau ajukan pengiriman di Timeline → Kebutuhan.
		</p>

		{#if shortRoles.length > 0}
			<div class="kh-alert">
				👷 Manpower hari ini kurang: {shortRoles.map((r) => `${r.role} (kurang ${r.shortage})`).join(', ')}
			</div>
		{/if}

		{#each relevant as s (s.id)}
			<div class="kh-row">
				<Tooltip text={STATE_LABEL[s.readiness.state]} position="right"><span class="inline-flex p-2 -m-2"><span class="kh-dot" style="background:{STATE_COLOR[s.readiness.state]}"></span></span></Tooltip>
				<div class="kh-main">
					<div class="kh-name">{s.name || '(tanpa nama)'}</div>
					<div class="kh-sub">
						{s.category} · {s.activeToday ? 'Aktif hari ini' : `Mulai ${s.first}`}
						{#if s.readiness.total > 0} · {s.readiness.ready}/{s.readiness.total} siap{/if}
					</div>
					{#if s.readiness.reasons.length > 0}
						<div class="kh-reason">{s.readiness.reasons.slice(0, 3).join(' · ')}</div>
					{/if}
					{#if s.readiness.state === 'problem' || s.readiness.state === 'partial'}
						{#if reportedIds.has(s.id)}
							<div class="kh-sent">✓ Sudah dilaporkan ke tim Project</div>
						{:else if reportingId === s.id}
							<div class="kh-form">
								<textarea
									class="kh-note"
									rows="2"
									maxlength="500"
									placeholder="Catatan (opsional): apa yang kurang, berapa banyak, kapan dibutuhkan"
									bind:value={reportNote}
								></textarea>
								<div class="kh-form-actions">
									<button class="kh-send" disabled={sending} onclick={() => sendReport(s)}>{sending ? 'Mengirim…' : 'Kirim Laporan'}</button>
									<button class="kh-btn" disabled={sending} onclick={() => { reportingId = null; reportMsg = null; }}>Batal</button>
								</div>
								{#if reportMsg && reportMsg.id === s.id}<div class="kh-err">{reportMsg.text}</div>{/if}
							</div>
						{:else}
							<button class="kh-report" title="Beri tahu tim Project bahwa subtask ini kekurangan material/alat/manpower (notifikasi langsung, maksimal 1x per jam per subtask)" onclick={() => { reportingId = s.id; reportNote = ''; reportMsg = null; }}>
								🚨 Lapor kekurangan
							</button>
						{/if}
					{/if}
				</div>
			</div>
		{/each}

		{#if issues.length === 0}
			<div class="kh-ok">✓ Semua subtask yang relevan sudah siap.</div>
		{/if}

		<button class="kh-link" onclick={() => goto(`/timeline/${projectId}`)}>Buka Timeline → Kebutuhan &amp; Surat Jalan</button>
	</div>
{:else if data && data.forecastEmpty}
	<div class="kh-card kh-muted">Kebutuhan material &amp; alat proyek ini belum dicatat admin di Timeline, jadi kesiapan belum bisa ditampilkan.</div>
{/if}

<style>
	.kh-card { background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; }
	.kh-muted { font-size: 12px; color: #64748b; flex-direction: row; align-items: center; gap: 8px; flex-wrap: wrap; }
	.kh-head { display: flex; justify-content: space-between; align-items: center; font-size: 13px; font-weight: 700; color: #1e293b; }
	.kh-btn { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; font-weight: 600; color: #475569; background: #f1f5f9; border: 1px solid #e2e8f0; border-radius: 8px; padding: 4px 8px; cursor: pointer; }
	.kh-hint { font-size: 11px; color: #64748b; line-height: 1.5; margin: 0; }
	.kh-alert { font-size: 12px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 7px 10px; }
	.kh-row { display: flex; gap: 10px; align-items: flex-start; padding: 6px 0; border-top: 1px solid #f1f5f9; }
	.kh-dot { width: 11px; height: 11px; border-radius: 50%; margin-top: 4px; flex-shrink: 0; }
	.kh-main { flex: 1; min-width: 0; }
	.kh-name { font-size: 12.5px; font-weight: 600; color: #1e293b; }
	.kh-sub { font-size: 11px; color: #64748b; }
	.kh-reason { font-size: 11px; color: #b91c1c; margin-top: 2px; }
	.kh-report { margin-top: 4px; font-size: 11px; font-weight: 700; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 3px 8px; cursor: pointer; }
	.kh-sent { margin-top: 4px; font-size: 11px; font-weight: 600; color: #15803d; }
	.kh-form { margin-top: 6px; display: flex; flex-direction: column; gap: 6px; }
	.kh-note { width: 100%; font-size: 12px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 6px 8px; resize: vertical; }
	.kh-form-actions { display: flex; gap: 6px; }
	.kh-send { font-size: 11px; font-weight: 700; color: white; background: #dc2626; border: none; border-radius: 8px; padding: 5px 10px; cursor: pointer; }
	.kh-send:disabled { opacity: 0.6; }
	.kh-err { font-size: 11px; color: #dc2626; }
	.kh-ok { font-size: 12px; color: #15803d; background: #f0fdf4; border-radius: 10px; padding: 7px 10px; }
	.kh-link { align-self: flex-start; font-size: 12px; font-weight: 700; color: #1d4ed8; background: none; border: none; padding: 0; cursor: pointer; }
</style>
