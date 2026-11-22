<script lang="ts">
	// Ikrar "Golden Rules EPI" di form Site Check-in (Budaya & Propaganda Fase 5). Tampil HANYA bila setelan aktif, ada butir, dan karyawan
	// belum berikrar pada proyek ini; sekali dicentang tercatat di server dan tidak muncul lagi untuk proyek itu. Non-blocking kecuali setelan
	// "wajib" dinyalakan (`blokir` = wajib & belum berikrar). Gagal memuat/skema belum ada → tidak tampil dan TIDAK pernah memblokir.
	import { getGoldenRules, ikrarGoldenRules, type GoldenRulesState } from '$lib/services/ess/budaya';
	import { IconShieldCheck, IconLoader2 } from '@tabler/icons-svelte';

	let { projectId, blokir = $bindable(false) }: { projectId: number | null; blokir?: boolean } = $props();

	let gr = $state<GoldenRulesState | null>(null);
	let busy = $state(false);
	let err = $state('');
	let diceklis = $state(false);

	$effect(() => {
		const pid = projectId;
		gr = null;
		err = '';
		diceklis = false;
		blokir = false;
		if (!pid) return;
		let batal = false;
		getGoldenRules(pid)
			.then((r) => {
				if (batal) return;
				gr = r;
				blokir = r.enabled && r.wajib && !r.sudahIkrar;
			})
			.catch((e) => console.warn('[GoldenRules] gagal memuat (dilewati):', e?.message));
		return () => {
			batal = true;
		};
	});

	async function ikrar(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		if (!projectId || !gr || busy) return;
		if (!target.checked) {
			diceklis = false;
			return;
		}
		busy = true;
		err = '';
		try {
			await ikrarGoldenRules(projectId);
			diceklis = true;
			gr = { ...gr, sudahIkrar: true };
			blokir = false;
		} catch (ex: any) {
			target.checked = false;
			err = ex?.message || 'Gagal mencatat ikrar, coba lagi.';
		} finally {
			busy = false;
		}
	}
</script>

{#if gr?.enabled && (!gr.sudahIkrar || diceklis)}
	<section class="rounded-2xl p-4 border" style="background: rgba(37,99,235,0.07); border-color: rgba(37,99,235,0.30)" aria-label="Golden Rules EPI">
		<p class="text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5" style="color: #1d4ed8">
			<IconShieldCheck size={14} /> Golden Rules EPI — komitmen di proyek ini
		</p>
		<ol class="mt-2 space-y-1.5 text-sm list-decimal pl-5" style="color: var(--sys-label)">
			{#each gr.rules as r}<li>{r}</li>{/each}
		</ol>
		<label class="mt-3 flex items-start gap-2.5 text-sm font-semibold cursor-pointer" style="color: var(--sys-label)">
			<input type="checkbox" class="mt-0.5 w-5 h-5" checked={diceklis} disabled={busy || diceklis} onchange={ikrar} />
			<span>
				Saya berikrar menjalankan Golden Rules ini selama bekerja di proyek ini.
				{#if busy}<IconLoader2 size={14} class="inline animate-spin" />{/if}
			</span>
		</label>
		{#if gr.wajib && !diceklis}<p class="text-[11px] mt-1.5" style="color: #b45309">Ikrar wajib dicentang sebelum check-in.</p>{/if}
		{#if err}<p class="text-xs mt-1.5 text-red-600">{err}</p>{/if}
		{#if diceklis}<p class="text-xs mt-1.5 font-bold text-emerald-600">✅ Ikrar tercatat. Selamat bekerja — selamat & berkualitas!</p>{/if}
	</section>
{/if}
