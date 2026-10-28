<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { getMyDocRequests, submitDocRequest, type DocRequest } from '$lib/services/ess/docRequest';
	import { IconLoader2, IconAlertTriangle, IconSend, IconClockHour4, IconCircleCheck, IconCircleX, IconRefresh } from '@tabler/icons-svelte';

	const JENIS_OPTIONS = [
		{ value: 'sk', label: 'SK Kerja (mis. untuk KPR)' },
		{ value: 'sertifikat', label: 'Sertifikat / Surat Referensi Kerja' },
		{ value: 'offering', label: 'Salinan Offering Letter' },
		{ value: 'pkwt', label: 'Salinan Kontrak Kerja (PKWT)' },
		{ value: 'tambah_bpjs', label: 'Pendaftaran BPJS (Kesehatan / Ketenagakerjaan)' },
		{ value: 'nonaktif_bpjs', label: 'Penonaktifan BPJS (Kesehatan / Ketenagakerjaan)' }
	];

	const STATUS_META: Record<string, { label: string; classes: string; icon: any }> = {
		menunggu: { label: 'Menunggu', classes: 'bg-amber-50 text-amber-700 border-amber-200', icon: IconClockHour4 },
		diproses: { label: 'Diproses', classes: 'bg-blue-50 text-blue-700 border-blue-200', icon: IconRefresh },
		selesai: { label: 'Selesai', classes: 'bg-green-50 text-green-700 border-green-200', icon: IconCircleCheck },
		ditolak: { label: 'Ditolak', classes: 'bg-red-50 text-red-700 border-red-200', icon: IconCircleX }
	};

	let loading = $state(true);
	let errorMsg = $state('');
	let requests = $state<DocRequest[]>([]);

	let jenisDokumen = $state(JENIS_OPTIONS[0].value);
	let keperluan = $state('');
	let prioritas = $state<'biasa' | 'mendesak'>('biasa');
	let submitting = $state(false);
	let submitMsg = $state('');

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			const res = await getMyDocRequests();
			requests = res.requests;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat riwayat permintaan.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	async function handleSubmit() {
		if (!keperluan.trim()) {
			errorMsg = 'Keperluan wajib diisi.';
			return;
		}
		errorMsg = '';
		submitMsg = '';
		submitting = true;
		try {
			await submitDocRequest({ jenis_dokumen: jenisDokumen, keperluan, prioritas });
			submitMsg = 'Permintaan terkirim. HRD akan memprosesnya segera.';
			keperluan = '';
			prioritas = 'biasa';
			await load();
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal mengirim permintaan.';
		} finally {
			submitting = false;
		}
	}

	function formatTanggal(iso: string) {
		return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
	}

	function jenisLabel(v: string) {
		return JENIS_OPTIONS.find((o) => o.value === v)?.label || v;
	}
</script>

<div class="w-full p-4 md:p-6 pb-24 max-w-2xl mx-auto">
	<div class="mb-6">
		<h1 class="text-2xl font-extrabold tracking-tight gradient-text">Permintaan Dokumen</h1>
		<p class="text-sm mt-1 font-medium" style="color: var(--sys-label3)">Ajukan permintaan dokumen HR ke HRD</p>
	</div>

	{#if errorMsg}
		<div class="flex items-center gap-2 p-3 rounded-xl bg-red-50 text-red-600 text-sm font-medium mb-4">
			<IconAlertTriangle size={18} class="shrink-0" />
			{errorMsg}
		</div>
	{/if}
	{#if submitMsg}
		<div class="flex items-center gap-2 p-3 rounded-xl bg-green-50 text-green-700 text-sm font-medium mb-4">
			<IconCircleCheck size={18} class="shrink-0" />
			{submitMsg}
		</div>
	{/if}

	<div class="glass-panel rounded-2xl p-5 mb-6">
		<p class="text-sm font-bold mb-3" style="color: var(--sys-label)">Ajukan Permintaan Baru</p>
		<div class="flex flex-col gap-3">
			<label class="flex flex-col gap-1">
				<span class="text-xs font-semibold" style="color: var(--sys-label3)">Jenis Dokumen</span>
				<select bind:value={jenisDokumen} class="h-11 rounded-xl px-3 border" style="border-color: var(--sys-separator)">
					{#each JENIS_OPTIONS as opt}
						<option value={opt.value}>{opt.label}</option>
					{/each}
				</select>
			</label>
			<label class="flex flex-col gap-1">
				<span class="text-xs font-semibold" style="color: var(--sys-label3)">Keperluan</span>
				<textarea bind:value={keperluan} rows="3" placeholder="mis. SK Kerja untuk pengajuan KPR" class="rounded-xl px-3 py-2 border" style="border-color: var(--sys-separator)"></textarea>
			</label>
			<label class="flex items-center gap-2">
				<input type="checkbox" checked={prioritas === 'mendesak'} onchange={(e) => (prioritas = (e.target as HTMLInputElement).checked ? 'mendesak' : 'biasa')} />
				<span class="text-sm font-medium" style="color: var(--sys-label)">Mendesak</span>
			</label>
			<button
				class="h-12 rounded-xl text-sm font-bold text-white flex items-center justify-center gap-2 gradient-bg shadow-md disabled:opacity-40"
				disabled={submitting}
				onclick={handleSubmit}
			>
				{#if submitting}<IconLoader2 size={18} class="animate-spin" />{:else}<IconSend size={18} />{/if}
				Kirim Permintaan
			</button>
		</div>
	</div>

	<p class="text-sm font-bold mb-3" style="color: var(--sys-label)">Riwayat Permintaan</p>
	{#if loading}
		<CircularProgressGauge size={50} strokeWidth={4} label="Memuat riwayat permintaan dokumen..." />
	{:else if requests.length === 0}
		<div class="glass-panel rounded-2xl p-8 text-center">
			<p class="text-sm font-medium" style="color: var(--sys-label3)">Belum ada permintaan.</p>
		</div>
	{:else}
		<div class="flex flex-col gap-3">
			{#each requests as r (r.id)}
				{@const meta = STATUS_META[r.status] || STATUS_META.menunggu}
				<div class="glass-panel rounded-2xl p-4">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="text-sm font-bold" style="color: var(--sys-label)">{jenisLabel(r.jenis_dokumen)}</p>
							<p class="text-xs mt-1" style="color: var(--sys-label4)">{r.keperluan}</p>
							<p class="text-xs mt-1" style="color: var(--sys-label4)">{formatTanggal(r.date_created)}</p>
						</div>
						<span class="shrink-0 flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-full border {meta.classes}">
							<meta.icon size={12} />
							{meta.label}
						</span>
					</div>
					{#if r.status === 'ditolak' && r.rejection_reason}
						<p class="text-xs mt-2 text-red-600">Alasan: {r.rejection_reason}</p>
					{/if}
				</div>
			{/each}
		</div>
	{/if}
</div>
