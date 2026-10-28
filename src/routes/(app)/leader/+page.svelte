<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import { authStore } from '$lib/stores/auth';
	import { isLeaderRole } from '$lib/stores/auth';
	import {
		getLedProjects, getActiveEquipmentIds, getPlKpi,
		getMekanikActivitiesForReview, getWorkloadByMekanik, getPmScheduleForEquipment,
		type LedProject, type PlKpi, type MekanikActivityForReview, type MekanikWorkload, type PlPmScheduleItem
	} from '$lib/services/plDashboard';
	import { getMyNewAssignments, type NewAssignment } from '$lib/services/plDelegation';
	import LeaderTimeline from '$lib/components/leader/LeaderTimeline.svelte';
	import LeaderKesiapanCard from '$lib/components/leader/LeaderKesiapanCard.svelte';
	import { getIdToken } from '$lib/services/secureDirectus';
	import IconLoader2 from '@tabler/icons-svelte/icons/loader-2';
	import IconClipboardCheck from '@tabler/icons-svelte/icons/clipboard-check';
	import IconUsers from '@tabler/icons-svelte/icons/users';
	import IconCalendarDue from '@tabler/icons-svelte/icons/calendar-due';
	import IconLayoutGrid from '@tabler/icons-svelte/icons/layout-grid';
	import IconCheck from '@tabler/icons-svelte/icons/check';
	import IconX from '@tabler/icons-svelte/icons/x';
	import IconAlertTriangle from '@tabler/icons-svelte/icons/alert-triangle';

	type Tab = 'ringkasan' | 'review' | 'workload' | 'pm';
	let activeTab = $state<Tab>('ringkasan');

	let loading = $state(true);
	let errorMsg = $state('');
	let projects = $state<LedProject[]>([]);
	let equipmentIds = $state<string[]>([]);
	let kpi = $state<PlKpi | null>(null);
	let reviewList = $state<MekanikActivityForReview[]>([]);
	let workload = $state<MekanikWorkload[]>([]);
	let pmSchedule = $state<PlPmScheduleItem[]>([]);
	let newAssignments = $state<NewAssignment[]>([]);

	let rejectingId = $state<string | null>(null);
	let rejectNote = $state('');
	let actingId = $state<string | null>(null);
	let actionError = $state('');

	$effect(() => {
		const checked = $authStore.checked;
		if (checked && !isLeaderRole($authStore.roleId) && $authStore.roleId !== 'super_admin') {
			goto('/');
		}
	});

	async function loadAll() {
		loading = true;
		errorMsg = '';
		try {
			projects = await getLedProjects($authStore.karyawanId, $authStore.karyawanName);
			if (!projects.length) {
				loading = false;
				return;
			}
			const projectIds = projects.map((p) => p.id);
			equipmentIds = await getActiveEquipmentIds(projectIds);
			if (!equipmentIds.length) {
				loading = false;
				return;
			}
			const [k, review, wl, pm] = await Promise.all([
				getPlKpi(equipmentIds),
				getMekanikActivitiesForReview(equipmentIds, 'pending'),
				getWorkloadByMekanik(equipmentIds),
				getPmScheduleForEquipment(equipmentIds)
			]);
			kpi = k;
			reviewList = review;
			workload = wl;
			pmSchedule = pm;
		} catch (err: any) {
			errorMsg = err?.message || 'Gagal memuat data dashboard.';
		} finally {
			loading = false;
		}
	}

	let ackBusyId = $state<number | null>(null);
	let ackFormId = $state<{ id: number; mode: 'kendala' | 'pendamping' } | null>(null);
	let ackNote = $state('');
	let ackError = $state('');

	async function sendAck(a: NewAssignment, status: 'diterima' | 'kendala' | 'pendamping') {
		if (status !== 'diterima' && !ackNote.trim()) return;
		ackBusyId = a.id;
		ackError = '';
		try {
			const token = await getIdToken();
			const res = await fetch('/api/project/delegasi-ack', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ delegationLogId: a.id, status, catatan: status !== 'diterima' ? ackNote.trim() : '' })
			});
			const data = await res.json().catch(() => null);
			if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
			const note = ackNote.trim();
			newAssignments = newAssignments.map((x) =>
				x.id === a.id ? { ...x, ackStatus: status, ackCatatan: status !== 'diterima' ? note : null } : x
			);
			ackFormId = null;
			ackNote = '';
		} catch (err: any) {
			ackError = err?.message || 'Gagal mengirim respons.';
		} finally {
			ackBusyId = null;
		}
	}

	async function loadAssignments() {
		if (!$authStore.karyawanId) return;
		newAssignments = await getMyNewAssignments($authStore.karyawanId);
	}

	onMount(() => {
		loadAll();
		loadAssignments();
	});

	async function callApprovalEndpoint(id: string, action: 'approve' | 'reject', catatan?: string) {
		const token = await getIdToken();
		const res = await fetch(`/api/maintenance/mekanik-activity/${id}/${action}`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify(catatan ? { catatan } : {})
		});
		const data = await res.json().catch(() => null);
		if (!res.ok) throw new Error(data?.message || `Gagal (${res.status})`);
		return data;
	}

	async function approve(id: string) {
		actingId = id;
		actionError = '';
		try {
			await callApprovalEndpoint(id, 'approve');
			reviewList = reviewList.filter((r) => r.id !== id);
		} catch (err: any) {
			actionError = err?.message || 'Gagal menyetujui laporan.';
		} finally {
			actingId = null;
		}
	}

	async function submitReject(id: string) {
		if (!rejectNote.trim()) return;
		actingId = id;
		actionError = '';
		try {
			await callApprovalEndpoint(id, 'reject', rejectNote.trim());
			reviewList = reviewList.filter((r) => r.id !== id);
			rejectingId = null;
			rejectNote = '';
		} catch (err: any) {
			actionError = err?.message || 'Gagal menolak laporan.';
		} finally {
			actingId = null;
		}
	}

	function formatDate(d: string | null) {
		if (!d) return '-';
		return new Date(d).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
	}

	const tabs: { id: Tab; label: string; icon: any }[] = [
		{ id: 'ringkasan', label: 'Ringkasan', icon: IconLayoutGrid },
		{ id: 'review', label: 'Review Laporan', icon: IconClipboardCheck },
		{ id: 'workload', label: 'Workload', icon: IconUsers },
		{ id: 'pm', label: 'PM Schedule', icon: IconCalendarDue }
	];
</script>

<div class="max-w-4xl mx-auto p-4 md:p-6 pb-24">
	<h1 class="text-[18px] md:text-xl font-bold mb-1" style="color: var(--sys-label)">Dashboard Project Leader</h1>
	<p class="text-[12px] md:text-[14px] mb-4" style="color: var(--sys-label3)">
		{#if projects.length}
			{projects.map((p) => p.name).join(', ')}
		{:else}
			Ringkasan proyek yang Anda pimpin
		{/if}
	</p>

	{#if newAssignments.length}
		<div class="rounded-xl border p-3.5 mb-4" style="border-color: var(--g); background: var(--pl)">
			<p class="text-[13px] font-bold mb-0.5" style="color: var(--pd)">Penugasan Baru ({newAssignments.length})</p>
			<p class="text-[11px] mb-2.5" style="color: var(--sys-label3)">Anda ditugaskan sebagai Project Leader dalam 14 hari terakhir. Buka proyek untuk mulai persiapan pra-mobilisasi.</p>
			{#if ackError}<p class="text-[12px] mb-2" style="color: #DC2626">{ackError}</p>{/if}
			<div class="flex flex-col gap-2">
				{#each newAssignments as a (a.id)}
					<div class="rounded-lg border bg-white p-3" style="border-color: var(--sys-sep)">
					<a href={`/proyek/${a.projectId}`} class="block">
						<div class="flex items-start justify-between gap-2">
							<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{a.projectName}</p>
							<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style="background: var(--pl); color: var(--pd)">{a.tipe === 'transisi' ? '🤝 Transisi' : 'Baru'}</span>
						</div>
						{#if a.leaderLamaNama}
							<p class="text-[11px] font-semibold text-orange-600 mt-0.5">
								Transisi dari {a.leaderLamaNama}
							</p>
						{/if}
						<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">
							{[a.customer, a.lokasi].filter(Boolean).join(' · ') || '-'}
						</p>
						<p class="text-[11px] mt-1" style="color: var(--sys-label3)">
							{formatDate(a.tanggalEfektif)}{a.delegatedBy ? ` · oleh ${a.delegatedBy}` : ''}{a.suratTugasNomor ? ` · ST ${a.suratTugasNomor}` : ''}
						</p>
						{#if a.alasan}<p class="text-[11px] mt-1" style="color: var(--sys-label2)">Catatan: {a.alasan}</p>{/if}
					</a>
					{#if a.ackStatus === 'diterima'}
						<div class="flex items-center justify-between gap-2 mt-2">
							<p class="text-[11px] font-semibold" style="color: #16A34A">&#10003; Sudah diterima</p>
							<a href={`/pra-mobilisasi/${a.projectId}`} class="text-[11px] font-semibold underline" style="color: var(--pd)" title="Lengkapi checklist pra-mobilisasi proyek ini">Buka Pra-Mobilisasi &rarr;</a>
						</div>
					{:else}
						{#if a.ackStatus === 'kendala' || a.ackStatus === 'pendamping'}
							<p class="text-[11px] mt-2" style="color: #DC2626"><span class="font-semibold">{a.ackStatus === 'pendamping' ? 'Permintaan pendamping' : 'Kendala dilaporkan'}:</span> {a.ackCatatan}</p>
							<p class="text-[11px] mt-0.5" style="color: var(--sys-label3)">Menunggu tanggapan admin.</p>
						{/if}
						{#if a.adminTanggapan}
							<div class="mt-2 rounded-lg p-2.5" style="background: var(--pl)">
								<p class="text-[11px] font-semibold" style="color: var(--pd)">Tanggapan admin{a.adminTanggapanOleh ? ` (${a.adminTanggapanOleh})` : ''}{a.ackStatus === 'teratasi' ? ' &middot; kendala ditandai teratasi' : ''}</p>
								<p class="text-[12px] mt-0.5 whitespace-pre-line" style="color: var(--sys-label2)">{a.adminTanggapan}</p>
							</div>
						{/if}
						{#if ackFormId && ackFormId.id === a.id}
							<textarea class="w-full rounded-lg border text-[12px] p-2.5 mt-2" style="border-color: var(--sys-sep)" rows="2" placeholder={ackFormId.mode === 'pendamping' ? 'Pendamping seperti apa yang dibutuhkan? (wajib)' : 'Jelaskan kendala jadwal (wajib)'} bind:value={ackNote}></textarea>
							<div class="flex gap-2 mt-2">
								<button class="flex-1 h-9 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40" style="background: #DC2626" disabled={!ackNote.trim() || ackBusyId === a.id} onclick={() => sendAck(a, ackFormId!.mode)}>Kirim</button>
								<button class="px-3 h-9 rounded-lg text-[12px] font-semibold border" style="border-color: var(--sys-sep); color: var(--sys-label3)" onclick={() => { ackFormId = null; ackNote = ''; }}>Batal</button>
							</div>
						{:else}
							<div class="flex flex-wrap gap-2 mt-2.5">
								<button class="flex-1 min-w-[140px] h-9 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40" style="background: #16A34A" disabled={ackBusyId === a.id} title="Konfirmasi Anda siap memegang proyek ini" onclick={() => sendAck(a, 'diterima')}>Terima &amp; Siapkan Pra-Mobilisasi</button>
								<button class="px-3 h-9 rounded-lg text-[12px] font-semibold border" style="border-color: var(--sys-sep); color: var(--sys-label2)" title="Laporkan jadwal bentrok atau kendala lain" onclick={() => { ackFormId = { id: a.id, mode: 'kendala' }; ackNote = ''; }}>Lapor Kendala</button>
								<button class="px-3 h-9 rounded-lg text-[12px] font-semibold border" style="border-color: var(--sys-sep); color: var(--sys-label2)" title="Minta admin menugaskan pendamping" onclick={() => { ackFormId = { id: a.id, mode: 'pendamping' }; ackNote = ''; }}>Minta Pendamping</button>
							</div>
						{/if}
					{/if}
				</div>
				{/each}
			</div>
		</div>
	{/if}

	{#if $authStore.karyawanId || $authStore.karyawanName}
		<LeaderTimeline karyawanId={$authStore.karyawanId} karyawanName={$authStore.karyawanName} />
	{/if}

	{#if projects.length}
		<LeaderKesiapanCard projectIds={projects.map((p) => p.id)} />
	{/if}

	{#if loading}
		<div class="flex flex-col items-center justify-center py-16">
			<CircularProgressGauge size={54} strokeWidth={4} label="Memuat dashboard tugas leader..." />
		</div>
	{:else if errorMsg}
		<div class="text-center py-16 text-[13px]" style="color: #DC2626">{errorMsg}</div>
	{:else if !projects.length}
		<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">
			Anda belum tercatat sebagai leader di proyek manapun (projects.leader_id). Hubungi admin bila ini keliru.
		</div>
	{:else if !equipmentIds.length}
		<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">
			Belum ada equipment aktif ditugaskan ke proyek Anda.
		</div>
	{:else}
		<div class="flex gap-1.5 mb-4 overflow-x-auto pb-1">
			{#each tabs as t}
				<button
					class="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold border shrink-0"
					style={activeTab === t.id ? 'background: var(--g); color: #fff; border-color: var(--g)' : 'border-color: var(--sys-sep); color: var(--sys-label3)'}
					onclick={() => (activeTab = t.id)}
				>
					<t.icon size={14} />
					{t.label}
					{#if t.id === 'review' && reviewList.length > 0}
						<span class="text-[9px] font-bold text-white rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-1" style="background: #DC2626">{reviewList.length}</span>
					{/if}
				</button>
			{/each}
		</div>

		{#if activeTab === 'ringkasan' && kpi}
			<div class="grid grid-cols-2 md:grid-cols-3 gap-3">
				<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
					<p class="text-[11px]" style="color: var(--sys-label3)">WO Aktif</p>
					<p class="text-[22px] font-bold mt-1" style="color: var(--sys-label)">{kpi.woOpen}</p>
				</div>
				<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
					<p class="text-[11px]" style="color: var(--sys-label3)">Menunggu QC</p>
					<p class="text-[22px] font-bold mt-1" style="color: var(--sys-label)">{kpi.woInspection}</p>
				</div>
				<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
					<p class="text-[11px]" style="color: var(--sys-label3)">Total WO</p>
					<p class="text-[22px] font-bold mt-1" style="color: var(--sys-label)">{kpi.woTotal}</p>
				</div>
				<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
					<p class="text-[11px]" style="color: var(--sys-label3)">P2H Hari Ini</p>
					<p class="text-[22px] font-bold mt-1" style="color: var(--sys-label)">{kpi.p2hDone}/{kpi.p2hEquipmentCount}</p>
				</div>
				<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
					<p class="text-[11px]" style="color: var(--sys-label3)">PM Overdue</p>
					<p class="text-[22px] font-bold mt-1" style={kpi.pmOverdue > 0 ? 'color: #DC2626' : 'color: var(--sys-label)'}>{kpi.pmOverdue}</p>
				</div>
				<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
					<p class="text-[11px]" style="color: var(--sys-label3)">Total Jadwal PM</p>
					<p class="text-[22px] font-bold mt-1" style="color: var(--sys-label)">{kpi.pmTotal}</p>
				</div>
			</div>
		{/if}

		{#if activeTab === 'review'}
			{#if actionError}
				<p class="text-[12px] mb-3" style="color: #DC2626">{actionError}</p>
			{/if}
			{#if reviewList.length === 0}
				<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Tidak ada laporan yang menunggu review.</div>
			{:else}
				<div class="flex flex-col gap-3">
					{#each reviewList as act (act.id)}
						<div class="rounded-xl border p-3.5" style="border-color: var(--sys-sep)">
							<div class="flex items-start justify-between gap-2">
								<div class="min-w-0">
									<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{act.equipmentName}</p>
									<p class="text-[11px]" style="color: var(--sys-label3)">{act.mekanikName} &middot; {formatDate(act.tanggalInput)}</p>
								</div>
							</div>
							<p class="text-[12px] mt-2 whitespace-pre-line" style="color: var(--sys-label2)">{act.kegiatanRepair}</p>
							{#if act.sparepartRingkas}
								<p class="text-[11px] mt-1.5" style="color: var(--sys-label3)"><span class="font-semibold">Sparepart:</span> {act.sparepartRingkas}</p>
							{/if}
							{#if act.kendala}
								<p class="text-[11px] mt-1" style="color: #DC2626"><span class="font-semibold">Kendala:</span> {act.kendala}</p>
							{/if}

							{#if rejectingId === act.id}
								<div class="mt-3 flex flex-col gap-2">
									<textarea
										class="w-full rounded-lg border text-[12px] p-2.5"
										style="border-color: var(--sys-sep)"
										rows="2"
										placeholder="Catatan penolakan (wajib) — apa yang perlu diperbaiki?"
										bind:value={rejectNote}
									></textarea>
									<div class="flex gap-2">
										<button
											class="flex-1 h-9 rounded-lg text-[12px] font-semibold text-white disabled:opacity-40"
											style="background: #DC2626"
											disabled={!rejectNote.trim() || actingId === act.id}
											onclick={() => submitReject(act.id)}
										>
											Kirim Penolakan
										</button>
										<button
											class="px-3 h-9 rounded-lg text-[12px] font-semibold border"
											style="border-color: var(--sys-sep); color: var(--sys-label3)"
											onclick={() => { rejectingId = null; rejectNote = ''; }}
										>
											Batal
										</button>
									</div>
								</div>
							{:else}
								<div class="flex gap-2 mt-3">
									<button
										class="flex-1 h-9 rounded-lg text-[12px] font-semibold text-white flex items-center justify-center gap-1.5 disabled:opacity-40"
										style="background: #16A34A"
										disabled={actingId === act.id}
										onclick={() => approve(act.id)}
									>
										{#if actingId === act.id}<IconLoader2 size={14} class="animate-spin" />{:else}<IconCheck size={14} />{/if}
										Setujui
									</button>
									<button
										class="flex-1 h-9 rounded-lg text-[12px] font-semibold border flex items-center justify-center gap-1.5"
										style="border-color: var(--sys-sep); color: var(--sys-label2)"
										onclick={() => { rejectingId = act.id; rejectNote = ''; }}
									>
										<IconX size={14} /> Tolak
									</button>
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		{/if}

		{#if activeTab === 'workload'}
			{#if workload.length === 0}
				<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Belum ada WO tercatat untuk mekanik di proyek ini.</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each workload as w (w.mekanikId)}
						<div class="rounded-xl border p-3.5 flex items-center justify-between" style="border-color: var(--sys-sep)">
							<p class="text-[13px] font-semibold" style="color: var(--sys-label)">{w.mekanikName}</p>
							<div class="flex items-center gap-3">
								<div class="text-right">
									<p class="text-[16px] font-bold" style="color: var(--g)">{w.woAktif}</p>
									<p class="text-[10px]" style="color: var(--sys-label4)">Aktif</p>
								</div>
								<div class="text-right">
									<p class="text-[13px] font-semibold" style="color: var(--sys-label3)">{w.woTotal}</p>
									<p class="text-[10px]" style="color: var(--sys-label4)">Total</p>
								</div>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}

		{#if activeTab === 'pm'}
			{#if pmSchedule.length === 0}
				<div class="text-center py-16 text-[13px]" style="color: var(--sys-label3)">Tidak ada jadwal PM aktif.</div>
			{:else}
				<div class="flex flex-col gap-2">
					{#each pmSchedule as pm (pm.id)}
						<div class="rounded-xl border p-3.5 flex items-center justify-between gap-2" style="border-color: var(--sys-sep)">
							<div class="min-w-0">
								<p class="text-[13px] font-semibold truncate" style="color: var(--sys-label)">{pm.equipmentName}</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">{pm.taskName}</p>
							</div>
							<div class="text-right shrink-0">
								{#if pm.overdue}
									<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--rel); color:var(--red)">
										<IconAlertTriangle size={11} /> Overdue
									</span>
								{:else}
									<span class="text-[10px] font-semibold px-2 py-0.5 rounded-full" style="background:var(--pl); color:var(--pd)">Terjadwal</span>
								{/if}
								<p class="text-[10px] mt-1" style="color: var(--sys-label4)">{formatDate(pm.dueDate)}</p>
							</div>
						</div>
					{/each}
				</div>
			{/if}
		{/if}
	{/if}
</div>
