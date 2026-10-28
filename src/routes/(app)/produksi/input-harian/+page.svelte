<!-- src/routes/(app)/produksi/input-harian/+page.svelte -->
<!-- Input Produksi Harian (Fase 7, Pertajam KPI Marketing & Manufaktur v2). -->
<!-- Offline-first: gagal kirim -> antrian IndexedDB, auto-kirim ulang saat online. -->
<!-- Menulis ke spk_daily_log (BUKAN spk.actual_quantity_produced — itu nilai final -->
<!-- sekali-isi dari alur QC/Finished Goods, tidak boleh ditimpa dari sini). -->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import {
		fetchActiveSpkList,
		createDailyLog,
		fetchRecentDailyLogs,
		type ActiveSpk
	} from '$lib/services/spkDailyLogApi';
	import {
		enqueueSpkDailyLog,
		flushSpkDailyQueue,
		registerSpkDailyAutoFlush,
		type QueuedSpkDailyLog
	} from '$lib/utils/offlineSpkDailyQueue';
	import {
		fetchActiveQcSpecs,
		submitQcInProcess,
		fetchQcResultsForSpk,
		type QcSpecRow,
		type ProductionStage
	} from '$lib/services/qcInProcessApi';
	import { IconLoader2, IconClipboardText, IconFlask2 } from '@tabler/icons-svelte';

	let loading = $state(true);
	let saving = $state(false);
	let spkList = $state<ActiveSpk[]>([]);
	let recentLogs = $state<any[]>([]);

	function todayIso() {
		return new Date().toISOString().slice(0, 10);
	}

	let form = $state({ spkId: '', tanggal: todayIso(), outputKg: '', rejectKg: '', wasteKg: '', catatan: '' });

	// Fase 3A (Penajaman Modul Produksi v2, 26 Agu 2026) — QC In-Process.
	// Satu halaman yang sama (bukan route baru), sesuai N4: satu kebiasaan, bukan enam.
	const STAGE_OPTIONS: { value: ProductionStage; label: string }[] = [
		{ value: 'premix', label: 'Premix' },
		{ value: 'grinding', label: 'Grinding' },
		{ value: 'letdown', label: 'Letdown' },
		{ value: 'tinting', label: 'Tinting' },
		{ value: 'final', label: 'Final' }
	];
	let qcStage = $state<ProductionStage>('final');
	let qcSpecs = $state<QcSpecRow[]>([]);
	let qcValues = $state<Record<number, string>>({});
	let qcRecent = $state<any[]>([]);
	let qcSaving = $state(false);
	let qcMessage = $state('');

	function qcVerdict(spec: QcSpecRow, rawValue: string): 'pass' | 'fail' | null {
		if (rawValue === '' || spec.min_value === null || spec.max_value === null) return null;
		const v = Number(rawValue);
		if (Number.isNaN(v)) return null;
		return v >= spec.min_value && v <= spec.max_value ? 'pass' : 'fail';
	}

	async function loadQcContext(spkId: number, productId: number | null) {
		[qcSpecs, qcRecent] = await Promise.all([fetchActiveQcSpecs(productId), fetchQcResultsForSpk(spkId)]);
		qcValues = {};
	}

	function productLabel(spk: ActiveSpk) {
		const p = spk.product_id;
		const name = typeof p === 'object' ? p?.nama_barang_lengkap : null;
		return `${spk.nomor}${spk.batch_no ? ' / ' + spk.batch_no : ''}${name ? ' — ' + name : ''}`;
	}

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && !hasPermission(roleId, 'input_produksi_harian', roles)) {
			goto('/');
		}
	});

	async function sendEntry(entry: QueuedSpkDailyLog) {
		await createDailyLog({
			clientTxnId: entry.client_txn_id,
			spkId: entry.spk_id,
			tanggal: entry.tanggal,
			outputKg: entry.output_kg,
			rejectKg: entry.reject_kg,
			wasteKg: entry.waste_kg,
			catatan: entry.catatan,
			inputBy: entry.input_by
		});
	}

	async function loadRecent(spkId: number) {
		recentLogs = await fetchRecentDailyLogs(spkId, 10);
	}

	function selectedSpkProductId(): number | null {
		const spk = spkList.find((s) => String(s.id) === form.spkId);
		const p = spk?.product_id;
		return typeof p === 'object' ? p?.id ?? null : (p as number | null) ?? null;
	}

	async function load() {
		loading = true;
		try {
			spkList = await fetchActiveSpkList();
			if (spkList.length > 0) {
				form.spkId = String(spkList[0].id);
				await loadRecent(spkList[0].id);
				await loadQcContext(spkList[0].id, selectedSpkProductId());
			}
		} finally {
			loading = false;
		}
	}

	onMount(() => {
		load();
		registerSpkDailyAutoFlush(sendEntry);
		flushSpkDailyQueue(sendEntry).then((r) => {
			if (r.sent > 0 && form.spkId) loadRecent(Number(form.spkId));
		});
	});

	async function handleSpkChange() {
		if (form.spkId) {
			await loadRecent(Number(form.spkId));
			await loadQcContext(Number(form.spkId), selectedSpkProductId());
		}
	}

	async function submitQc() {
		if (!form.spkId || qcSaving) return;
		const readings = qcSpecs
			.filter((s) => qcValues[s.id] !== undefined && qcValues[s.id] !== '')
			.map((s) => ({
				qcSpecId: s.id,
				parameter: s.parameter,
				satuan: s.satuan,
				minValue: s.min_value,
				maxValue: s.max_value,
				value: Number(qcValues[s.id])
			}));
		if (readings.length === 0) {
			qcMessage = 'Isi minimal satu parameter dulu.';
			setTimeout(() => (qcMessage = ''), 3000);
			return;
		}
		qcSaving = true;
		qcMessage = '';
		try {
			const spkId = Number(form.spkId);
			const result = await submitQcInProcess({
				spkId,
				productId: selectedSpkProductId(),
				stage: qcStage,
				readings,
				testedBy: $authStore.karyawanName || null
			});
			qcMessage =
				result.failed > 0
					? `${result.success} tersimpan, ${result.failed} gagal.`
					: `${result.success} parameter QC tersimpan.`;
			await loadQcContext(spkId, selectedSpkProductId());
		} finally {
			qcSaving = false;
			setTimeout(() => (qcMessage = ''), 4000);
		}
	}

	async function submitLog() {
		if (!form.spkId) return;
		saving = true;
		const clientTxnId = crypto.randomUUID();
		const spkId = Number(form.spkId);
		const payload: QueuedSpkDailyLog = {
			client_txn_id: clientTxnId,
			spk_id: spkId,
			tanggal: form.tanggal,
			output_kg: form.outputKg ? Number(form.outputKg) : null,
			reject_kg: form.rejectKg ? Number(form.rejectKg) : null,
			waste_kg: form.wasteKg ? Number(form.wasteKg) : null,
			catatan: form.catatan.trim() || null,
			input_by: $authStore.karyawanName || null,
			createdAt: new Date().toISOString()
		};
		try {
			try {
				await sendEntry(payload);
			} catch (err) {
				// Gagal kirim (kemungkinan sinyal) -- simpan ke antrian, jangan dianggap error ke user
				await enqueueSpkDailyLog(payload);
			}
			form = { spkId: form.spkId, tanggal: todayIso(), outputKg: '', rejectKg: '', wasteKg: '', catatan: '' };
			await loadRecent(spkId);
		} finally {
			saving = false;
		}
	}
</script>

<div class="mx-auto max-w-lg p-4 pb-24">
	<div class="mb-3 flex items-center gap-2">
		<IconClipboardText size={20} class="text-blue-600" />
		<h1 class="text-lg font-bold text-gray-900">Input Produksi Harian</h1>
	</div>
	<p class="mb-4 text-xs text-gray-500">
		Catat output/reject/waste hari ini per SPK. Ini adalah log harian terpisah — TIDAK
		mengubah status penyelesaian SPK (itu tetap lewat alur QC seperti biasa).
	</p>

	{#if loading}
		<div class="flex flex-col items-center justify-center py-12">
		<CircularProgressGauge size={52} strokeWidth={4} label="Memuat form laporan input harian..." />
	</div>
	{:else if spkList.length === 0}
		<p class="text-sm text-gray-400">Tidak ada SPK berstatus "in_progress" saat ini.</p>
	{:else}
		<div class="space-y-2 rounded-lg border border-gray-100 bg-gray-50 p-3">
			<select
				class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm"
				bind:value={form.spkId}
				onchange={handleSpkChange}
			>
				{#each spkList as spk (spk.id)}
					<option value={String(spk.id)}>{productLabel(spk)}</option>
				{/each}
			</select>
			<input type="date" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={form.tanggal} />
			<div class="grid grid-cols-3 gap-2">
				<div>
					<label for="output-kg" class="text-[10px] text-gray-400">Output (kg)</label>
					<input id="output-kg" type="number" step="0.01" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={form.outputKg} />
				</div>
				<div>
					<label for="reject-kg" class="text-[10px] text-gray-400">Reject (kg)</label>
					<input id="reject-kg" type="number" step="0.01" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={form.rejectKg} />
				</div>
				<div>
					<label for="waste-kg" class="text-[10px] text-gray-400">Waste (kg)</label>
					<input id="waste-kg" type="number" step="0.01" class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={form.wasteKg} />
				</div>
			</div>
			<textarea class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" rows="2" placeholder="Catatan (opsional)" bind:value={form.catatan}></textarea>
			<button
				class="w-full rounded-lg bg-blue-600 py-1.5 text-xs font-bold text-white disabled:opacity-60"
				disabled={saving}
				onclick={submitLog}
			>
				{saving ? '…' : 'Simpan Input Hari Ini'}
			</button>
			<p class="text-[10px] text-gray-400">Sinyal jelek? Input tetap tersimpan di perangkat dan otomatis terkirim saat online lagi.</p>
		</div>

		{#if recentLogs.length > 0}
			<div class="mt-4">
				<h2 class="mb-2 text-xs font-bold uppercase text-gray-500">Riwayat Input SPK Ini</h2>
				<div class="space-y-1.5">
					{#each recentLogs as log (log.id)}
						<div class="rounded-lg border border-gray-100 bg-white p-2 text-xs">
							<div class="flex justify-between text-gray-500">
								<span>{log.tanggal}</span>
								<span>{log.input_by || '-'}</span>
							</div>
							<div class="mt-1 flex gap-3 text-gray-700">
								<span>Output: {log.output_kg ?? '-'} kg</span>
								<span>Reject: {log.reject_kg ?? '-'} kg</span>
								<span>Waste: {log.waste_kg ?? '-'} kg</span>
							</div>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<!-- Fase 3A: QC In-Process — SPK sama dengan form di atas -->
		<div class="mt-5 space-y-2 rounded-lg border border-purple-100 bg-purple-50/40 p-3">
			<div class="flex items-center gap-1.5">
				<IconFlask2 size={16} class="text-purple-600" />
				<h2 class="text-xs font-bold uppercase text-purple-700">QC In-Process</h2>
			</div>
			<p class="text-[10px] text-gray-500">
				Pilih tahap produksi saat sampel diambil, isi parameter yang terukur. Hijau = lolos, merah = di luar rentang — dihitung otomatis dari standar QC.
			</p>

			<select class="w-full rounded-lg border border-gray-200 px-2 py-1.5 text-sm" bind:value={qcStage}>
				{#each STAGE_OPTIONS as opt}
					<option value={opt.value}>{opt.label}</option>
				{/each}
			</select>

			{#if qcSpecs.length === 0}
				<p class="py-2 text-center text-xs text-gray-400">Belum ada standar QC aktif untuk produk ini.</p>
			{:else}
				<div class="space-y-1.5">
					{#each qcSpecs as spec (spec.id)}
						{@const verdict = qcVerdict(spec, qcValues[spec.id] ?? '')}
						<div class="flex items-center gap-2">
							<label for={`qc-param-${spec.id}`} class="w-32 shrink-0 text-xs text-gray-600">
								{spec.parameter}
								{#if spec.min_value !== null && spec.max_value !== null}
									<span class="block text-[9px] text-gray-400">{spec.min_value}–{spec.max_value} {spec.satuan || ''}</span>
								{/if}
							</label>
							<input
								id={`qc-param-${spec.id}`}
								type="number"
								step="0.01"
								class="flex-1 rounded-lg border px-2 py-1.5 text-sm {verdict === 'pass' ? 'border-green-400 bg-green-50' : verdict === 'fail' ? 'border-red-400 bg-red-50' : 'border-gray-200'}"
								bind:value={qcValues[spec.id]}
							/>
							{#if verdict === 'pass'}
								<span class="text-xs font-bold text-green-600">✓</span>
							{:else if verdict === 'fail'}
								<span class="text-xs font-bold text-red-600">✗</span>
							{/if}
						</div>
					{/each}
				</div>
				<button
					class="w-full rounded-lg bg-purple-600 py-1.5 text-xs font-bold text-white disabled:opacity-60"
					disabled={qcSaving}
					onclick={submitQc}
				>
					{qcSaving ? '…' : 'Simpan Hasil QC'}
				</button>
				{#if qcMessage}
					<p class="text-center text-[11px] text-gray-600">{qcMessage}</p>
				{/if}
			{/if}

			{#if qcRecent.length > 0}
				<div class="mt-2 space-y-1">
					<h3 class="text-[10px] font-bold uppercase text-gray-400">Riwayat QC SPK Ini</h3>
					{#each qcRecent as r (r.id)}
						<div class="flex items-center justify-between rounded bg-white px-2 py-1 text-[11px]">
							<span>{r.parameter} ({r.stage || '-'})</span>
							<span class="flex items-center gap-1">
								{r.value}
								{#if r.passed === true}<span class="text-green-600">✓</span>{:else if r.passed === false}<span class="text-red-600">✗</span>{/if}
							</span>
						</div>
					{/each}
				</div>
			{/if}
		</div>
	{/if}
</div>
