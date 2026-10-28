<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	// Fase 4 — panel Borongan di detail proyek (dashboard lapangan). Mobile-first.
	// PL: lihat termin borongan + verifikasi progres (foto BAP + catatan + % progres).
	// Rencana termin & pengajuan ke Finance = Admin ERP.
	import { onMount } from 'svelte';
	import {
		getBoronganAssignments, getBoronganTermins, verifyTermin,
		type BoronganTermin
	} from '$lib/services/manpowerBorongan';
	import BoronganTerminCard from './BoronganTerminCard.svelte';

	let { project }: { project: any } = $props();

	const rupiah = (v: any) => 'Rp ' + (Number(v) || 0).toLocaleString('id-ID');

	let loading = $state(true);
	let assignments = $state<any[]>([]);
	let terminsByAssignment = $state<Record<number, BoronganTermin[]>>({});
	let expanded = $state<Record<number, boolean>>({});
	let errorMsg = $state('');

	// Verify sheet
	let verifyTarget = $state<BoronganTermin | null>(null);
	let vNote = $state('');
	let vProgress = $state<string>('');
	let vFiles = $state<File[]>([]);
	let vSaving = $state(false);

	let currentUser = $state('');

	onMount(async () => {
		try {
			const { auth } = await import('$lib/firebase');
			currentUser = auth?.currentUser?.email || auth?.currentUser?.displayName || 'Project Leader';
		} catch { /* ignore */ }
		await load();
	});

	async function load() {
		loading = true;
		errorMsg = '';
		try {
			assignments = await getBoronganAssignments(project.id);
		} catch (e: any) {
			errorMsg = e?.message || 'Gagal memuat data borongan';
		}
		loading = false;
	}

	async function toggle(a: any) {
		expanded[a.id] = !expanded[a.id];
		if (expanded[a.id] && !terminsByAssignment[a.id]) {
			terminsByAssignment[a.id] = await getBoronganTermins(a.id);
		}
	}

	function openVerify(t: BoronganTermin) {
		verifyTarget = t;
		vNote = '';
		vProgress = '';
		vFiles = [];
	}

	function onFiles(e: Event) {
		const input = e.target as HTMLInputElement;
		vFiles = Array.from(input.files || []);
	}

	async function submitVerify() {
		if (!verifyTarget) return;
		if (vFiles.length === 0) {
			errorMsg = 'Lampirkan minimal 1 foto bukti progres';
			return;
		}
		vSaving = true;
		errorMsg = '';
		const res = await verifyTermin(verifyTarget.id, {
			note: vNote,
			files: vFiles,
			by: currentUser,
			progressPct: vProgress === '' ? null : Number(vProgress)
		});
		vSaving = false;
		if (!res.success) {
			errorMsg = res.error || 'Gagal memverifikasi';
			return;
		}
		const aId = typeof verifyTarget.assignment_id === 'object' ? verifyTarget.assignment_id.id : verifyTarget.assignment_id;
		verifyTarget = null;
		terminsByAssignment[aId] = await getBoronganTermins(aId);
		await load();
	}

	function summaryOf(a: any) {
		const t = (terminsByAssignment[a.id] || []).filter((x) => x.status !== 'cancelled');
		const nilai = Number(a.nilai_borongan) || 0;
		const paid = t.filter((x) => ['partial', 'paid'].includes(x.status)).reduce((s, x) => s + (Number(x.paid_amount) || 0), 0);
		return { nilai, paid, outstanding: Math.max(0, nilai - paid) };
	}
</script>

<div class="px-4 py-4 flex flex-col gap-3">
	<div class="card-section">
		<h4 class="flex items-center gap-2 text-[13px] font-semibold mb-1" style="color: var(--sys-label)">
			<span style="font-size:16px">📐</span> Termin Borongan
		</h4>
		<p class="text-[12px] mb-3" style="color: var(--sys-label3)">
			Verifikasi progres tiap termin borongan dengan foto + catatan (jadi BAP). Rencana termin & pencairan dana diproses Admin ERP.
		</p>

		{#if errorMsg}
			<p class="text-[12px] rounded-lg p-2 mb-2" style="background:#fee2e2;color:#b91c1c">{errorMsg}</p>
		{/if}

		{#if loading}
			<CircularProgressGauge size={46} strokeWidth={3} label="Memuat SPK borongan..." />
		{:else if assignments.length === 0}
			<div class="rounded-xl p-4 text-center" style="background: var(--sys-fill2, #f8fafc)">
				<div class="text-3xl mb-2">📐</div>
				<p class="text-[12.5px] font-semibold" style="color: var(--sys-label)">Belum ada SPK borongan di proyek ini</p>
				<p class="text-[11px] mt-1" style="color: var(--sys-label3)">SPK manpower borongan dibuat Admin di menu Manpower & SPK.</p>
			</div>
		{:else}
			<div class="flex flex-col gap-2.5">
				{#each assignments as a (a.id)}
					{@const s = summaryOf(a)}
					<div class="rounded-2xl overflow-hidden" style="border: 1px solid var(--sys-border, #e2e8f0)">
						<button type="button" onclick={() => toggle(a)} class="w-full text-left p-3 flex items-center gap-2" style="background: var(--sys-bg2, #fff)">
							<span class="text-[11px]" style="color: var(--sys-label3)">{expanded[a.id] ? '▾' : '▸'}</span>
							<div class="flex-1 min-w-0">
								<p class="text-[13px] font-bold truncate" style="color: var(--sys-label)">
									{typeof a.manpower_id === 'object' ? a.manpower_id?.nama : `Manpower #${a.manpower_id}`}
								</p>
								<p class="text-[11px]" style="color: var(--sys-label3)">{a.jabatan || '-'}</p>
							</div>
							<div class="text-right">
								<p class="text-[12px] font-bold" style="color: var(--sys-label)">{rupiah(a.nilai_borongan)}</p>
								<p class="text-[10px]" style="color: {a.borongan_status === 'lunas' ? '#15803d' : a.borongan_status === 'berjalan' ? '#b45309' : 'var(--sys-label3)'}">
									{a.borongan_status === 'lunas' ? 'Lunas' : a.borongan_status === 'berjalan' ? 'Berjalan' : 'Belum ada termin'}
								</p>
							</div>
						</button>

						{#if expanded[a.id]}
							<div class="p-3 flex flex-col gap-2.5" style="background: var(--sys-fill2, #f8fafc); border-top: 1px solid var(--sys-border, #e2e8f0)">
								{#if !terminsByAssignment[a.id]}
									<p class="text-[11px] py-2" style="color: var(--sys-label3)">Memuat termin…</p>
								{:else if terminsByAssignment[a.id].length === 0}
									<p class="text-[11px] py-2" style="color: var(--sys-label3)">Belum ada rencana termin. Admin ERP yang menyusunnya.</p>
								{:else}
									<div class="grid grid-cols-2 gap-2 text-center">
										<div class="rounded-lg p-2" style="background: var(--sys-bg2, #fff)">
											<p class="text-[13px] font-bold" style="color:#15803d">{rupiah(s.paid || a.borongan_total_paid)}</p>
											<p class="text-[9px] uppercase tracking-wide" style="color: var(--sys-label3)">Terbayar</p>
										</div>
										<div class="rounded-lg p-2" style="background: var(--sys-bg2, #fff)">
											<p class="text-[13px] font-bold" style="color:#b45309">{rupiah(s.outstanding || a.borongan_outstanding)}</p>
											<p class="text-[9px] uppercase tracking-wide" style="color: var(--sys-label3)">Outstanding</p>
										</div>
									</div>
									{#each terminsByAssignment[a.id] as t (t.id)}
										<BoronganTerminCard termin={t} onVerify={openVerify} />
									{/each}
								{/if}
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
</div>

<!-- Verify bottom sheet -->
{#if verifyTarget}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<div role="presentation" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style="background: rgba(0,0,0,0.45)" onclick={(e) => { if (e.target === e.currentTarget) verifyTarget = null; }}>
		<div class="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-5 flex flex-col gap-3" style="background: var(--sys-bg, #fff); max-height: 90vh; overflow-y: auto">
			<div class="flex items-center justify-between">
				<h3 class="text-[14px] font-bold" style="color: var(--sys-label)">Verifikasi — {verifyTarget.label}</h3>
				<button type="button" onclick={() => (verifyTarget = null)} style="color: var(--sys-label3)">✕</button>
			</div>
			<p class="text-[11px]" style="color: var(--sys-label3)">
				Foto kondisi pekerjaan di lapangan + catatan singkat. Menjadi bukti (BAP) yang diperiksa saat Admin mengajukan pencairan.
			</p>

			<label for="bt-progress" class="text-[11px] font-semibold" style="color: var(--sys-label2)">% Progres fisik proyek saat ini (opsional)</label>
			<input id="bt-progress" type="number" min="0" max="100" bind:value={vProgress} placeholder="mis. 35"
				class="rounded-xl px-3 py-2 text-[13px]" style="border: 1px solid var(--sys-border, #e2e8f0); background: transparent" />

			<label for="bt-note" class="text-[11px] font-semibold" style="color: var(--sys-label2)">Catatan verifikasi</label>
			<textarea id="bt-note" bind:value={vNote} rows="2" placeholder="mis. area A selesai 100%, siap lanjut area B"
				class="rounded-xl px-3 py-2 text-[13px]" style="border: 1px solid var(--sys-border, #e2e8f0); background: transparent"></textarea>

			<label for="bt-files" class="text-[11px] font-semibold" style="color: var(--sys-label2)">Foto bukti (wajib, min. 1) — otomatis dikompres</label>
			<input id="bt-files" type="file" accept="image/*" capture="environment" multiple onchange={onFiles} class="text-[11px]" />
			{#if vFiles.length}<p class="text-[10px]" style="color: var(--sys-label3)">{vFiles.length} foto dipilih</p>{/if}

			<button type="button" disabled={vSaving} onclick={submitVerify}
				class="mt-1 w-full rounded-xl py-2.5 text-[13px] font-bold disabled:opacity-50"
				style="background: var(--p); color: #fff">
				{vSaving ? 'Mengunggah…' : 'Simpan Verifikasi'}
			</button>
		</div>
	</div>
{/if}
