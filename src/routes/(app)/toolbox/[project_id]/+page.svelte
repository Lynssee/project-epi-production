<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { get } from 'svelte/store';
	import { authStore } from '$lib/stores/auth';
	import { getProjectById } from '$lib/services/projects';
	import {
		getTodayParticipants,
		getTodayToolboxMeeting,
		listToolboxMeetings,
		uploadToolboxSignature,
		submitToolboxLifecycle,
		type ToolboxKondisi,
		type ToolboxActionItem,
		type ToolboxGateResult,
		type ToolboxParticipant,
		type ToolboxSignature,
		type ToolboxMeeting
	} from '$lib/services/toolboxMeeting';
	import { getReportByProjectAndDate } from '$lib/services/reports';
	import { getPreviousWorkday } from '$lib/utils/workingDays';
	import { fetchH1Gate, postToolboxEskalasi, type H1Gate } from '$lib/services/h1ReportGate';
	import SignaturePad from '$lib/components/shared/SignaturePad.svelte';
	import { IconArrowLeft, IconLoader2, IconCheck, IconUsers, IconAlertTriangle, IconAlertOctagon } from '@tabler/icons-svelte';

	let projectId = $derived($page.params.project_id as string);
	let loading = $state(true);
	let project = $state<any>(null);
	let evaluasiTanggal = $state('');

	let participants = $state<ToolboxParticipant[]>([]);
	let selected = $state<Record<number, boolean>>({});
	let signatures = $state<Record<number, ToolboxSignature>>({});
	let topik = $state('');
	let catatan = $state('');
	let submitting = $state(false);
	let alreadyDone = $state<ToolboxMeeting | null>(null);
	let history = $state<ToolboxMeeting[]>([]);

	let signingParticipant = $state<ToolboxParticipant | null>(null);
	let signPad = $state<any>(null);
	let signBusy = $state(false);
	let signError = $state('');

	// Guard "Laporan H-1 dulu baru MoM" (Fase 2, rencana_mom_briefing_per_proyek.md) — SOFT,
	// bukan gembok keras: banner + tombol pintas, form tetap bisa diisi (Aturan #6, jangan
	// matikan tombol aksi utama tanpa alternatif). Gagal muat (network) -> h1Gate null,
	// banner tidak tampil (fail-open).
	let h1Gate = $state<H1Gate | null>(null);
	let h1GateDismissed = $state(false);
	let h1Blocked = $derived(!h1GateDismissed && h1Gate?.status === 'failed');

	// Fast Issue Escalation (Fase 2 poin A.4) — centang saat briefing menemukan kendala kritis
	// (genset rusak, APD kurang, dll) -> WA darurat ke GM/Direktur saat toolbox disimpan.
	let eskalasi = $state(false);
	let eskalasiCatatan = $state('');
	let eskalasiTerkirim = $state(false);

	// Lifecycle Briefing: kondisi hasil standup + action item (wajib lengkap bila Kendala/Kritis — gate G_BRF_ACTION_PIC).
	let kondisi = $state<ToolboxKondisi | ''>('');
	let actionItems = $state<ToolboxActionItem[]>([]);
	let gateResult = $state<ToolboxGateResult | null>(null);
	let exceptionReason = $state('');
	let needsReason = $derived(!!gateResult?.gates?.some((g) => g.blocking && g.mode === 'soft'));
	let needsActionItems = $derived(kondisi === 'kendala' || kondisi === 'kritis');
	function addActionItem() {
		actionItems = [...actionItems, { action: '', pic: '', deadline: '' }];
	}
	function removeActionItem(i: number) {
		actionItems = actionItems.filter((_, idx) => idx !== i);
	}

	// Auto-draft agenda dari laporan kemarin (Fase 2 poin A.2, rencana_mom_briefing_per_proyek.md)
	// — rencana hari ini (tomorrow_plan_summary/tomorrow_plan yang ditulis KEMARIN) & kendala
	// terbuka kemarin jadi draf topik/catatan, supaya PL tidak ngetik ulang dari nol. Hanya
	// MENGISI field yang masih kosong, tidak pernah menimpa yang sudah diketik PL.
	let agendaDrafted = $state(false);

	function isMeaningfulText(s: unknown): s is string {
		if (!s || typeof s !== 'string') return false;
		const t = s.trim().toLowerCase();
		if (!t) return false;
		return !['-', '--', '---', '.', 'tidak ada', 'nihil', 'none', 'aman', 'normal', 'n/a', 'na'].includes(t);
	}

	function buildAgendaDraft(report: any): { topik: string; catatan: string } | null {
		if (!report) return null;
		const rencana: string[] = [];
		if (isMeaningfulText(report.tomorrow_plan_summary)) rencana.push(report.tomorrow_plan_summary.trim());
		const planItems = Array.isArray(report.tomorrow_plan) ? report.tomorrow_plan : [];
		for (const p of planItems) {
			const line = [p?.activity, p?.description || p?.notes].filter((x) => isMeaningfulText(x)).join(' — ');
			if (line) rencana.push(line);
		}

		const issueItems = Array.isArray(report.issues) ? report.issues : [];
		const kendala = issueItems.map((it: any) => it?.description).filter((d: unknown) => isMeaningfulText(d)) as string[];

		if (rencana.length === 0 && kendala.length === 0) return null;
		const topikParts = [rencana[0], kendala.length ? `${kendala.length} kendala terbuka` : null].filter(Boolean);
		const catatanLines = [
			rencana.length ? `Rencana hari ini (dari laporan kemarin):\n${rencana.map((r) => `- ${r}`).join('\n')}` : null,
			kendala.length ? `Kendala terbuka kemarin:\n${kendala.map((k) => `- ${k}`).join('\n')}` : null
		].filter(Boolean);
		return { topik: topikParts.join(' · ') || 'Lanjutan rencana kemarin', catatan: catatanLines.join('\n\n') };
	}

	let selectedCount = $derived(Object.values(selected).filter(Boolean).length);
	let signedCount = $derived(Object.keys(signatures).length);
	let allSigned = $derived(
		selectedCount > 0 &&
			Object.entries(selected)
				.filter(([, v]) => v)
				.every(([id]) => !!signatures[Number(id)])
	);

	onMount(async () => {
		loading = true;
		try {
			project = await getProjectById(projectId);
			const todayStr = new Date().toISOString().split('T')[0];
			const yesterdayStr = getPreviousWorkday(todayStr);
			evaluasiTanggal = yesterdayStr;
			const [today, parts, hist, yesterdayReport] = await Promise.all([
				getTodayToolboxMeeting(projectId),
				getTodayParticipants(projectId),
				listToolboxMeetings(projectId, 5),
				getReportByProjectAndDate(projectId, yesterdayStr).catch(() => null)
			]);
			alreadyDone = today;
			participants = parts;
			history = hist;
			for (const p of parts) selected[p.id] = true;

			// Hanya isi field yang masih kosong — tidak pernah menimpa draf yang sudah diketik PL.
			if (!alreadyDone && !topik.trim() && !catatan.trim()) {
				const draft = buildAgendaDraft(yesterdayReport);
				if (draft) {
					topik = draft.topik;
					catatan = draft.catatan;
					agendaDrafted = true;
				}
			}
		} finally {
			loading = false;
		}
		// Guard H-1 dicek belakangan, tidak menunda tampilnya halaman (non-blocking).
		fetchH1Gate(projectId)
			.then((g) => (h1Gate = g))
			.catch(() => (h1Gate = null));
	});

	function openSign(p: ToolboxParticipant) {
		signError = '';
		signingParticipant = p;
	}

	function closeSign() {
		signingParticipant = null;
	}

	async function submitSign() {
		if (!signingParticipant) return;
		if (!signPad || signPad.isEmpty()) {
			signError = 'Tanda tangan belum diisi.';
			return;
		}
		signBusy = true;
		try {
			const fileId = await uploadToolboxSignature(signPad.toDataURL(), signingParticipant.id);
			signatures[signingParticipant.id] = {
				manpower_id: signingParticipant.id,
				nama: signingParticipant.nama,
				file: fileId,
				signed_at: new Date().toISOString()
			};
			signingParticipant = null;
		} catch (e: any) {
			signError = e?.message || 'Gagal menyimpan tanda tangan';
		} finally {
			signBusy = false;
		}
	}

	async function submitToolbox() {
		if (!topik.trim()) {
			alert('Topik toolbox meeting wajib diisi.');
			return;
		}
		if (eskalasi && eskalasiCatatan.trim().length < 10) {
			alert('Jelaskan kendala kritis minimal 10 karakter sebelum mengeskalasikan ke manajemen.');
			return;
		}
		submitting = true;
		try {
			const auth = get(authStore);
			const pesertaIds = Object.entries(selected)
				.filter(([, v]) => v)
				.map(([id]) => Number(id));
			const nama = auth.karyawanName || auth.user?.displayName || auth.user?.email || 'Project Leader';
			// Eskalasi dicentang = kondisi Kritis; penjelasan kendala ikut jadi action item bernama PIC pencatat (lolos G_BRF_ACTION_PIC).
			const todayYmd = new Date().toISOString().split('T')[0];
			const effKondisi: ToolboxKondisi | null = eskalasi ? 'kritis' : kondisi || null;
			const items = actionItems.filter((a) => a.action.trim());
			if (eskalasi && eskalasiCatatan.trim()) items.unshift({ action: eskalasiCatatan.trim(), pic: nama, deadline: todayYmd });
			const res = await submitToolboxLifecycle({
				project_id: projectId,
				topik: topik.trim(),
				catatan: catatan.trim(),
				kondisi: effKondisi,
				action_items: items,
				peserta_manpower_ids: pesertaIds,
				signatures: Object.values(signatures),
				dibuat_oleh: nama,
				evaluasi_tanggal: evaluasiTanggal,
				exceptionReason: exceptionReason.trim() || undefined
			});
			gateResult = res.gate || null;
			if (res.success) {
				alreadyDone = res.data || null;
				exceptionReason = '';
				// Server sudah broadcast untuk kondisi Kritis; jalur WA lama hanya bila server tidak ikut mengirim (mis. jalur cadangan).
				if (eskalasi && eskalasiCatatan.trim() && !res.broadcast) {
					const esk = await postToolboxEskalasi(projectId, eskalasiCatatan.trim());
					eskalasiTerkirim = esk.ok && esk.waTerkirim;
					if (!esk.ok) alert('Toolbox tersimpan, tapi eskalasi WA ke manajemen gagal terkirim: ' + (esk.error || 'error') + '. Hubungi admin langsung bila kendala masih kritis.');
				} else if (res.broadcast) {
					eskalasiTerkirim = true;
				}
			} else {
				alert(res.error || 'Gagal menyimpan toolbox meeting');
			}
		} finally {
			submitting = false;
		}
	}

	function formatDate(d: string | null | undefined) {
		if (!d) return '-';
		try {
			return new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(d));
		} catch {
			return d;
		}
	}
</script>

<div class="flex-1 flex flex-col h-full">
	<div class="px-4 pt-4 max-w-4xl mx-auto w-full">
		<button
			type="button"
			onclick={() => goto(`/proyek/${projectId}`)}
			class="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-200 transition-colors mb-2"
		>
			<IconArrowLeft size={16} />
			<span>Kembali ke Detail Proyek</span>
		</button>
		<h2 class="text-lg font-bold text-slate-900 dark:text-slate-100">Toolbox Meeting — {project?.name || `Proyek #${projectId}`}</h2>
	</div>

	{#if loading}
		<div class="flex-1 flex items-center justify-center py-16" style="background: var(--sys-bg)">
			<CircularProgressGauge size={72} strokeWidth={6} label="Memuat Toolbox Meeting..." sublabel="Sinkronisasi log briefing keselamatan" />
		</div>
	{:else}
		<div class="scroll-body px-4 py-4 flex flex-col gap-3" style="background: var(--sys-bg)">
			<div class="card-section">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-[12px]" style="color: var(--sys-label3)">Proyek</p>
						<p class="text-[15px] font-bold" style="color: var(--sys-label)">{project?.name || '-'}</p>
					</div>
					<div class="text-right">
						<span class="inline-block text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full" style="background: rgba(34, 197, 94, 0.1); color: #16a34a">
							Briefing Pagi
						</span>
					</div>
				</div>
				<div class="grid grid-cols-2 gap-2 mt-2 pt-2 border-t" style="border-color: var(--sys-sep)">
					<div>
						<p class="text-[10px] uppercase tracking-wider font-medium" style="color: var(--sys-label3)">Hari / Tanggal Briefing</p>
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">{formatDate(new Date().toISOString())}</p>
					</div>
					<div>
						<p class="text-[10px] uppercase tracking-wider font-medium" style="color: var(--sys-label3)">Mengevaluasi Laporan</p>
						<p class="text-[12px] font-semibold" style="color: var(--sys-label)">{evaluasiTanggal ? formatDate(evaluasiTanggal) : '-'}</p>
					</div>
				</div>
			</div>

			{#if !alreadyDone && h1Blocked}
				<div class="card-section" style="border: 1px solid var(--am)">
					<div class="flex items-center gap-2 mb-1.5">
						<IconAlertTriangle size={18} style="color: var(--am)" />
						<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Laporan Kemarin Belum Disubmit</p>
					</div>
					<p class="text-[12px]" style="color: var(--sys-label3)">
						{#if h1Gate?.missingDates?.length}
							Laporan harian tanggal {h1Gate.missingDates.map(formatDate).join(', ')} belum ada. Isi dulu supaya Toolbox Meeting hari ini tercatat lengkap di sistem admin.
						{:else}
							Ada laporan harian hari sebelumnya yang belum disubmit. Isi dulu supaya Toolbox Meeting hari ini tercatat lengkap di sistem admin.
						{/if}
					</p>
					<div class="flex items-center gap-2 mt-2.5">
						<a
							href={`/laporan/${projectId}`}
							class="text-[12px] font-semibold px-3 py-1.5 rounded-full"
							style="background: var(--pl); color: var(--pd)"
						>+ Selesaikan Laporan Kemarin Sekarang</a>
						<button
							type="button"
							class="text-[11px] font-medium underline"
							style="color: var(--sys-label3)"
							onclick={() => (h1GateDismissed = true)}
						>Lanjut isi Toolbox saja</button>
					</div>
				</div>
			{/if}

			{#if alreadyDone}
				<div class="card-section" style="border: 1px solid var(--g)">
					<div class="flex items-center gap-2 mb-2">
						<IconCheck size={18} style="color: var(--g)" />
						<p class="text-[13px] font-semibold" style="color: var(--sys-label)">Toolbox hari ini sudah selesai</p>
					</div>
					<p class="text-[13px] font-medium" style="color: var(--sys-label)">{alreadyDone.topik}</p>
					{#if alreadyDone.catatan}
						<p class="text-[12px] mt-1" style="color: var(--sys-label3)">{alreadyDone.catatan}</p>
					{/if}
					<p class="text-[11px] mt-2" style="color: var(--sys-label3)">
						{alreadyDone.signatures?.length || 0} dari {alreadyDone.peserta_manpower_ids?.length || 0} peserta sudah TTD
					</p>
					{#if eskalasiTerkirim}
						<p class="text-[11px] mt-2 flex items-center gap-1" style="color: var(--re)">
							<IconAlertOctagon size={14} /> Eskalasi kendala kritis sudah dikirim ke manajemen.
						</p>
					{/if}
				</div>
			{:else}
				<div class="card-section">
					<div class="flex items-center justify-between mb-3">
						<h4 class="text-[13px] font-semibold" style="color: var(--sys-label)">Topik &amp; Catatan</h4>
						{#if agendaDrafted}
							<button
								type="button"
								class="text-[11px] font-medium underline shrink-0"
								style="color: var(--sys-label3)"
								onclick={() => { topik = ''; catatan = ''; agendaDrafted = false; }}
							>Bersihkan draf</button>
						{/if}
					</div>
					{#if agendaDrafted}
						<p class="text-[11px] mb-2" style="color: var(--g)">✨ Diisi otomatis dari rencana &amp; kendala laporan kerja kemarin ({evaluasiTanggal ? formatDate(evaluasiTanggal) : 'kemarin'}) — silakan sunting bebas.</p>
					{/if}
					<input
						bind:value={topik}
						placeholder="Topik utama (mis. bahaya sandblasting hari ini)"
						class="w-full border rounded-lg px-3 py-2 text-[13px] mb-2"
						style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
					/>
					<textarea
						bind:value={catatan}
						rows={agendaDrafted ? 5 : 2}
						placeholder="Catatan/risalah pembahasan (opsional)"
						class="w-full border rounded-lg px-3 py-2 text-[13px]"
						style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)"
					></textarea>
				</div>

				<div class="card-section">
					<h4 class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Kondisi Hasil Standup</h4>
					<p class="text-[11px] mb-2.5" style="color: var(--sys-label3)">Pilih kondisi lapangan pagi ini. Bila Ada Kendala / Kritis, isi tindak lanjut lengkap (aksi, PIC, tenggat) supaya bisa disubmit.</p>
					<div class="flex flex-wrap gap-2">
						{#each [['aman', '🟢 Aman'], ['kendala', '🟡 Ada Kendala'], ['kritis', '🔴 Kritis']] as [v, label]}
							<button
								type="button"
								class="text-[12px] font-semibold px-3 py-1.5 rounded-full border"
								style={kondisi === v ? 'background: var(--pl); color: var(--pd); border-color: var(--pd)' : 'border-color: var(--sys-sep); color: var(--sys-label3)'}
								onclick={() => (kondisi = kondisi === v ? '' : (v as ToolboxKondisi))}
							>{label}</button>
						{/each}
					</div>

					{#if needsActionItems || actionItems.length > 0}
						<div class="mt-3 flex flex-col gap-2">
							<p class="text-[12px] font-semibold" style="color: var(--sys-label)">Tindak Lanjut ({actionItems.length})</p>
							{#each actionItems as it, i}
								<div class="rounded-lg border p-2 flex flex-col gap-1.5" style="border-color: var(--sys-sep)">
									<input bind:value={it.action} placeholder="Aksi / tindak lanjut" class="w-full border rounded-lg px-2.5 py-1.5 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
									<div class="flex gap-1.5">
										<input bind:value={it.pic} placeholder="PIC" class="flex-1 min-w-0 border rounded-lg px-2.5 py-1.5 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
										<input type="date" bind:value={it.deadline} class="border rounded-lg px-2 py-1.5 text-[13px]" style="border-color: var(--sys-sep); background: var(--sys-bg); color: var(--sys-label)" />
										<button type="button" class="text-[12px] px-2" style="color: var(--re)" aria-label="Hapus tindak lanjut" onclick={() => removeActionItem(i)}>✕</button>
									</div>
								</div>
							{/each}
							<button type="button" class="self-start text-[12px] font-semibold px-3 py-1.5 rounded-full" style="background: var(--pl); color: var(--pd)" onclick={addActionItem}>+ Tambah tindak lanjut</button>
						</div>
					{/if}
				</div>

				<div class="card-section" style={eskalasi ? 'border: 1px solid var(--re)' : ''}>
					<label class="flex items-start gap-2.5 cursor-pointer">
						<input type="checkbox" bind:checked={eskalasi} class="mt-0.5 shrink-0" />
						<span>
							<span class="text-[13px] font-semibold flex items-center gap-1.5" style="color: var(--sys-label)">
								<IconAlertOctagon size={15} style="color: var(--re)" /> Eskalasikan ke Manajemen
							</span>
							<span class="text-[11px]" style="color: var(--sys-label3)">Centang bila ditemukan kendala kritis pagi ini (genset rusak, material/APD kurang, dll) — WA darurat langsung terkirim ke GM/Direktur saat toolbox disimpan.</span>
						</span>
					</label>
					{#if eskalasi}
						<textarea
							bind:value={eskalasiCatatan}
							rows="2"
							placeholder="Jelaskan kendala kritis secara ringkas (wajib, min. 10 karakter)..."
							class="w-full border rounded-lg px-3 py-2 text-[13px] mt-2.5"
							style="border-color: var(--re); background: var(--sys-bg); color: var(--sys-label)"
						></textarea>
					{/if}
				</div>

				<div class="card-section">
					<div class="flex items-center justify-between mb-3">
						<h4 class="flex items-center gap-2 text-[13px] font-semibold" style="color: var(--sys-label)">
							<IconUsers size={16} style="color: var(--g)" /> Peserta ({signedCount}/{selectedCount} TTD)
						</h4>
					</div>

					{#if participants.length === 0}
						<p class="text-[12px] text-center py-4" style="color: var(--sys-label3)">
							Belum ada data manpower dari laporan hari ini maupun laporan kemarin ({evaluasiTanggal ? formatDate(evaluasiTanggal) : 'kemarin'}). Manpower akan terisi otomatis setelah laporan harian dibuat.
						</p>
					{:else}
						<div class="flex flex-col divide-y" style="border-color: var(--sys-sep)">
							{#each participants as p (p.id)}
								<div class="flex items-center gap-2.5 py-2.5">
									<input type="checkbox" bind:checked={selected[p.id]} class="shrink-0" />
									<div class="flex-1 min-w-0">
										<p class="text-[13px] font-medium truncate" style="color: var(--sys-label)">{p.nama}</p>
										<p class="text-[10px]" style="color: var(--sys-label3)">{p.role}</p>
									</div>
									{#if selected[p.id]}
										{#if signatures[p.id]}
											<span class="text-[11px] font-semibold px-2 py-1 rounded-full flex items-center gap-1" style="background: var(--gl); color: var(--gd)">
												<IconCheck size={12} /> TTD
											</span>
										{:else}
											<button
												class="text-[11px] font-semibold px-2.5 py-1.5 rounded-full"
												style="background: var(--pl); color: var(--pd)"
												onclick={() => openSign(p)}
											>
												TTD di sini
											</button>
										{/if}
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>

				{#if gateResult?.gates?.some((g) => g.status === 'failed')}
					<div class="card-section" style="border: 1px solid var(--am)">
						<p class="text-[13px] font-semibold flex items-center gap-2 mb-1.5" style="color: var(--sys-label)"><IconAlertTriangle size={16} style="color: var(--am)" /> Catatan Sistem</p>
						{#each gateResult.gates.filter((g) => g.status === 'failed') as g}
							<p class="text-[12px]" style="color: {g.blocking ? 'var(--re)' : 'var(--sys-label3)'}">{g.blocking ? '⛔' : '⚠️'} {g.label}: {g.message}</p>
						{/each}
						{#if needsReason}
							<textarea
								bind:value={exceptionReason}
								rows="2"
								placeholder="Alasan dispensasi (min. 20 karakter) lalu tekan Simpan lagi..."
								class="w-full border rounded-lg px-3 py-2 text-[13px] mt-2"
								style="border-color: var(--am); background: var(--sys-bg); color: var(--sys-label)"
							></textarea>
						{/if}
					</div>
				{/if}

				<button
					class="w-full py-3 rounded-xl text-[14px] font-semibold text-white disabled:opacity-50"
					style="background: var(--g)"
					disabled={submitting || !topik.trim() || selectedCount === 0}
					onclick={submitToolbox}
				>
					{submitting ? 'Menyimpan...' : allSigned ? 'Selesai & Simpan' : `Simpan (${signedCount}/${selectedCount} TTD)`}
				</button>
				<p class="text-[11px] text-center" style="color: var(--sys-label3)">
					Peserta boleh disimpan tanpa TTD lengkap — bisa dilengkapi lagi nanti dari riwayat di bawah.
				</p>
			{/if}

			{#if history.length > 0}
				<div class="card-section">
					<h4 class="text-[13px] font-semibold mb-3" style="color: var(--sys-label)">Riwayat Toolbox</h4>
					<div class="flex flex-col divide-y" style="border-color: var(--sys-sep)">
						{#each history as h (h.id)}
							<div class="py-2.5">
								<div class="flex items-center justify-between">
									<p class="text-[12px] font-semibold" style="color: var(--sys-label)">{formatDate(h.tanggal)}</p>
									<span class="text-[10px]" style="color: var(--sys-label3)">{h.signatures?.length || 0}/{h.peserta_manpower_ids?.length || 0} TTD</span>
								</div>
								<p class="text-[12px] mt-0.5" style="color: var(--sys-label3)">{h.topik}</p>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

{#if signingParticipant}
	<div class="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
		<div class="bg-white rounded-lg shadow-xl w-full max-w-md p-5">
			<h3 class="font-semibold text-gray-800 mb-1">TTD — {signingParticipant.nama}</h3>
			<p class="text-xs text-gray-500 mb-3">{signingParticipant.role}</p>

			<SignaturePad bind:this={signPad} height={160} />

			{#if signError}
				<div class="text-red-600 text-xs mt-2">{signError}</div>
			{/if}

			<div class="mt-4 flex gap-2 justify-end">
				<button
					onclick={closeSign}
					disabled={signBusy}
					class="px-3 py-1.5 text-sm font-semibold rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50"
				>Batal</button>
				<button
					onclick={submitSign}
					disabled={signBusy}
					class="px-3 py-1.5 text-sm font-semibold rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50"
				>{signBusy ? 'Menyimpan...' : 'Simpan TTD'}</button>
			</div>
		</div>
	</div>
{/if}
