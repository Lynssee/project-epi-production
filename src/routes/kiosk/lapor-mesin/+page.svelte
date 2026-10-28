<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount, onDestroy } from 'svelte';
	import { createFormPersist, registerFormPersistSaveTriggers } from '$lib/utils/formPersist';
	import FormDraftBar from '$lib/components/shared/FormDraftBar.svelte';
	import {
		IconArrowLeft,
		IconLoader2,
		IconCheck,
		IconTool,
		IconAlertTriangle,
		IconAlertCircle,
		IconInfoCircle,
		IconFlame,
		IconSend,
		IconCircleCheck,
		IconSparkles
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let equipmentList = $state<any[]>([]);
	let equipmentId = $state<string | number | null>(null);
	let masalah = $state('');
	let prioritas = $state<'low' | 'medium' | 'high' | 'critical'>('medium');
	let submitting = $state(false);
	let errorMsg = $state('');
	let showSuccess = $state(false);
	let clientTxnId = $state('');
	let successTicket = $state<{ nomor_tiket?: string; equipment_name?: string; prioritas?: string } | null>(null);
	let countdown = $state(3);
	let countdownInterval: ReturnType<typeof setInterval> | null = null;

	// Draf Otomatis (Fase 5 Lapis 2): equipmentId & masalah punya name/id DOM, tapi
	// prioritas dipilih lewat tombol (bukan input/select) -- tidak tertangkap Lapis 1.
	// Kiosk dipakai bergilir antar operator; scope tetap global per-perangkat sekarang,
	// purge saat ganti operator adalah pekerjaan Fase 6 (lihat rencana implementasi).
	interface LaporMesinDraft {
		equipmentId: string | number | null;
		masalah: string;
		prioritas: 'low' | 'medium' | 'high' | 'critical';
	}
	const persist = createFormPersist<LaporMesinDraft>('kiosk_lapor_mesin');
	let draftRestoreInfo = $state<{ savedAt: number | null; apply: () => void; discard: () => void } | null>(null);
	let draftArmed = $state(false);

	const snapshot = (): LaporMesinDraft => ({ equipmentId, masalah, prioritas });

	function applyDraft(draft: LaporMesinDraft) {
		if (draft.equipmentId != null) equipmentId = draft.equipmentId;
		if (draft.masalah) masalah = draft.masalah;
		if (draft.prioritas) prioritas = draft.prioritas;
	}

	function checkDraft() {
		const draft = persist.restore();
		if (!draft) return;
		draftRestoreInfo = {
			savedAt: persist.savedAt(),
			apply: () => applyDraft(draft),
			discard: () => persist.clear()
		};
	}

	const QUICK_ISSUES = [
		'Mesin Mati / Tidak Nyala',
		'Bunyi Kasar / Berisik',
		'Bocor Oli / Pelumas',
		'Overheat / Suhu Tinggi',
		'Macet / Jamming Part',
		'Sensor / Elektrik Error',
		'Getaran Tidak Normal'
	];

	const PRIORITIES = [
		{
			id: 'low',
			label: 'Rendah',
			desc: 'Operasi lancar, kendala minor',
			icon: IconInfoCircle,
			color: '#0284c7',
			bgActive: '#0284c7',
			textActive: '#ffffff'
		},
		{
			id: 'medium',
			label: 'Sedang',
			desc: 'Kinerja turun, perlu perbaikan',
			icon: IconAlertCircle,
			color: '#d97706',
			bgActive: '#d97706',
			textActive: '#ffffff'
		},
		{
			id: 'high',
			label: 'Tinggi',
			desc: 'Beresiko macet / produk cacat',
			icon: IconAlertTriangle,
			color: '#ea580c',
			bgActive: '#ea580c',
			textActive: '#ffffff'
		},
		{
			id: 'critical',
			label: 'Kritis',
			desc: 'MESIN MATI / DARURAT STOP',
			icon: IconFlame,
			color: '#dc2626',
			bgActive: '#dc2626',
			textActive: '#ffffff'
		}
	] as const;

	const selectedEquipment = $derived(
		equipmentList.find((e) => String(e.id) === String(equipmentId)) || null
	);

	// File 12 §D item 2 — daftar difilter kategori produksi secara default (setelan
	// kiosk.lapor_mesin_kategori); "Mesin lain..." menampilkan SEMUA equipment untuk kasus
	// mesin di luar kategori itu tetap bisa dilaporkan (Aturan #6, jangan matikan jalur).
	let tampilkanSemuaMesin = $state(false);

	async function loadEquipment(semua: boolean) {
		try {
			const res = await fetch(`/api/kiosk/lapor-mesin${semua ? '?semua=1' : ''}`);
			if (res.ok) {
				const data = await res.json();
				equipmentList = data.equipment || [];
			}
		} finally {
			loading = false;
		}
	}

	function tampilkanMesinLain() {
		tampilkanSemuaMesin = true;
		loading = true;
		loadEquipment(true);
	}

	onMount(async () => {
		checkDraft();
		draftArmed = true;
		loading = true;
		await loadEquipment(false);
	});

	$effect(() => {
		void snapshot();
		if (!draftArmed) return;
		persist.save(snapshot());
	});
	$effect(() => registerFormPersistSaveTriggers(persist, snapshot));

	onDestroy(() => {
		if (countdownInterval) clearInterval(countdownInterval);
	});

	function addQuickIssue(issue: string) {
		if (!masalah.trim()) {
			masalah = issue;
		} else if (!masalah.includes(issue)) {
			masalah = `${masalah.trim()}, ${issue}`;
		}
	}

	async function submit() {
		errorMsg = '';
		if (!equipmentId) {
			errorMsg = 'Pilih mesin / equipment terlebih dahulu.';
			return;
		}
		if (!masalah.trim()) {
			errorMsg = 'Jelaskan masalahnya atau pilih salah satu tombol masalah cepat di bawah.';
			return;
		}

		submitting = true;
		if (!clientTxnId) clientTxnId = crypto.randomUUID();
		try {
			const res = await fetch('/api/kiosk/lapor-mesin', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ equipmentId, masalah: masalah.trim(), prioritas, clientTxnId })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || 'Gagal menyimpan laporan.');
			clientTxnId = '';
			persist.clear();
			draftRestoreInfo = null;

			successTicket = {
				nomor_tiket: data?.data?.data?.nomor_tiket || data?.data?.nomor_tiket || 'TIKET-BARU',
				equipment_name: selectedEquipment ? `${selectedEquipment.code} — ${selectedEquipment.name}` : undefined,
				prioritas
			};

			showSuccess = true;
			countdown = 3;
			countdownInterval = setInterval(() => {
				countdown -= 1;
				if (countdown <= 0) {
					if (countdownInterval) clearInterval(countdownInterval);
					goto('/kiosk/home');
				}
			}, 1000);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal menyimpan laporan.';
		} finally {
			submitting = false;
		}
	}
</script>

{#if showSuccess}
	<div class="success-overlay">
		<div class="success-modal">
			<div class="success-icon-wrap">
				<IconCircleCheck size={68} class="text-emerald-500" />
			</div>

			<h2 class="success-title">Laporan Berhasil Terkirim!</h2>
			<p class="success-sub">Tiket perbaikan telah diterbitkan dan diteruskan ke tim mekanik & supervisor.</p>

			{#if successTicket}
				<div class="ticket-summary">
					<div class="summary-row">
						<span class="summary-label">Nomor Tiket</span>
						<span class="summary-val mono">{successTicket.nomor_tiket}</span>
					</div>
					{#if successTicket.equipment_name}
						<div class="summary-row">
							<span class="summary-label">Mesin</span>
							<span class="summary-val">{successTicket.equipment_name}</span>
						</div>
					{/if}
					<div class="summary-row">
						<span class="summary-label">Prioritas</span>
						<span class="summary-badge prio-{successTicket.prioritas}">
							{successTicket.prioritas?.toUpperCase()}
						</span>
					</div>
				</div>
			{/if}

			<div class="countdown-bar">
				Kembali ke Menu Kiosk dalam <strong>{countdown} detik</strong>...
			</div>

			<button
				class="success-btn"
				onclick={() => {
					if (countdownInterval) clearInterval(countdownInterval);
					goto('/kiosk/home');
				}}
			>
				Kembali ke Menu Sekarang
			</button>
		</div>
	</div>
{:else}
	<div class="kiosk-page">
		<div class="kiosk-card">
			<!-- Header -->
			<div class="card-header">
				<button class="back-btn" onclick={() => goto('/kiosk/home')} aria-label="Kembali ke menu">
					<IconArrowLeft size={24} />
				</button>
				<div class="header-titles">
					<h1>Lapor Masalah Mesin</h1>
					<p class="subtitle">Laporkan kerusakan, gangguan suara, atau kebocoran untuk perbaikan mekanik</p>
				</div>
			</div>

			<FormDraftBar
				restoreInfo={draftRestoreInfo}
				onApplied={() => (draftRestoreInfo = null)}
			/>

			{#if loading}
				<div class="py-12 flex justify-center">
					<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Mesin & Equipment..." sublabel="Mengambil master aset pabrik" />
				</div>
			{:else}
				{#if errorMsg}
					<div class="error-banner">
						<IconAlertTriangle size={22} class="shrink-0" />
						<span>{errorMsg}</span>
					</div>
				{/if}

				<!-- Field 1: Mesin / Equipment -->
				<div class="field-group">
					<div class="field-header">
						<div class="field-label-group">
							<IconTool size={18} class="text-slate-500" />
							<span class="field-label">Mesin / Equipment</span>
						</div>
						<span class="field-count">{equipmentList.length} mesin terdaftar</span>
					</div>

					<div class="select-wrap">
						<select class="kiosk-select" bind:value={equipmentId}>
							<option value={null}>-- Pilih mesin yang bermasalah --</option>
							{#each equipmentList as eq}
								<option value={eq.id}>[{eq.code}] {eq.name}</option>
							{/each}
						</select>
					</div>
					{#if !tampilkanSemuaMesin}
						<button type="button" class="mesin-lain-btn" onclick={tampilkanMesinLain}>
							Mesin yang dicari tidak ada? Tampilkan semua mesin
						</button>
					{/if}

					{#if selectedEquipment}
						<div class="equipment-preview">
							<span class="eq-code">{selectedEquipment.code}</span>
							<span class="eq-name">{selectedEquipment.name}</span>
							{#if selectedEquipment.parent_category}
								<span class="eq-category">{selectedEquipment.parent_category}</span>
							{/if}
						</div>
					{/if}
				</div>

				<!-- Field 2: Prioritas -->
				<div class="field-group">
					<div class="field-header">
						<div class="field-label-group">
							<IconAlertTriangle size={18} class="text-slate-500" />
							<span class="field-label">Tingkat Prioritas</span>
						</div>
						<span class="field-helper">Pilih sesuai dampak operasional mesin</span>
					</div>

					<div class="priority-grid">
						{#each PRIORITIES as p}
							<button
								type="button"
								class="priority-card"
								class:active={prioritas === p.id}
								style="--pcolor: {p.color}; --pbg: {p.bgActive}; --ptext: {p.textActive}"
								onclick={() => (prioritas = p.id)}
							>
								<div class="prio-head">
									<svelte:component this={p.icon} size={22} class="prio-icon" />
									<span class="prio-title">{p.label}</span>
									{#if prioritas === p.id}
										<span class="prio-check"><IconCheck size={14} /></span>
									{/if}
								</div>
								<span class="prio-desc">{p.desc}</span>
							</button>
						{/each}
					</div>

					{#if prioritas === 'critical'}
						<div class="critical-warning">
							<IconFlame size={20} class="shrink-0 text-red-600 animate-pulse" />
							<div>
								<strong>PERHATIAN — TIKET DARURAT</strong>
								<p>Tiket Kritis akan memicu eskalasi darurat otomatis ke Supervisor & Tim Maintenance.</p>
							</div>
						</div>
					{/if}
				</div>

				<!-- Field 3: Deskripsi Masalah & Quick Chips -->
				<div class="field-group">
					<div class="field-header">
						<div class="field-label-group">
							<IconSparkles size={18} class="text-slate-500" />
							<span class="field-label">Deskripsi Masalah</span>
						</div>
						<span class="field-helper">Bisa ketik atau pilih tombol cepat</span>
					</div>

					<!-- Quick Chips -->
					<div class="quick-chips">
						{#each QUICK_ISSUES as chip}
							<button
								type="button"
								class="chip-btn"
								class:chip-active={masalah.includes(chip)}
								onclick={() => addQuickIssue(chip)}
							>
								+ {chip}
							</button>
						{/each}
					</div>

					<textarea
						class="kiosk-textarea"
						rows="4"
						placeholder="Jelaskan detail kendala (misal: bagian mana yang bocor, suara mulai terdengar sejak jam berapa, dsb)..."
						bind:value={masalah}
					></textarea>
				</div>

				<!-- Submit Button -->
				<button class="submit-action-btn" disabled={submitting} onclick={submit}>
					{#if submitting}
						<IconLoader2 size={24} class="animate-spin" />
						<span>Menyimpan Laporan...</span>
					{:else}
						<IconSend size={24} />
						<span>KIRIM LAPORAN MESIN</span>
					{/if}
				</button>
			{/if}
		</div>
	</div>
{/if}

<style>
	.kiosk-page {
		min-height: 100%;
		padding: 1rem 1.25rem 1.5rem;
		display: flex;
		flex-direction: column;
		width: 100%;
		box-sizing: border-box;
	}

	.kiosk-card {
		width: 100%;
		max-width: 100%;
		box-sizing: border-box;
		background: #ffffff;
		border: 1.5px solid #e2e8f0;
		border-radius: 1.25rem;
		box-shadow: 0 4px 20px -2px rgba(15, 23, 42, 0.07);
		padding: 1.5rem;
		display: flex;
		flex-direction: column;
		gap: 1.5rem;
	}

	:global([data-theme='dark']) .kiosk-card {
		background: #1e293b;
		border-color: #334155;
		box-shadow: 0 4px 24px -2px rgba(0, 0, 0, 0.4);
	}

	/* Header */
	.card-header {
		display: flex;
		align-items: center;
		gap: 1rem;
		padding-bottom: 1rem;
		border-bottom: 1.5px solid #f1f5f9;
	}
	:global([data-theme='dark']) .card-header {
		border-bottom-color: #334155;
	}

	.back-btn {
		background: #f1f5f9;
		color: #1e293b;
		border: 1.5px solid #e2e8f0;
		border-radius: 0.75rem;
		width: 48px;
		height: 48px;
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.15s ease;
		flex-shrink: 0;
	}
	.back-btn:hover {
		background: #e2e8f0;
	}
	.back-btn:active {
		transform: scale(0.95);
	}
	:global([data-theme='dark']) .back-btn {
		background: #334155;
		color: #f8fafc;
		border-color: #475569;
	}
	:global([data-theme='dark']) .back-btn:hover {
		background: #475569;
	}

	.header-titles h1 {
		font-size: 1.35rem;
		font-weight: 800;
		margin: 0;
		color: #0f172a;
		letter-spacing: -0.01em;
	}
	:global([data-theme='dark']) .header-titles h1 {
		color: #f8fafc;
	}

	.subtitle {
		font-size: 0.875rem;
		color: #64748b;
		margin: 0.2rem 0 0;
	}
	:global([data-theme='dark']) .subtitle {
		color: #94a3b8;
	}

	/* Loading state */
	.loading-state {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		padding: 3.5rem 1rem;
		color: #64748b;
		font-weight: 600;
	}

	/* Error banner */
	.error-banner {
		background: #fef2f2;
		border: 1.5px solid #fecaca;
		color: #b91c1c;
		padding: 0.85rem 1rem;
		border-radius: 0.75rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-weight: 600;
		font-size: 0.95rem;
	}
	:global([data-theme='dark']) .error-banner {
		background: rgba(220, 38, 38, 0.15);
		border-color: rgba(220, 38, 38, 0.4);
		color: #fca5a5;
	}

	/* Field groups */
	.field-group {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.field-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
	}

	.field-label-group {
		display: flex;
		align-items: center;
		gap: 0.45rem;
	}

	.field-label {
		font-weight: 700;
		font-size: 0.975rem;
		color: #0f172a;
	}
	:global([data-theme='dark']) .field-label {
		color: #f1f5f9;
	}

	.field-count,
	.field-helper {
		font-size: 0.8rem;
		color: #64748b;
	}
	:global([data-theme='dark']) .field-count,
	:global([data-theme='dark']) .field-helper {
		color: #94a3b8;
	}
	.mesin-lain-btn {
		background: none;
		border: none;
		color: #2563eb;
		font-size: 0.85rem;
		font-weight: 600;
		text-decoration: underline;
		cursor: pointer;
		padding: 0.35rem 0;
		text-align: left;
	}

	/* Custom Select & Textarea (explicit override of dark/light mode collision) */
	.select-wrap {
		position: relative;
	}

	.kiosk-select,
	.kiosk-textarea {
		width: 100%;
		background-color: #ffffff !important;
		color: #0f172a !important;
		border: 2px solid #cbd5e1 !important;
		border-radius: 0.75rem;
		padding: 0.85rem 1rem;
		font-size: 1.05rem;
		font-family: inherit;
		outline: none;
		transition: border-color 0.15s ease, box-shadow 0.15s ease;
		box-sizing: border-box;
	}

	.kiosk-select {
		cursor: pointer;
		appearance: none;
		-webkit-appearance: none;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 1rem center;
		padding-right: 2.75rem;
	}

	:global([data-theme='dark']) .kiosk-select,
	:global([data-theme='dark']) .kiosk-textarea {
		background-color: #0f172a !important;
		color: #f8fafc !important;
		border-color: #334155 !important;
	}

	.kiosk-select:focus,
	.kiosk-textarea:focus {
		border-color: #dc2626 !important;
		box-shadow: 0 0 0 4px rgba(220, 38, 38, 0.15) !important;
	}

	.kiosk-textarea {
		resize: vertical;
		min-height: 105px;
		line-height: 1.5;
	}

	.equipment-preview {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		padding: 0.5rem 0.75rem;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.5rem;
		font-size: 0.85rem;
	}
	:global([data-theme='dark']) .equipment-preview {
		background: #0f172a;
		border-color: #334155;
	}

	.eq-code {
		font-family: monospace;
		font-weight: 700;
		background: #e2e8f0;
		padding: 0.15rem 0.45rem;
		border-radius: 0.35rem;
		color: #0f172a;
	}
	:global([data-theme='dark']) .eq-code {
		background: #334155;
		color: #f8fafc;
	}

	.eq-name {
		font-weight: 600;
		color: #334155;
	}
	:global([data-theme='dark']) .eq-name {
		color: #cbd5e1;
	}

	.eq-category {
		margin-left: auto;
		font-size: 0.75rem;
		background: #e0f2fe;
		color: #0369a1;
		padding: 0.15rem 0.45rem;
		border-radius: 0.35rem;
		font-weight: 600;
	}
	:global([data-theme='dark']) .eq-category {
		background: rgba(3, 105, 161, 0.2);
		color: #7dd3fc;
	}

	/* Priority Grid */
	.priority-grid {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 0.65rem;
	}
	@media (max-width: 640px) {
		.priority-grid {
			grid-template-columns: repeat(2, 1fr);
		}
	}

	.priority-card {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 0.35rem;
		padding: 0.85rem;
		border-radius: 0.75rem;
		border: 2px solid #e2e8f0;
		background: #ffffff;
		cursor: pointer;
		text-align: left;
		transition: all 0.15s ease;
	}
	:global([data-theme='dark']) .priority-card {
		background: #0f172a;
		border-color: #334155;
	}

	.priority-card:hover {
		border-color: var(--pcolor);
		transform: translateY(-1px);
	}

	.priority-card.active {
		background: var(--pbg);
		border-color: var(--pbg);
		color: var(--ptext);
		box-shadow: 0 4px 14px -2px rgba(0, 0, 0, 0.15);
	}

	.prio-head {
		width: 100%;
		display: flex;
		align-items: center;
		gap: 0.4rem;
	}

	:global(.prio-icon) {
		color: var(--pcolor);
		flex-shrink: 0;
	}
	.priority-card.active :global(.prio-icon) {
		color: var(--ptext);
	}

	.prio-title {
		font-weight: 800;
		font-size: 0.95rem;
		color: #0f172a;
	}
	:global([data-theme='dark']) .prio-title {
		color: #f8fafc;
	}
	.priority-card.active .prio-title {
		color: var(--ptext);
	}

	.prio-check {
		margin-left: auto;
		background: rgba(255, 255, 255, 0.25);
		border-radius: 999px;
		padding: 2px;
		display: flex;
	}

	.prio-desc {
		font-size: 0.75rem;
		line-height: 1.25;
		color: #64748b;
	}
	:global([data-theme='dark']) .prio-desc {
		color: #94a3b8;
	}
	.priority-card.active .prio-desc {
		color: rgba(255, 255, 255, 0.9);
	}

	/* Critical Warning Banner */
	.critical-warning {
		background: #fef2f2;
		border: 1.5px solid #fca5a5;
		border-radius: 0.75rem;
		padding: 0.75rem 1rem;
		display: flex;
		align-items: center;
		gap: 0.75rem;
	}
	:global([data-theme='dark']) .critical-warning {
		background: rgba(220, 38, 38, 0.15);
		border-color: rgba(220, 38, 38, 0.5);
	}
	.critical-warning strong {
		display: block;
		font-size: 0.85rem;
		color: #dc2626;
		margin-bottom: 0.1rem;
	}
	:global([data-theme='dark']) .critical-warning strong {
		color: #f87171;
	}
	.critical-warning p {
		margin: 0;
		font-size: 0.8rem;
		color: #991b1b;
	}
	:global([data-theme='dark']) .critical-warning p {
		color: #fca5a5;
	}

	/* Quick Chips */
	.quick-chips {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip-btn {
		background: #f1f5f9;
		border: 1px solid #e2e8f0;
		border-radius: 999px;
		padding: 0.35rem 0.75rem;
		font-size: 0.8rem;
		font-weight: 600;
		color: #334155;
		cursor: pointer;
		transition: all 0.15s ease;
	}
	.chip-btn:hover {
		background: #e2e8f0;
		border-color: #cbd5e1;
	}
	.chip-btn:active {
		transform: scale(0.96);
	}
	:global([data-theme='dark']) .chip-btn {
		background: #0f172a;
		border-color: #334155;
		color: #cbd5e1;
	}
	:global([data-theme='dark']) .chip-btn:hover {
		background: #334155;
	}
	.chip-btn.chip-active {
		background: #fee2e2;
		border-color: #fca5a5;
		color: #dc2626;
	}
	:global([data-theme='dark']) .chip-btn.chip-active {
		background: rgba(220, 38, 38, 0.2);
		border-color: rgba(220, 38, 38, 0.4);
		color: #fca5a5;
	}

	/* Submit Action Button */
	.submit-action-btn {
		min-height: 64px;
		background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
		color: white;
		font-weight: 800;
		font-size: 1.15rem;
		letter-spacing: 0.02em;
		border: none;
		border-radius: 0.85rem;
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.75rem;
		box-shadow: 0 4px 16px rgba(220, 38, 38, 0.35);
		transition: all 0.15s ease;
		margin-top: 0.5rem;
	}
	.submit-action-btn:hover:not(:disabled) {
		background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
		box-shadow: 0 6px 20px rgba(220, 38, 38, 0.45);
		transform: translateY(-1px);
	}
	.submit-action-btn:active:not(:disabled) {
		transform: scale(0.98);
	}
	.submit-action-btn:disabled {
		opacity: 0.6;
		cursor: not-allowed;
	}

	/* Success Overlay */
	.success-overlay {
		position: fixed;
		inset: 0;
		background: rgba(15, 23, 42, 0.8);
		backdrop-filter: blur(4px);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 999;
		padding: 1.5rem;
	}

	.success-modal {
		background: #ffffff;
		width: 100%;
		max-width: 480px;
		border-radius: 1.25rem;
		padding: 2.25rem 2rem;
		text-align: center;
		box-shadow: 0 20px 40px rgba(0, 0, 0, 0.25);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1rem;
	}
	:global([data-theme='dark']) .success-modal {
		background: #1e293b;
		color: #f8fafc;
	}

	.success-icon-wrap {
		animation: popIn 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
	}
	@keyframes popIn {
		0% {
			transform: scale(0.5);
			opacity: 0;
		}
		100% {
			transform: scale(1);
			opacity: 1;
		}
	}

	.success-title {
		font-size: 1.5rem;
		font-weight: 800;
		margin: 0;
		color: #0f172a;
	}
	:global([data-theme='dark']) .success-title {
		color: #f8fafc;
	}

	.success-sub {
		font-size: 0.925rem;
		color: #64748b;
		margin: 0;
		line-height: 1.45;
	}
	:global([data-theme='dark']) .success-sub {
		color: #94a3b8;
	}

	.ticket-summary {
		width: 100%;
		background: #f8fafc;
		border: 1px solid #e2e8f0;
		border-radius: 0.75rem;
		padding: 0.85rem 1rem;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		font-size: 0.875rem;
		text-align: left;
	}
	:global([data-theme='dark']) .ticket-summary {
		background: #0f172a;
		border-color: #334155;
	}

	.summary-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 0.5rem;
	}

	.summary-label {
		color: #64748b;
	}
	:global([data-theme='dark']) .summary-label {
		color: #94a3b8;
	}

	.summary-val {
		font-weight: 700;
		color: #0f172a;
	}
	:global([data-theme='dark']) .summary-val {
		color: #f8fafc;
	}

	.summary-val.mono {
		font-family: monospace;
		background: #e2e8f0;
		padding: 0.1rem 0.4rem;
		border-radius: 0.3rem;
	}
	:global([data-theme='dark']) .summary-val.mono {
		background: #334155;
	}

	.summary-badge {
		padding: 0.2rem 0.5rem;
		border-radius: 0.35rem;
		font-size: 0.75rem;
		font-weight: 800;
	}
	.prio-low {
		background: #e0f2fe;
		color: #0369a1;
	}
	.prio-medium {
		background: #fef3c7;
		color: #b45309;
	}
	.prio-high {
		background: #ffedd5;
		color: #c2410c;
	}
	.prio-critical {
		background: #fee2e2;
		color: #b91c1c;
	}

	.countdown-bar {
		font-size: 0.85rem;
		color: #64748b;
	}
	:global([data-theme='dark']) .countdown-bar {
		color: #94a3b8;
	}

	.success-btn {
		width: 100%;
		padding: 0.85rem;
		background: #1e293b;
		color: white;
		border: none;
		border-radius: 0.75rem;
		font-weight: 700;
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.15s ease;
	}
	.success-btn:hover {
		background: #334155;
	}
	:global([data-theme='dark']) .success-btn {
		background: #0284c7;
	}
	:global([data-theme='dark']) .success-btn:hover {
		background: #0369a1;
	}
</style>

