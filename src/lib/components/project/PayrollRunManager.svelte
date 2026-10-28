<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { IconLoader2, IconCheck, IconX, IconLock, IconCash, IconClockDollar } from '@tabler/icons-svelte';
	import {
		getPayrollRuns,
		createPayrollDraftBatch,
		approvePayrollRun,
		signPayrollRun,
		cancelPayrollDraft,
		postPayrollPayment
	} from '$lib/services/manpowerPayroll';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import { get } from 'svelte/store';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';

	let {
		projectId,
		periodeMulai,
		periodeSelesai,
		workers,
		workerTotals,
		onProcessed
	} = $props<{
		projectId: string | number;
		periodeMulai: string;
		periodeSelesai: string;
		workers: any[];
		workerTotals: { tIn: number; tOt: number; tSb: number; tUm: number; subtotal: number; kasbon: number; final: number }[];
		onProcessed?: () => void;
	}>();

	const formatRp = (val: number) => {
		if (!val) return '0';
		return new Intl.NumberFormat('id-ID').format(val);
	};

	let runs = $state<any[]>([]);
	let loadingRuns = $state(false);
	let showCreateModal = $state(false);
	let creating = $state(false);
	let actionLoading = $state<Set<number>>(new Set());
	let payingRun = $state<any>(null);
	let payForm = $state({ metode_bayar: 'cash', dibayar_oleh: '' });
	let submittingPay = $state(false);

	// TTD rekap upah — gerbang wajib sebelum "Setujui" (Akuntabilitas Pembayaran Manpower v3, F0.2)
	let signTarget = $state<any>(null);
	let signNama = $state('');
	let signPad: any;
	let signing = $state(false);

	// Baris yang punya minimal satu bentuk kehadiran (IN/OT/SB) dan SPK aktif — layak diproses.
	let eligibleRows = $derived.by(() => {
		return workers
			.map((w: any, i: number) => ({ worker: w, totals: workerTotals[i] }))
			.filter((r: any) => r.worker.assignmentId && r.totals && (r.totals.tIn > 0 || r.totals.tOt > 0 || r.totals.tSb > 0 || r.totals.tUm > 0));
	});

	async function loadRuns() {
		loadingRuns = true;
		try {
			const res = await getPayrollRuns(Number(projectId));
			runs = res.success ? res.data : [];
		} finally {
			loadingRuns = false;
		}
	}

	$effect(() => {
		if (projectId) loadRuns();
	});

	function withLoading<T>(id: number, fn: () => Promise<T>): Promise<T> {
		actionLoading = new Set(actionLoading).add(id);
		return fn().finally(() => {
			const next = new Set(actionLoading);
			next.delete(id);
			actionLoading = next;
		});
	}

	async function submitCreate() {
		if (creating || eligibleRows.length === 0) return;
		creating = true;
		try {
			const rows = eligibleRows.map((r: any) => {
				const w = r.worker;
				const t = r.totals;
				return {
					assignmentId: w.assignmentId,
					manpowerId: w.id,
					rateHarian: w.rate_upah,
					jumlahHariHadir: t.tIn,
					totalJam: t.tIn * 8,
					upahPokok: t.tIn * w.rate_upah + t.tSb * w.rate_sb, // termasuk standby
					lembur: t.tOt * w.rate_lembur,
					bonus: t.tUm * w.rate_um, // uang makan, dicatat di kolom bonus (manpower_payroll belum punya kolom UM sendiri)
					kasbonPotongan: t.kasbon,
					potonganLain: 0,
					totalDibayar: t.final
				};
			});

			const res = await createPayrollDraftBatch(Number(projectId), periodeMulai, periodeSelesai, rows);
			if (res.success) {
				const conflictNote =
					res.conflicts.length > 0
						? `\n${res.conflicts.length} pekerja dilewati:\n` +
						  res.conflicts.map((c: any) => `- ${workers.find((w: any) => w.id === c.manpowerId)?.nama || c.manpowerId}: ${c.reason}`).join('\n')
						: '';
				alert(`${res.created.length} draft payroll dibuat, absensi periode ini terkunci.${conflictNote}`);
				showCreateModal = false;
				await loadRuns();
				onProcessed?.();
			} else {
				alert(res.error || 'Gagal membuat draft payroll.');
			}
		} finally {
			creating = false;
		}
	}

	async function handleApprove(run: any) {
		await withLoading(run.id, async () => {
			const res = await approvePayrollRun(run.id);
			if (!res.success) alert(res.error || 'Gagal menyetujui payroll.');
			else if (res.message) alert(res.message);
			await loadRuns();
		});
	}

	function openSign(run: any) {
		signTarget = run;
		signNama = run.manpower_id?.nama || '';
	}

	async function handleSign() {
		if (!signPad || signPad.isEmpty()) {
			alert('Tanda tangan belum diisi');
			return;
		}
		signing = true;
		try {
			const dataUrl = signPad.toDataURL();
			const res = await signPayrollRun(signTarget.id, dataUrl, signNama);
			if (res.success) {
				signTarget = null;
				await loadRuns();
			} else {
				alert(res.error || 'Gagal menyimpan tanda tangan');
			}
		} finally {
			signing = false;
		}
	}

	async function handleCancel(run: any) {
		if (!confirm(`Batalkan draft payroll untuk ${run.manpower_id?.nama || '#' + run.manpower_id}? Absensi periode ini akan dibuka kuncinya lagi.`)) return;
		await withLoading(run.id, async () => {
			const res = await cancelPayrollDraft(run.id);
			if (!res.success) alert(res.error || 'Gagal membatalkan draft payroll.');
			await loadRuns();
			onProcessed?.();
		});
	}

	function openPayModal(run: any) {
		payingRun = run;
		payForm = { metode_bayar: 'cash', dibayar_oleh: getUserDisplay(get(authStore).user) };
	}

	async function submitPay() {
		if (submittingPay || !payingRun) return;
		if (!payForm.dibayar_oleh.trim()) {
			alert('Nama yang membayarkan wajib diisi.');
			return;
		}
		submittingPay = true;
		try {
			const res = await postPayrollPayment(payingRun.id, {
				metodeBayar: payForm.metode_bayar,
				dibayarOleh: payForm.dibayar_oleh.trim()
			});
			if (res.success) {
				alert('Payroll ditandai dibayar. Biaya final sudah diposting ke project_expenses, akrual harian lama sudah dikonsolidasi.');
				payingRun = null;
				await loadRuns();
				onProcessed?.();
			} else {
				alert(res.error || 'Gagal memposting pembayaran payroll.');
			}
		} finally {
			submittingPay = false;
		}
	}

	function statusBadge(status: string) {
		if (status === 'dibayar') return 'bg-green-100 text-green-700';
		if (status === 'disetujui') return 'bg-blue-100 text-blue-700';
		return 'bg-gray-100 text-gray-600';
	}
</script>

<div class="bg-white rounded-2xl border border-gray-100 shadow-sm">
	<div class="flex items-center justify-between p-4 border-b border-gray-100">
		<div>
			<h3 class="font-bold text-gray-800 text-[14px] flex items-center gap-2">
				<IconClockDollar size={18} class="text-[var(--gd)]" /> Proses Gajian
			</h3>
			<p class="text-[11px] text-gray-400 mt-0.5">
				Konsolidasi akrual harian jadi satu biaya final per pekerja, dan mengunci absensi periode ini supaya tidak dobel hitung.
			</p>
		</div>
		<button
			class="h-[36px] px-4 rounded-xl bg-[var(--g)] text-white font-semibold text-[13px] hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50"
			onclick={() => (showCreateModal = true)}
			disabled={eligibleRows.length === 0}
			title="Buat draft payroll dari rekap absensi periode yang sedang ditampilkan"
		>
			<IconLock size={16} /> Proses Gajian ({eligibleRows.length} pekerja)
		</button>
	</div>

	<div class="p-4">
		{#if loadingRuns}
			<CircularProgressGauge size={48} strokeWidth={4} label="Memuat daftar payroll..." />
		{:else if runs.length === 0}
			<p class="text-[13px] text-gray-400 text-center py-6">Belum ada proses gajian untuk proyek ini.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="w-full text-[12px] border-collapse">
					<thead>
						<tr class="text-left text-gray-500 uppercase text-[10px] tracking-wider">
							<th class="p-2 border-b border-gray-100">Pekerja</th>
							<th class="p-2 border-b border-gray-100">Periode</th>
							<th class="p-2 border-b border-gray-100 text-right">Total Dibayar</th>
							<th class="p-2 border-b border-gray-100 text-center">Status</th>
							<th class="p-2 border-b border-gray-100 text-right">Aksi</th>
						</tr>
					</thead>
					<tbody>
						{#each runs as run}
							<tr class="hover:bg-gray-50">
								<td class="p-2 border-b border-gray-50 font-medium text-gray-800">{run.manpower_id?.nama || `#${run.manpower_id}`}</td>
								<td class="p-2 border-b border-gray-50 text-gray-500">{run.periode_mulai} s/d {run.periode_selesai}</td>
								<td class="p-2 border-b border-gray-50 text-right font-semibold text-gray-800">Rp {formatRp(run.total_dibayar)}</td>
								<td class="p-2 border-b border-gray-50 text-center">
									<span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase {statusBadge(run.status)}">{run.status}</span>
								</td>
								<td class="p-2 border-b border-gray-50 text-right">
									{#if actionLoading.has(run.id)}
										<IconLoader2 size={16} class="animate-spin inline-block text-gray-400" />
									{:else if run.status === 'draft'}
										<div class="flex justify-end gap-1.5">
											{#if !run.ttd_manpower}
												<button class="px-2.5 py-1 rounded-lg bg-amber-50 text-amber-700 text-[11px] font-semibold hover:bg-amber-600 hover:text-white transition-colors" onclick={() => openSign(run)}>✍️ TTD</button>
											{:else}
												<button class="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-[11px] font-semibold hover:bg-blue-600 hover:text-white transition-colors" onclick={() => handleApprove(run)}>Setujui</button>
											{/if}
											<button class="px-2.5 py-1 rounded-lg bg-red-50 text-red-600 text-[11px] font-semibold hover:bg-red-600 hover:text-white transition-colors" onclick={() => handleCancel(run)}>Batalkan</button>
										</div>
									{:else if run.status === 'disetujui'}
										<button class="px-2.5 py-1 rounded-lg bg-green-600 text-white text-[11px] font-semibold hover:bg-green-700 transition-colors flex items-center gap-1 ml-auto" onclick={() => openPayModal(run)}>
											<IconCash size={13} /> Tandai Dibayar
										</button>
									{:else}
										<span class="text-gray-400 text-[11px]">{run.expense_posted ? 'Biaya terposting' : '-'}</span>
									{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</div>
</div>

{#if showCreateModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-white rounded-2xl w-full max-w-lg shadow-xl overflow-hidden flex flex-col max-h-full">
			<div class="flex items-center justify-between p-4 border-b border-gray-100">
				<h3 class="font-bold text-gray-800 text-[15px]">Buat Draft Proses Gajian</h3>
				<button class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors" onclick={() => (showCreateModal = false)}>
					<IconX size={18} />
				</button>
			</div>
			<div class="p-5 overflow-y-auto space-y-3">
				<p class="text-[12px] text-gray-500">
					Periode <strong>{periodeMulai}</strong> s/d <strong>{periodeSelesai}</strong>. Absensi periode ini akan <strong>dikunci</strong>
					(tidak bisa diedit lagi lewat grid) begitu draft dibuat.
				</p>
				<div class="border border-gray-100 rounded-xl divide-y divide-gray-50 max-h-64 overflow-y-auto">
					{#each eligibleRows as r}
						<div class="flex items-center justify-between px-3 py-2 text-[12px]">
							<span class="text-gray-700 font-medium">{r.worker.nama}</span>
							<span class="text-gray-800 font-semibold">Rp {formatRp(r.totals.final)}</span>
						</div>
					{/each}
				</div>
				<div class="flex items-center justify-between px-1 pt-1 text-[13px] font-bold text-gray-900">
					<span>Total</span>
					<span>Rp {formatRp(eligibleRows.reduce((s: number, r: any) => s + r.totals.final, 0))}</span>
				</div>
			</div>
			<div class="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
				<button class="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors" onclick={() => (showCreateModal = false)}>Batal</button>
				<button class="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-[var(--g)] hover:opacity-90 transition-opacity flex items-center gap-2 disabled:opacity-50" onclick={submitCreate} disabled={creating}>
					{#if creating}
						<IconLoader2 size={16} class="animate-spin" /> Memproses...
					{:else}
						<IconLock size={16} /> Buat Draft & Kunci Absensi
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if signTarget}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden flex flex-col">
			<div class="flex items-center justify-between p-4 border-b border-gray-100 bg-amber-50">
				<h3 class="font-bold text-gray-800 text-[15px]">Tanda Tangan Rekap Upah</h3>
				<button class="w-8 h-8 flex items-center justify-center rounded-full bg-white text-gray-500 hover:bg-gray-100 transition-colors" onclick={() => (signTarget = null)}>
					<IconX size={18} />
				</button>
			</div>
			<div class="p-5 space-y-3">
				<p class="text-[12px] text-gray-500">
					{signTarget.manpower_id?.nama} — Rp {formatRp(signTarget.total_dibayar)} ({signTarget.periode_mulai} s/d {signTarget.periode_selesai})
				</p>
				<div>
					<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Nama Penanda Tangan</label>
					<input type="text" bind:value={signNama} class="f-input w-full bg-gray-50 border-gray-200" />
				</div>
				<div>
					<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Tanda Tangan Pekerja *</label>
					<SignaturePad bind:this={signPad} />
				</div>
				<p class="text-[11px] text-gray-400">Rekap tidak bisa disetujui sampai pekerja menandatangani (mencegah upah dibayar tanpa konfirmasi pekerja).</p>
			</div>
			<div class="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
				<button class="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors" onclick={() => (signTarget = null)}>Batal</button>
				<button class="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-amber-600 hover:bg-amber-700 transition-colors flex items-center gap-2 disabled:opacity-50" onclick={handleSign} disabled={signing}>
					{#if signing}
						<IconLoader2 size={16} class="animate-spin" /> Menyimpan...
					{:else}
						<IconCheck size={16} /> Simpan TTD
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}

{#if payingRun}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
		<div class="bg-white rounded-2xl w-full max-w-sm shadow-xl overflow-hidden flex flex-col">
			<div class="flex items-center justify-between p-4 border-b border-gray-100">
				<h3 class="font-bold text-gray-800 text-[15px]">Tandai Dibayar</h3>
				<button class="w-8 h-8 flex items-center justify-center rounded-full bg-gray-50 text-gray-500 hover:bg-gray-100 transition-colors" onclick={() => (payingRun = null)}>
					<IconX size={18} />
				</button>
			</div>
			<div class="p-5 space-y-3">
				<p class="text-[12px] text-gray-500">
					{payingRun.manpower_id?.nama} — Rp {formatRp(payingRun.total_dibayar)}
				</p>
				<div>
					<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Metode Pembayaran</label>
					<select bind:value={payForm.metode_bayar} class="f-select w-full bg-gray-50 border-gray-200">
						<option value="cash">Cash</option>
						<option value="transfer">Transfer</option>
					</select>
				</div>
				<div>
					<label class="block text-[11px] font-semibold text-gray-500 uppercase tracking-wider mb-1.5">Dibayar Oleh</label>
					<input type="text" bind:value={payForm.dibayar_oleh} class="f-input w-full bg-gray-50 border-gray-200" />
				</div>
			</div>
			<div class="p-4 border-t border-gray-100 flex justify-end gap-2 bg-gray-50/50">
				<button class="px-4 py-2 rounded-xl text-[13px] font-semibold text-gray-500 bg-white border border-gray-200 hover:bg-gray-50 transition-colors" onclick={() => (payingRun = null)}>Batal</button>
				<button class="px-5 py-2 rounded-xl text-[13px] font-semibold text-white bg-green-600 hover:bg-green-700 transition-colors flex items-center gap-2 disabled:opacity-50" onclick={submitPay} disabled={submittingPay}>
					{#if submittingPay}
						<IconLoader2 size={16} class="animate-spin" /> Menyimpan...
					{:else}
						<IconCheck size={16} /> Posting Biaya & Selesai
					{/if}
				</button>
			</div>
		</div>
	</div>
{/if}
