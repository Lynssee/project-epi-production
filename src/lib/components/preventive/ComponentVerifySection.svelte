<!-- src/lib/components/preventive/ComponentVerifySection.svelte -->
<!--
	CLM v2 Fase 4 — "Verifikasi Komponen Kritis" di dalam P2H.
	Blok mandiri: fetch komponen terpasang di unit, operator scan/tandai match|mismatch
	+ kondisi, lalu tulis component_inspection_log SATU per komponen (tertaut p2h_session_id).
	TIDAK menyentuh alur submit P2H atomik / draft — aman ditambahkan ke halaman besar.
	Mekanik/operator TIDAK melihat rupiah.
-->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { IconLoader2, IconCircleCheck, IconAlertTriangle } from '@tabler/icons-svelte';
	import { authStore } from '$lib/stores/auth';
	import { parseEpiQr } from '$lib/utils/qrParse';
	import {
		getComponentUnitsForEquipment,
		recordComponentInspection,
		type ComponentUnitLite
	} from '$lib/services/clm';

	let { equipmentId, sessionId = null }: { equipmentId: string; sessionId?: string | null } = $props();

	let loading = $state(true);
	let units = $state<ComponentUnitLite[]>([]);
	let done = $state<Record<number, 'match' | 'mismatch'>>({});
	let savingId = $state<number | null>(null);
	let errorMsg = $state('');

	// input manual kode (kalau kamera tak dipakai)
	let manualCode = $state('');
	let manualError = $state('');

	onMount(async () => {
		try {
			units = await getComponentUnitsForEquipment(equipmentId);
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal memuat daftar komponen.';
		} finally {
			loading = false;
		}
	});

	async function mark(unit: ComponentUnitLite, match: boolean, kondisi: 'baik' | 'perlu_perhatian' | 'rusak') {
		savingId = unit.id;
		errorMsg = '';
		try {
			await recordComponentInspection({
				component_unit_id: unit.id,
				equipment_id: equipmentId,
				p2h_session_id: sessionId,
				scanned_code: `EPI:COMP:${unit.id}`,
				scan_method: 'manual',
				match_status: match ? 'match' : 'mismatch',
				kondisi,
				operatorName: $authStore.user?.displayName || $authStore.user?.email || null
			});
			done = { ...done, [unit.id]: match ? 'match' : 'mismatch' };
		} catch (e) {
			errorMsg = e instanceof Error ? e.message : 'Gagal menyimpan.';
		}
		savingId = null;
	}

	async function submitManual() {
		manualError = '';
		const parsed = parseEpiQr(manualCode.trim());
		if (!parsed || parsed.type !== 'COMP') {
			manualError = 'Kode bukan format EPI:COMP:<id>.';
			return;
		}
		const uid = Number(parsed.id);
		const known = units.find((u) => u.id === uid);
		if (known) {
			await mark(known, true, 'baik');
			manualCode = '';
			return;
		}
		// Kode valid tapi bukan komponen yang terdaftar di unit ini -> mismatch, jangan dipaksa.
		savingId = -1;
		try {
			await recordComponentInspection({
				component_unit_id: uid,
				equipment_id: equipmentId,
				p2h_session_id: sessionId,
				scanned_code: manualCode.trim(),
				scan_method: 'manual',
				match_status: 'mismatch',
				kondisi: null,
				catatan: 'Kode komponen tidak terdaftar pada unit ini',
				operatorName: $authStore.user?.displayName || $authStore.user?.email || null
			});
			manualError = 'Tercatat sebagai TIDAK COCOK — laporkan ke supervisor.';
			manualCode = '';
		} catch (e) {
			manualError = e instanceof Error ? e.message : 'Gagal menyimpan.';
		}
		savingId = null;
	}
</script>

<div class="mt-6 mx-auto max-w-xs text-left rounded-xl border p-4" style="border-color: var(--sys-sep)">
	<p class="text-[12px] font-bold mb-1" style="color: var(--sys-label)">Verifikasi Komponen Kritis</p>
	<p class="text-[10px] mb-3" style="color: var(--sys-label3)">
		Cek komponen ber-QR (aki, ban) yang terpasang di unit ini. Kalau kode tidak cocok dengan barang fisik, jangan dipaksa — laporkan ke supervisor.
	</p>

	{#if loading}
		<CircularProgressGauge size={40} strokeWidth={3} label="Memuat verifikasi komponen..." />
	{:else}
		{#if units.length === 0}
			<p class="text-[11px] py-2" style="color: var(--sys-label4)">
				Belum ada komponen ber-QR terdaftar di unit ini.
			</p>
		{:else}
			<div class="space-y-2">
				{#each units as u (u.id)}
					<div class="rounded-lg border p-2" style="border-color: var(--sys-sep)">
						<div class="text-[12px] font-semibold" style="color: var(--sys-label)">{u.nama}</div>
						<div class="text-[10px] mb-2" style="color: var(--sys-label3)">
							#{u.id} · {u.kategori}{u.merek ? ` · ${u.merek}` : ''}{u.kode_unit ? ` · ${u.kode_unit}` : ''}
						</div>
						{#if done[u.id]}
							<div class="flex items-center gap-1.5 text-[11px] font-semibold"
								style={done[u.id] === 'match' ? 'color: #16A34A' : 'color: #DC2626'}>
								{#if done[u.id] === 'match'}<IconCircleCheck size={14} /> Cocok — tercatat
								{:else}<IconAlertTriangle size={14} /> Tidak cocok — laporkan supervisor{/if}
							</div>
						{:else}
							<div class="flex flex-wrap gap-1.5">
								<button
									class="px-2 py-1 rounded-md text-[11px] font-semibold text-white disabled:opacity-40"
									style="background: #16A34A"
									disabled={savingId === u.id}
									onclick={() => mark(u, true, 'baik')}
								>Cocok · Baik</button>
								<button
									class="px-2 py-1 rounded-md text-[11px] font-semibold text-white disabled:opacity-40"
									style="background: #D97706"
									disabled={savingId === u.id}
									onclick={() => mark(u, true, 'perlu_perhatian')}
								>Cocok · Perlu perhatian</button>
								<button
									class="px-2 py-1 rounded-md text-[11px] font-semibold text-white disabled:opacity-40"
									style="background: #DC2626"
									disabled={savingId === u.id}
									onclick={() => mark(u, false, 'rusak')}
								>Tidak cocok / rusak</button>
							</div>
						{/if}
					</div>
				{/each}
			</div>
		{/if}

		<div class="mt-3 pt-3 border-t" style="border-color: var(--sys-sep)">
			<label for="clmManualCode" class="block text-[10px] font-semibold mb-1" style="color: var(--sys-label3)">
				Scan / ketik kode QR komponen lain
			</label>
			<div class="flex gap-1.5">
				<input
					id="clmManualCode"
					bind:value={manualCode}
					placeholder="EPI:COMP:12"
					class="flex-1 rounded-md px-2 py-1.5 text-[12px]"
					style="background: var(--sys-bg); border: 1px solid var(--sys-sep); color: var(--sys-label)"
				/>
				<button
					class="px-3 py-1.5 rounded-md text-[11px] font-semibold text-white disabled:opacity-40"
					style="background: var(--g)"
					disabled={savingId != null || !manualCode.trim()}
					onclick={submitManual}
				>Cek</button>
			</div>
			{#if manualError}
				<p class="text-[10px] mt-1" style="color: #DC2626">{manualError}</p>
			{/if}
		</div>

		{#if errorMsg}
			<p class="text-[11px] mt-2" style="color: #DC2626">{errorMsg}</p>
		{/if}
	{/if}
</div>
