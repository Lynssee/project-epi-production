<script lang="ts">
	// Rencana Self-Service PL v2, FASE 2 — meteran Plafon Mandiri PL di form Pengajuan
	// Anggaran Baru. PL tahu nasib pengajuannya SEBELUM menekan kirim: disetujui
	// otomatis (tanpa menunggu admin) atau perlu approval manajer.
	//
	// Fail-soft: kalau admin tak terjangkau (available=false), komponen diam — tidak
	// menampilkan apa pun, tidak menahan submit.
	import { getIdToken } from '$lib/services/secureDirectus';

	let { projectId = null, amount = 0, kategori = null } = $props<{
		projectId?: number | string | null;
		amount?: number;
		kategori?: string | null;
	}>();

	let data = $state<any>(null);
	let loading = $state(false);

	function rp(n: number) {
		return 'Rp ' + Math.round(Number(n) || 0).toLocaleString('id-ID');
	}

	let timer: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const pid = projectId ? Number(projectId) : null;
		const amt = Number(amount) || 0;
		const kat = kategori || '';
		if (!pid || amt <= 0) {
			data = null;
			return;
		}
		clearTimeout(timer);
		timer = setTimeout(async () => {
			loading = true;
			try {
				const token = await getIdToken();
				const qs = new URLSearchParams({ projectId: String(pid), amount: String(amt), kategori: kat });
				const res = await fetch(`/api/plafon-mandiri-status?${qs}`, { headers: { Authorization: `Bearer ${token}` } });
				const j = await res.json();
				data = j?.available && j?.enabled ? j : null;
			} catch {
				data = null;
			} finally {
				loading = false;
			}
		}, 400);
		return () => clearTimeout(timer);
	});

	let pct = $derived(
		data && data.monthlyCap > 0 ? Math.min(100, Math.round((data.monthlyUsed / data.monthlyCap) * 100)) : 0
	);
	let barColor = $derived(pct >= 90 ? '#dc2626' : pct >= 70 ? '#d97706' : '#16a34a');
</script>

{#if data}
	<div class="mt-1.5 rounded-lg border border-indigo-200 bg-indigo-50 dark:bg-indigo-950/20 dark:border-indigo-900 px-2.5 py-2 text-[11px] text-indigo-900 dark:text-indigo-200">
		<div class="font-semibold mb-1">
			Plafon mandiri proyek bulan ini{#if data.mode === 'shadow'} <span class="opacity-70">(simulasi)</span>{/if}
		</div>
		<div class="h-2 rounded-full bg-indigo-100 dark:bg-indigo-900 overflow-hidden mb-1">
			<div class="h-full rounded-full" style="width:{pct}%; background:{barColor}"></div>
		</div>
		<div class="opacity-80">
			Terpakai <strong>{rp(data.monthlyUsed)}</strong> / {rp(data.monthlyCap)} · sisa {rp(data.monthlyRemaining)}
		</div>
		<div class="mt-1">
			Pengajuan ini {rp(data.thisAmount)} →
			{#if data.verdict === 'otomatis'}
				<strong class="text-emerald-700 dark:text-emerald-400">✅ Otomatis disetujui, tanpa menunggu admin</strong>
			{:else if data.verdict === 'otomatis_simulasi'}
				<strong class="text-emerald-700 dark:text-emerald-400">✅ Akan otomatis disetujui</strong>
				<span class="opacity-70">(mode simulasi — masih lewat admin sampai plafon mandiri diaktifkan)</span>
			{:else}
				<strong class="text-amber-700 dark:text-amber-400">⏳ Perlu persetujuan manajer</strong>
				{#if data.reasons?.length}
					<ul class="list-disc ml-4 mt-0.5 opacity-80">
						{#each data.reasons as r}<li>{r}</li>{/each}
					</ul>
				{/if}
			{/if}
		</div>
		<div class="mt-1 opacity-70">
			Plafon mandiri bukan uang gratis: semua pengajuan otomatis tetap diaudit, nota wajib diunggah maks H+3.
			Kategori yang boleh mandiri: {(data.kategoriDiizinkan || []).join(', ') || '—'}.
		</div>
	</div>
{:else if loading}
	<p class="text-[11px] text-slate-400 mt-1.5">Memeriksa plafon mandiri…</p>
{/if}
