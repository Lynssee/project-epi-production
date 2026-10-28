<!-- src/lib/components/anggaran/GateChangeBanner.svelte
     L1 (Rencana Pertajam ERP) — banner "Aturan gate berubah" di Home lapangan: memberi tahu SEBELUM "kemarin bisa,
     sekarang ditolak". Hanya muncul bila ada kenaikan keketatan mode gate (7 hari terakhir) pada jenis pengajuan yang
     relevan (diatur admin) DAN pengguna terhubung ke proyek (nol noise bagi peran non-PL). Bisa ditutup per perubahan
     (tersimpan di perangkat). Komponen mandiri & non-blocking, pola sama KesiapanProyekWidget. -->
<script lang="ts">
	import { onMount } from 'svelte';
	import { getProjectsForCurrentUser } from '$lib/services/projectScope';
	import { fetchGateChanges, getDismissed, dismissChange, modeLabel, type GateChange } from '$lib/services/gateChangeBanner';

	let changes = $state<GateChange[]>([]);

	onMount(async () => {
		try {
			const projects = (await getProjectsForCurrentUser(false)) || [];
			if (projects.length === 0) return;
			const dismissed = getDismissed();
			changes = (await fetchGateChanges(7)).filter((c) => !dismissed.has(String(c.id))).slice(0, 3);
		} catch (e) {
			console.error('[GateChangeBanner] gagal memuat:', e);
		}
	});

	function tutup(id: number | string) {
		dismissChange(id);
		changes = changes.filter((c) => String(c.id) !== String(id));
	}
</script>

{#if changes.length > 0}
	<div class="rounded-xl p-3 mb-4 space-y-2" style="background: #FEF3C7; border: 1px solid #F59E0B">
		<p class="text-[12px] font-semibold" style="color: #92400E">⚠️ Aturan pengajuan berubah</p>
		{#each changes as c (c.id)}
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0 text-[11px]" style="color: #78350F">
					<span class="font-semibold">{c.nama}</span> ({c.jenis}): {modeLabel(c.from)} → <b>{modeLabel(c.to)}</b>
					{#if c.enforce_from}<span> · berlaku sejak {c.enforce_from}</span>{/if}
					{#if c.hint}<em class="block text-[10px] mt-0.5" style="color: #92400E">Tips: {c.hint}</em>{/if}
				</div>
				<button type="button" onclick={() => tutup(c.id)} class="text-[10px] font-semibold shrink-0" style="color: #92400E" aria-label="Tutup pemberitahuan ini">Mengerti ✕</button>
			</div>
		{/each}
		<p class="text-[10px]" style="color: #92400E">Cek kesiapan proyek Anda di menu Anggaran → Cek Gate sebelum mengajukan.</p>
	</div>
{/if}
