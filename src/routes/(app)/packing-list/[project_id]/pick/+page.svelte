<!-- src/routes/(app)/packing-list/[project_id]/pick/+page.svelte -->
<!-- Fase 3 — Mobile Picking (Lapangan). Scan batch (kamera tak berhenti), input manual
     sebagai jalan keluar wajib, kunci per baris + reservasi (server), verifikasi orang
     kedua wajib, foto bukti 1x per sesi. Tidak ada antrean offline. -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import directus from '$lib/services/directus';
	import { readItems, readItem } from '@directus/sdk';
	import QrScannerModal from '$lib/components/scanner/QrScannerModal.svelte';
	import CameraCaptureModal from '$lib/components/scanner/CameraCaptureModal.svelte';
	import { uploadEvidencePhoto } from '$lib/services/stockLapangan';
	import { scanPickItem, confirmPickQty, verifyPick, completePickSession, type ScanResult } from '$lib/services/pickingApi';
	import {
		IconArrowLeft, IconLoader2, IconAlertTriangle, IconQrcode,
		IconCheck, IconBox, IconTruck, IconCircleCheck, IconCamera,
		IconScan, IconUserCheck, IconAlertCircle
	} from '@tabler/icons-svelte';

	let projectId = $derived(Number($page.params.project_id));

	let project = $state<any>(null);
	let rows = $state<any[]>([]);
	let loading = $state(true);

	let showScanner = $state(false);
	let manualCode = $state('');
	let scanBusy = $state(false);
	let activeScan = $state<ScanResult | null>(null);
	let qtyInput = $state('');
	let confirming = $state(false);
	let flashMsg = $state('');
	let flashKind: 'ok' | 'error' | '' = $state('');

	let showCameraCapture = $state(false);
	let completingSession = $state(false);

	let myEmail = $derived(get(authStore).user?.email || '');

	async function loadData() {
		loading = true;
		try {
			const [projRes, rowsRes] = await Promise.all([
				directus.request(readItem('projects', projectId, { fields: ['id', 'name', 'gudang_id', 'last_pick_completed_at', 'last_pick_completed_by'] } as any)),
				directus.request(
					readItems('project_budgets', {
						filter: { project_id: { _eq: projectId }, packing_status: { _nnull: true } } as any,
						fields: ['id', 'material_name', 'description', 'identitas_barang_id', 'qty', 'unit', 'qty_picked', 'pick_status', 'picked_by', 'verified_by'],
						sort: ['material_name'],
						limit: -1
					} as any)
				)
			]);
			project = projRes;
			rows = (rowsRes as any[]) || [];
		} catch (e) {
			console.error('Gagal memuat data picking:', e);
		} finally {
			loading = false;
		}
	}

	onMount(loadData);

	function flash(kind: 'ok' | 'error', msg: string) {
		flashKind = kind;
		flashMsg = msg;
		setTimeout(() => {
			if (flashMsg === msg) {
				flashMsg = '';
				flashKind = '';
			}
		}, 3000);
	}

	async function handleScanCode(code: string) {
		if (scanBusy || activeScan) return; // satu per satu — jangan tumpang tindih
		if (!project?.gudang_id) {
			flash('error', 'Gudang sumber belum diset untuk project ini — hubungi admin sebelum picking.');
			return;
		}
		scanBusy = true;
		try {
			const result = await scanPickItem(code, projectId);
			activeScan = result;
			qtyInput = String(result.qtyRemaining || '');
			flash('ok', `${result.namaBarang} ditemukan`);
		} catch (e: any) {
			flash('error', e.message || 'Kode tidak dikenali');
		} finally {
			scanBusy = false;
		}
	}

	async function handleManualSubmit() {
		const code = manualCode.trim();
		if (!code) return;
		manualCode = '';
		await handleScanCode(code);
	}

	async function submitQty() {
		if (!activeScan) return;
		const qty = parseFloat(qtyInput);
		if (!qty || qty <= 0) {
			flash('error', 'Isi qty dulu (harus lebih dari 0)');
			return;
		}
		confirming = true;
		try {
			await confirmPickQty(activeScan.projectBudgetId, qty, activeScan.reservationId);
			flash('ok', `Tersimpan: ${qty} ${activeScan.unit || ''} ${activeScan.namaBarang}`);
			activeScan = null;
			qtyInput = '';
			await loadData();
		} catch (e: any) {
			flash('error', e.message || 'Gagal menyimpan');
		} finally {
			confirming = false;
		}
	}

	function cancelScan() {
		activeScan = null;
		qtyInput = '';
	}

	async function handleVerify(row: any) {
		try {
			await verifyPick(row.id);
			flash('ok', `Terverifikasi: ${row.material_name || row.description || 'item'}`);
			await loadData();
		} catch (e: any) {
			flash('error', e.message || 'Gagal verifikasi');
		}
	}

	async function handlePhotoCapture(file: File) {
		showCameraCapture = false;
		completingSession = true;
		try {
			const fileId = await uploadEvidencePhoto(file, 'picking:session');
			await completePickSession(projectId, fileId);
			flash('ok', 'Sesi picking ditandai selesai.');
			await loadData();
		} catch (e: any) {
			flash('error', e.message || 'Gagal menyimpan foto bukti');
		} finally {
			completingSession = false;
		}
	}

	function statusBadge(status: string | null) {
		if (status === 'verified') return { text: 'Terverifikasi', cls: 'ok' };
		if (status === 'picked') return { text: 'Sudah di-scan', cls: 'warn' };
		return { text: 'Menunggu', cls: 'pend' };
	}

	let allVerified = $derived(rows.length > 0 && rows.every((r) => r.pick_status === 'verified'));
</script>

<div class="flex-1 flex flex-col h-full bg-slate-50">

	<!-- Flash Message Notification -->
	{#if flashMsg}
		<div class="px-4 py-2 text-xs font-semibold flex items-center gap-2 border-b transition-all duration-300
			{flashKind === 'ok' ? 'bg-emerald-50 text-emerald-700 border-emerald-100' : 'bg-red-50 text-red-700 border-red-100'}"
		>
			{#if flashKind === 'ok'}
				<IconCircleCheck size={14} class="text-emerald-600" />
			{:else}
				<IconAlertTriangle size={14} class="text-red-600" />
			{/if}
			{flashMsg}
		</div>
	{/if}

	<!-- Main content body with scroll -->
	<div class="flex-1 overflow-y-auto px-4 py-4 pb-24">
		<div class="max-w-md mx-auto w-full space-y-4">
			
			<!-- Warehouse config warning -->
			{#if project && !project.gudang_id}
				<div class="glass-panel border border-red-200 bg-red-50/50 rounded-2xl p-4 flex gap-3 text-red-800">
					<IconAlertCircle size={24} class="shrink-0 text-red-600" />
					<div class="text-xs space-y-1">
						<p class="font-bold">Gudang Sumber Belum Diset</p>
						<p style="color: var(--sys-label2)">Gudang sumber belum ditentukan untuk proyek ini. Silakan hubungi admin sebelum memulai picking.</p>
					</div>
				</div>
			{/if}

			<!-- Action Cards -->
			<div class="grid grid-cols-1 gap-3">
				<button
					onclick={() => (showScanner = true)}
					disabled={!project?.gudang_id}
					class="w-full glass-panel hover-lift rounded-2xl p-5 flex items-center gap-4 text-left border border-white/50 shadow-sm disabled:opacity-50 group focus:outline-none relative overflow-hidden"
				>
					<div class="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-2xl -mr-8 -mt-8"></div>
					<div class="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center shadow-sm text-emerald-600 group-hover:scale-110 transition-transform">
						<IconScan size={24} />
					</div>
					<div>
						<p class="text-base font-bold mb-1" style="color: var(--sys-label)">Mulai Scan Barcode</p>
						<p class="text-xs font-medium" style="color: var(--sys-label3)">Scan QR internal atau Barcode pabrikan</p>
					</div>
				</button>
			</div>

			<!-- Manual Search Form -->
			<div class="glass-panel border border-white/50 shadow-sm p-4 rounded-2xl">
				<p class="text-[10px] font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label3)">Pencarian Manual (Jalan Keluar Wajib)</p>
				<div class="flex gap-2">
					<input
						bind:value={manualCode}
						onkeydown={(e) => e.key === 'Enter' && handleManualSubmit()}
						type="text"
						placeholder="Ketik Kode Item / SKU + Enter"
						class="flex-1 f-input"
					/>
					<button onclick={handleManualSubmit} class="btn-primary shrink-0 px-5 py-2">
						Cari
					</button>
				</div>
			</div>

			<!-- Manual / Non-scanner Active Scan Confirmation Card -->
			{#if activeScan && !showScanner}
				<div class="glass-panel border border-blue-200 bg-blue-50/20 rounded-2xl p-5 shadow-sm space-y-4 animate-fade-in">
					<div class="flex items-start justify-between">
						<div class="min-w-0">
							<span class="text-[10px] font-black text-blue-600 uppercase tracking-widest block mb-0.5">Item Terpilih</span>
							<p class="text-base font-bold truncate" style="color: var(--sys-label)">{activeScan.namaBarang}</p>
							<p class="text-xs" style="color: var(--sys-label3)">
								Kebutuhan sisa: <strong class="text-slate-700">{activeScan.qtyRemaining} {activeScan.unit || ''}</strong> (dari {activeScan.qtyRequired})
							</p>
						</div>
						<button onclick={cancelScan} class="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center text-slate-500">
							✕
						</button>
					</div>
					
					<div class="flex gap-2 items-end">
						<div class="flex-1">
							<label class="text-[10px] font-bold text-slate-400 block mb-1 uppercase">Jumlah Pick</label>
							<input
								type="number"
								bind:value={qtyInput}
								min="0"
								step="any"
								placeholder="0"
								class="f-input"
							/>
						</div>
						<button onclick={submitQty} disabled={confirming} class="btn-primary px-6 py-2.5">
							{#if confirming}
								<IconLoader2 size={18} class="animate-spin" />
							{:else}
								Simpan
							{/if}
						</button>
					</div>
				</div>
			{/if}

			<!-- Item List -->
			<div class="space-y-3">
				<div class="flex items-center justify-between px-2">
					<p class="text-[11px] font-bold uppercase tracking-wider" style="color: var(--sys-label3)">Daftar Material Proyek ({rows.length})</p>
					{#if allVerified}
						<span class="badge ok text-[10px] flex items-center gap-1">
							<IconCircleCheck size={12} /> Siap Selesai
						</span>
					{/if}
				</div>

				{#if loading}
		<div class="flex-1 flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat item material..." />
		</div>
				{:else if rows.length === 0}
					<div class="glass-panel border border-dashed rounded-2xl p-8 text-center text-slate-400 text-xs">
						Tidak ada material dalam packing list project ini.
					</div>
				{:else}
					<div class="space-y-2">
						{#each rows as row (row.id)}
							{@const badge = statusBadge(row.pick_status)}
							<div class="glass-panel border border-white/50 shadow-sm p-4 rounded-2xl flex items-center justify-between gap-4 transition-all">
								<div class="min-w-0">
									<p class="text-sm font-bold truncate" style="color: var(--sys-label)">{row.material_name || row.description || '(Tanpa nama)'}</p>
									<div class="flex items-center gap-2 mt-1">
										<p class="text-xs font-semibold text-slate-500">{row.qty_picked || 0} / {row.qty} {row.unit || ''}</p>
										{#if row.picked_by}
											<span class="text-[10px] text-slate-400">· Picker: {row.picked_by.split('@')[0]}</span>
										{/if}
									</div>
								</div>

								<div class="flex items-center gap-2 shrink-0">
									<span class="badge {badge.cls}">{badge.text}</span>
									{#if row.pick_status === 'picked' && row.picked_by !== myEmail}
										<button
											onclick={() => handleVerify(row)}
											class="text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 px-3 py-1.5 rounded-xl border border-emerald-200/50 transition-all flex items-center gap-1 active:scale-95"
										>
											<IconUserCheck size={14} /> Verifikasi
										</button>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<!-- Complete Session Footer -->
			<div class="pt-6 border-t border-slate-200/80 space-y-4">
				{#if project?.last_pick_completed_at}
					<div class="text-center">
						<p class="text-[11px] text-slate-400">
							Sesi terakhir selesai: <strong class="text-slate-500">{new Date(project.last_pick_completed_at).toLocaleString('id-ID')}</strong> oleh <strong class="text-slate-500">{project.last_pick_completed_by}</strong>
						</p>
					</div>
				{/if}
				
				<button
					onclick={() => (showCameraCapture = true)}
					disabled={completingSession || !allVerified}
					class="btn-primary w-full py-4 text-sm font-bold shadow-md rounded-2xl flex items-center justify-center gap-2"
				>
					{#if completingSession}
						<IconLoader2 size={18} class="animate-spin" /> Menyelesaikan...
					{:else}
						<IconCamera size={18} /> {allVerified ? 'Ambil Foto & Selesaikan Sesi' : 'Selesaikan Semua Verifikasi Dulu'}
					{/if}
				</button>
			</div>
		</div>
	</div>
</div>

{#if showScanner}
	<QrScannerModal
		continuous={true}
		expectedPrefix={null}
		onDetect={handleScanCode}
		onClose={() => {
			showScanner = false;
			cancelScan();
		}}
	/>
	
	<!-- Floating Overlay Confirmation Card over Scanner -->
	{#if activeScan}
		<div class="fixed inset-x-4 top-24 z-[100] glass-panel border border-white/60 bg-white/95 dark:bg-slate-900/95 rounded-2xl p-5 shadow-2xl flex flex-col gap-3 animate-fade-in" style="backdrop-filter: blur(20px); -webkit-backdrop-filter: blur(20px);">
			<div class="flex items-start justify-between">
				<div class="min-w-0">
					<span class="text-[9px] font-black text-blue-500 uppercase tracking-widest block mb-0.5">Item Terdeteksi</span>
					<h3 class="text-sm font-bold text-slate-800 dark:text-slate-200 truncate">{activeScan.namaBarang}</h3>
					<p class="text-xs text-slate-400 mt-0.5">Kebutuhan sisa: <strong class="text-slate-700 dark:text-slate-300">{activeScan.qtyRemaining} {activeScan.unit || ''}</strong></p>
				</div>
				<button onclick={cancelScan} class="w-8 h-8 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-500 flex items-center justify-center">
					✕
				</button>
			</div>
			
			<div class="flex gap-2 items-end">
				<div class="flex-1">
					<input
						type="number"
						bind:value={qtyInput}
						min="0"
						step="any"
						placeholder="Masukkan qty..."
						class="w-full f-input"
						autofocus
					/>
				</div>
				<button onclick={submitQty} disabled={confirming} class="btn-primary shrink-0 px-6 py-2.5 rounded-xl font-bold text-xs">
					{#if confirming}
						<IconLoader2 size={16} class="animate-spin" />
					{:else}
						Simpan
					{/if}
				</button>
			</div>
		</div>
	{/if}
{/if}

{#if showCameraCapture}
	<CameraCaptureModal onCapture={handlePhotoCapture} onClose={() => (showCameraCapture = false)} />
{/if}
