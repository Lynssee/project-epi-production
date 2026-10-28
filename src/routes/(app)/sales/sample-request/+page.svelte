<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import SalesNavTabs from '$lib/components/sales/SalesNavTabs.svelte';
	import {
		listSampleRequests,
		patchSampleRequest,
		SAMPLE_STATUS_LABELS,
		FEEDBACK_HASIL_LABELS,
		sampleStatusStyle,
		kategoriSampleLabel,
		type SampleRequestRow,
		type SampleStatus
	} from '$lib/services/salesSampleRequest';
	import {
		IconArrowLeft,
		IconPlus,
		IconLoader2,
		IconFlask,
		IconSearch,
		IconX,
		IconRefresh,
		IconCheck,
		IconClock
	} from '@tabler/icons-svelte';

	let loading = $state(true);
	let rows = $state<SampleRequestRow[]>([]);
	let errorMsg = $state('');
	let busyId = $state<number | null>(null);

	let scope = $state<'mine' | 'all'>('mine');
	let filterStatus = $state<string>('all');
	let searchQuery = $state('');
	let fromDate = $state('');
	let toDate = $state('');

	// Approval note per row
	let noteById = $state<Record<number, string>>({});

	// Fase 6.3 (rencana lifecycle produksi v2, 15 Sep 2026): timeline status + form feedback
	// customer 1 layar. "QC Sample" pada dokumen rencana tergabung ke tahap "Diproses" --
	// sales_sample_request TIDAK punya status QC terpisah di skema, jadi timeline mengikuti
	// status nyata yang ada (bukan tahap yang tidak pernah dipakai kode).
	const TIMELINE_STEPS: { status: SampleStatus; label: string }[] = [
		{ status: 'disetujui', label: 'Disetujui' },
		{ status: 'dalam_proses', label: 'Diproses & QC' },
		{ status: 'terkirim', label: 'Terkirim' },
		{ status: 'selesai', label: 'Selesai' }
	];
	const TIMELINE_ORDER: SampleStatus[] = ['menunggu_approval', 'disetujui', 'dalam_proses', 'terkirim', 'selesai'];
	function timelineStepIndex(status: SampleStatus) {
		return TIMELINE_ORDER.indexOf(status);
	}

	let feedbackFormId = $state<number | null>(null);
	let feedbackHasil = $state<'diterima' | 'revisi' | 'ditolak'>('diterima');
	let feedbackCatatan = $state('');
	let feedbackBusy = $state(false);

	function openFeedbackForm(r: SampleRequestRow) {
		feedbackFormId = r.id;
		feedbackHasil = 'diterima';
		feedbackCatatan = '';
	}

	async function submitFeedback(r: SampleRequestRow) {
		feedbackBusy = true;
		errorMsg = '';
		try {
			const updated = await patchSampleRequest(r.id, 'feedback', {
				feedback_hasil: feedbackHasil,
				feedback_catatan: feedbackCatatan.trim() || undefined
			});
			rows = rows.map((x) => (x.id === r.id ? updated : x));
			feedbackFormId = null;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal menyimpan feedback.';
		} finally {
			feedbackBusy = false;
		}
	}

	let canApprove = $derived(
		hasPermission($authStore.roleId, 'approve_sample_request', $rolesStore, $authStore.roleIds)
	);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			rows = await listSampleRequests({
				status: filterStatus,
				mine: scope === 'mine',
				q: searchQuery.trim() || undefined,
				from: fromDate || undefined,
				to: toDate || undefined
			});
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data.';
		} finally {
			loading = false;
		}
	}

	onMount(load);

	let approvalCount = $derived(rows.filter((r) => r.status === 'menunggu_approval').length);

	function nameOf(v: SampleRequestRow['sales_id']): string {
		if (v && typeof v === 'object') return v.nama_karyawan || '-';
		return v ? `#${v}` : '-';
	}
	function custOf(r: SampleRequestRow): string {
		if (r.customer_id && typeof r.customer_id === 'object') return r.customer_id.nama_sj_fp;
		return r.customer_name || '-';
	}

	async function act(r: SampleRequestRow, action: any, extra: Record<string, any> = {}) {
		if (busyId) return;
		busyId = r.id;
		errorMsg = '';
		try {
			const updated = await patchSampleRequest(r.id, action, extra);
			rows = rows.map((x) => (x.id === r.id ? updated : x));
		} catch (err: any) {
			errorMsg = err?.message || 'Aksi gagal.';
		} finally {
			busyId = null;
		}
	}

	function fmtDate(s?: string | null) {
		if (!s) return '-';
		const d = new Date(s);
		return isNaN(d.getTime()) ? s : d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
	}

	const STATUS_FILTER_OPTS: { value: string; label: string }[] = [
		{ value: 'all', label: 'Semua Status' },
		{ value: 'aktif', label: 'Aktif (belum selesai/ditolak)' },
		...Object.entries(SAMPLE_STATUS_LABELS).map(([value, label]) => ({ value, label }))
	];
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<div class="flex items-center justify-between gap-3 mb-4">
			<div>
				<h1 class="text-[18px] font-extrabold tracking-tight" style="color: var(--sys-label)">Request Sample Cat</h1>
				<p class="text-[11px] font-medium" style="color: var(--sys-label3)">Pengajuan & approval sample cat untuk customer/prospect</p>
			</div>
			<button
				class="h-10 px-3.5 rounded-xl text-[12px] font-bold text-white flex items-center gap-1.5 shrink-0 shadow-sm shadow-[var(--p,var(--g))]/30 active:scale-95 transition-transform"
				style="background: var(--p, var(--g))"
				onclick={() => goto('/sales/sample-request/baru')}
			>
				<IconPlus size={16} stroke={2.5} /> Ajukan Sample
			</button>
		</div>

		<SalesNavTabs active="sample" sampleApprovalCount={canApprove ? approvalCount : 0} />

		<!-- Filters -->
		<div class="rounded-2xl border p-3 mb-4" style="border-color: var(--sys-sep); background: var(--sys-bg)">
			<div class="flex items-center gap-1.5 mb-2.5">
				<button
					class="h-8 px-3 rounded-lg text-[11px] font-bold {scope === 'mine' ? 'text-white' : ''}"
					style={scope === 'mine' ? 'background: var(--p, var(--g))' : 'background: var(--sys-fill); color: var(--sys-label2)'}
					onclick={() => { scope = 'mine'; load(); }}
				>
					Pengajuan Saya
				</button>
				<button
					class="h-8 px-3 rounded-lg text-[11px] font-bold {scope === 'all' ? 'text-white' : ''}"
					style={scope === 'all' ? 'background: var(--p, var(--g))' : 'background: var(--sys-fill); color: var(--sys-label2)'}
					onclick={() => { scope = 'all'; load(); }}
				>
					Semua {#if canApprove && approvalCount > 0}<span class="ml-1 px-1.5 rounded-full bg-amber-500 text-white text-[9px]">{approvalCount}</span>{/if}
				</button>
			</div>

			<div class="relative mb-2">
				<IconSearch size={15} class="absolute left-3 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" />
				<input
					class="w-full h-9 pl-9 pr-8 rounded-lg border text-[12px]"
					style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
					placeholder="Cari nomor, warna, produk, customer..."
					bind:value={searchQuery}
					onkeydown={(e) => e.key === 'Enter' && load()}
				/>
				{#if searchQuery}
					<button class="absolute right-2.5 top-1/2 -translate-y-1/2" style="color: var(--sys-label4)" onclick={() => { searchQuery = ''; load(); }}>
						<IconX size={13} />
					</button>
				{/if}
			</div>

			<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
				<select class="h-9 px-2 rounded-lg border text-[11px] font-semibold sm:col-span-2" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)" bind:value={filterStatus} onchange={load}>
					{#each STATUS_FILTER_OPTS as o}<option value={o.value}>{o.label}</option>{/each}
				</select>
				<label class="flex items-center gap-1 px-2 h-9 rounded-lg border text-[10px] font-semibold" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)">
					<span>Dari</span>
					<input type="date" class="w-full bg-transparent text-[11px]" style="color: var(--sys-label)" bind:value={fromDate} onchange={load} />
				</label>
				<label class="flex items-center gap-1 px-2 h-9 rounded-lg border text-[10px] font-semibold" style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label3)">
					<span>s/d</span>
					<input type="date" class="w-full bg-transparent text-[11px]" style="color: var(--sys-label)" bind:value={toDate} onchange={load} />
				</label>
			</div>
			<button class="mt-2 text-[11px] font-bold flex items-center gap-1" style="color: var(--sys-label3)" onclick={load}>
				<IconRefresh size={13} class={loading ? 'animate-spin' : ''} /> Segarkan
			</button>
		</div>

		{#if errorMsg}
			<p class="text-[12px] font-bold mb-3" style="color: #DC2626">{errorMsg}</p>
		{/if}

		{#if loading}
		<div class="flex flex-col items-center justify-center py-20">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat pengajuan sample..." />
		</div>
		{:else if rows.length === 0}
			<div class="text-center py-14 rounded-2xl border border-dashed" style="border-color: var(--sys-sep)">
				<span class="inline-flex p-3 rounded-2xl bg-violet-500/10 text-violet-600 dark:text-violet-400 mb-2"><IconFlask size={26} /></span>
				<p class="text-[13px] font-bold" style="color: var(--sys-label)">Belum ada request sample</p>
				<button class="mt-3 px-4 py-2 rounded-xl text-[12px] font-bold text-white inline-flex items-center gap-1.5" style="background: var(--p, var(--g))" onclick={() => goto('/sales/sample-request/baru')}>
					<IconPlus size={14} /> Ajukan Sample
				</button>
			</div>
		{:else}
			<div class="flex flex-col gap-3">
				{#each rows as r (r.id)}
					<div class="rounded-2xl border p-4 shadow-sm" style="border-color: var(--sys-sep); background: var(--sys-bg)">
						<div class="flex items-start justify-between gap-2">
							<div class="min-w-0">
								<p class="text-[13px] font-bold truncate" style="color: var(--sys-label)">{custOf(r)}</p>
								<p class="text-[11px] font-mono mt-0.5" style="color: var(--p, var(--g))">{r.nomor_request || 'DRAFT'}</p>
							</div>
							<span class="shrink-0 text-[10px] font-bold px-2 py-0.5 rounded-full" style={sampleStatusStyle(r.status as SampleStatus)}>
								{SAMPLE_STATUS_LABELS[r.status as SampleStatus] || r.status}
							</span>
						</div>

						<div class="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 text-[11px]" style="color: var(--sys-label3)">
							<span>Produk: <b style="color: var(--sys-label2)">{r.produk_cat || '-'}</b></span>
							<span>Warna: <b style="color: var(--sys-label2)">{r.warna || '-'}</b></span>
							<span>Ukuran: <b style="color: var(--sys-label2)">{r.ukuran_sample || '-'}</b></span>
							<span>Jumlah: <b style="color: var(--sys-label2)">{r.jumlah ?? '-'}</b></span>
							<span>Kategori: <b style="color: var(--sys-label2)">{kategoriSampleLabel(r.kategori) || '-'}</b></span>
							<span>Tanggal: <b style="color: var(--sys-label2)">{fmtDate(r.tanggal)}</b></span>
							<span>Sales: <b style="color: var(--sys-label2)">{nameOf(r.sales_id)}</b></span>
						</div>

						{#if r.keterangan}
							<p class="mt-2 text-[11px] italic p-2 rounded-lg" style="background: var(--sys-fill); color: var(--sys-label2)">"{r.keterangan}"</p>
						{/if}

						{#if r.catatan_approver}
							<p class="mt-2 text-[11px] p-2 rounded-lg" style="background: var(--aml); color: var(--amd)">
								<b>Catatan approver:</b> {r.catatan_approver}
							</p>
						{/if}

						<!-- Fase 6.3: timeline status (hanya untuk request yang sudah lewat approval) -->
						{#if !['draft', 'menunggu_approval', 'ditolak'].includes(r.status)}
							{@const curIdx = timelineStepIndex(r.status)}
							<div class="flex items-center mt-3 mb-1">
								{#each TIMELINE_STEPS as step, i (step.status)}
									{@const stepIdx = timelineStepIndex(step.status)}
									{@const done = curIdx >= stepIdx}
									<div class="flex items-center flex-1 last:flex-none">
										<div class="flex flex-col items-center gap-1 shrink-0">
											<div
												class="w-2.5 h-2.5 rounded-full shrink-0"
												style="background: {done ? 'var(--p, var(--g))' : 'var(--sys-fill)'}; border: 1.5px solid {done ? 'var(--p, var(--g))' : 'var(--sys-sep)'}"
											></div>
											<span class="text-[8px] font-semibold whitespace-nowrap" style="color: {done ? 'var(--sys-label2)' : 'var(--sys-label4)'}">{step.label}</span>
										</div>
										{#if i < TIMELINE_STEPS.length - 1}
											<div class="flex-1 h-[1.5px] mx-1 -mt-3.5" style="background: {curIdx > stepIdx ? 'var(--p, var(--g))' : 'var(--sys-sep)'}"></div>
										{/if}
									</div>
								{/each}
							</div>
						{/if}

						<!-- Fase 6.3: feedback customer -- wajib dicatat sales setelah terkirim -->
						{#if r.feedback_hasil}
							<p class="mt-2 text-[11px] p-2 rounded-lg" style="background: var(--sys-fill); color: var(--sys-label2)">
								<b>Feedback customer:</b> {FEEDBACK_HASIL_LABELS[r.feedback_hasil] || r.feedback_hasil}
								{#if r.feedback_catatan}<span class="italic"> — "{r.feedback_catatan}"</span>{/if}
							</p>
						{:else if ['terkirim', 'selesai'].includes(r.status) && (typeof r.sales_id === 'object' ? r.sales_id?.id : r.sales_id) === $authStore.karyawanId}
							{#if feedbackFormId === r.id}
								<div class="mt-2 p-2.5 rounded-lg border" style="border-color: var(--sys-sep); background: var(--sys-fill2)">
									<p class="text-[11px] font-bold mb-1.5" style="color: var(--sys-label)">Feedback Customer</p>
									<div class="flex gap-1.5 mb-2">
										{#each Object.entries(FEEDBACK_HASIL_LABELS) as [val, label]}
											<button
												class="flex-1 h-7 rounded-lg text-[10px] font-bold"
												style={feedbackHasil === val ? 'background: var(--p, var(--g)); color: white' : 'background: var(--sys-fill); color: var(--sys-label2)'}
												onclick={() => (feedbackHasil = val as any)}
											>{label}</button>
										{/each}
									</div>
									<textarea
										class="w-full p-2 rounded-lg border text-[11px] mb-2"
										style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
										rows="2"
										placeholder="Catatan feedback (opsional)"
										bind:value={feedbackCatatan}
									></textarea>
									<div class="flex gap-1.5">
										<button class="flex-1 h-8 rounded-lg text-[11px] font-bold" style="background: var(--sys-fill); color: var(--sys-label)" onclick={() => (feedbackFormId = null)}>Batal</button>
										<button class="flex-1 h-8 rounded-lg text-[11px] font-bold text-white" style="background: var(--p, var(--g))" disabled={feedbackBusy} onclick={() => submitFeedback(r)}>
											{feedbackBusy ? 'Menyimpan...' : 'Simpan'}
										</button>
									</div>
								</div>
							{:else}
								<button
									class="mt-2 h-8 px-3 rounded-lg text-[11px] font-bold w-full"
									style="background: var(--aml); color: var(--amd)"
									onclick={() => openFeedbackForm(r)}
								>
									📝 Isi Feedback Customer
								</button>
							{/if}
						{/if}

						<!-- Actions -->
						<div class="flex flex-wrap items-center gap-1.5 mt-3 pt-2.5 border-t" style="border-color: var(--sys-sep)">
							{#if r.status === 'draft'}
								<button class="h-8 px-3 rounded-lg text-[11px] font-bold text-white" style="background: var(--p, var(--g))" disabled={busyId === r.id} onclick={() => act(r, 'submit')}>
									Kirim untuk Approval
								</button>
							{/if}

							{#if canApprove && r.status === 'menunggu_approval'}
								<input
									class="h-8 flex-1 min-w-[120px] px-2 rounded-lg border text-[11px]"
									style="border-color: var(--sys-sep); background: var(--sys-fill); color: var(--sys-label)"
									placeholder="Catatan approver (opsional)"
									value={noteById[r.id] || ''}
									oninput={(e) => (noteById = { ...noteById, [r.id]: e.currentTarget.value })}
								/>
								<button class="h-8 px-3 rounded-lg text-[11px] font-bold text-white bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1" disabled={busyId === r.id} onclick={() => act(r, 'approve', { catatan: noteById[r.id] || '' })}>
									<IconCheck size={13} /> Setujui
								</button>
								<button class="h-8 px-3 rounded-lg text-[11px] font-bold text-white bg-rose-600 hover:bg-rose-700" disabled={busyId === r.id} onclick={() => act(r, 'reject', { catatan: noteById[r.id] || '' })}>
									Tolak
								</button>
							{/if}

							{#if r.status === 'disetujui'}
								<button class="h-8 px-3 rounded-lg text-[11px] font-bold" style="background: var(--sys-fill); color: var(--sys-label)" disabled={busyId === r.id} onclick={() => act(r, 'mark_process')}>
									Tandai Diproses
								</button>
							{/if}
							{#if r.status === 'disetujui' || r.status === 'dalam_proses'}
								<button class="h-8 px-3 rounded-lg text-[11px] font-bold text-white" style="background: var(--p, var(--g))" disabled={busyId === r.id} onclick={() => act(r, 'mark_sent')}>
									Tandai Terkirim
								</button>
							{/if}
							{#if r.status === 'terkirim'}
								<button class="h-8 px-3 rounded-lg text-[11px] font-bold text-white bg-emerald-600" disabled={busyId === r.id} onclick={() => act(r, 'mark_done')}>
									Tandai Selesai
								</button>
							{/if}

							{#if r.tanggal_kirim}
								<span class="text-[10px] flex items-center gap-1 ml-auto" style="color: var(--sys-label3)">
									<IconClock size={11} /> Kirim: {fmtDate(r.tanggal_kirim)}
								</span>
							{/if}
							{#if busyId === r.id}<IconLoader2 size={14} class="animate-spin" style="color: var(--sys-label4)" />{/if}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>
