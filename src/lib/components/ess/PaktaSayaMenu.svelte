<script lang="ts">
	// "📋 Pakta & Aturan Saya" — dropdown ringkas di header: SOP/Alur dan perubahan aturan sistem (gate) yang belum disetujui, per kategori,
	// dengan tombol "Buka kegiatan" (rute yang dikunci) / "Baca". Tampil HANYA bila fitur Pakta aktif (system_settings project.pakta.enabled);
	// badge = jumlah yang perlu disetujui. Dimuat sekali per sesi + setelah ada persetujuan/kendala (PAKTA_REFRESH_EVENT) + saat dibuka bila cache >2 mnt.
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { getPaktaSaya, PAKTA_REFRESH_EVENT, type PaktaSaya, type PaktaSayaItem } from '$lib/services/ess/pakta';
	import { IconShieldCheck } from '@tabler/icons-svelte';

	let data = $state<PaktaSaya | null>(null);
	let open = $state(false);
	let loadedFor = '';

	async function load(force = false) {
		try {
			data = await getPaktaSaya({ force });
		} catch {
			data = null; // fail-open: menu disembunyikan
		}
	}

	onMount(() => {
		const unsub = authStore.subscribe((a) => {
			if (!a.checked || !a.karyawanId) return;
			const k = String(a.karyawanId);
			if (loadedFor === k) return;
			loadedFor = k;
			void load();
		});
		const onRefresh = () => void load(true);
		window.addEventListener(PAKTA_REFRESH_EVENT, onRefresh);
		return () => {
			unsub();
			window.removeEventListener(PAKTA_REFRESH_EVENT, onRefresh);
		};
	});

	let grup = $derived<Array<[string, PaktaSayaItem[]]>>([
		['Prosedur Kerja (SOP)', data?.prosedur ?? []],
		['Aturan Sistem (Gate)', data?.gate ?? []]
	]);

	const MODE_STATUS: Record<string, string> = { menunggu: 'Kendala diajukan — menunggu atasan', ditolak: 'Kendala ditolak' };

	function buka(item: PaktaSayaItem) {
		open = false;
		if (item.route) void goto(item.route);
		else if (item.baca_url) void goto(item.baca_url);
	}
	function toggle() {
		open = !open;
		if (open) void load(); // cache klien 2 menit → tidak menambah panggilan bila masih segar
	}
</script>

{#if data?.enabled}
	<div class="relative">
		<button
			type="button"
			class="relative w-7 h-7 lg:w-9 lg:h-9 rounded-full lg:rounded-xl flex items-center justify-center shrink-0 transition-all bg-[var(--sys-fill)] hover:bg-[var(--sys-fill2)] text-[var(--sys-label2)]"
			title="Pakta & Aturan Saya"
			aria-label="Pakta dan Aturan Saya"
			aria-expanded={open}
			onclick={toggle}
			data-testid="pakta-saya-btn"
		>
			<IconShieldCheck size={16} />
			{#if data.count > 0}
				<span class="absolute -top-1 -right-1 text-[8px] font-bold text-white rounded-full min-w-[14px] h-3.5 flex items-center justify-center px-0.5" style="background: #DC2626">{data.count > 99 ? '99+' : data.count}</span>
			{/if}
		</button>

		{#if open}
			<div class="absolute right-0 top-full mt-2 w-72 max-h-[70vh] overflow-y-auto rounded-xl p-2 shadow-xl z-50" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)" data-testid="pakta-saya-panel">
				<p class="px-2 pt-1 pb-2 text-[12px] font-bold" style="color: var(--sys-label)">📋 Pakta &amp; Aturan Saya</p>
				{#if data.count === 0}
					<p class="px-2 pb-2 text-[12px]" style="color: var(--sys-label2)">Tidak ada yang perlu Anda setujui. 👍</p>
				{:else}
					{#each grup as [judul, list] (judul)}
						{#if list.length}
							<p class="px-2 pt-1 text-[10px] font-bold uppercase tracking-wide" style="color: var(--sys-label3)">{judul}</p>
							{#each list as item (item.key)}
								<button type="button" class="w-full text-left rounded-lg px-2 py-2 hover:opacity-80" onclick={() => buka(item)}>
									<span class="block text-[12px] font-semibold" style="color: var(--sys-label)">{item.title ?? 'Tanpa judul'}</span>
									<span class="block text-[10px]" style="color: var(--sys-label3)">
										{item.label ? `Sebelum ${item.label} · ` : ''}{item.type === 'gate' ? 'perubahan aturan' : `versi ${item.version}`}
									</span>
									{#if item.status_kendala && MODE_STATUS[item.status_kendala]}
										<span class="block text-[10px] text-amber-600">{MODE_STATUS[item.status_kendala]}</span>
									{/if}
									<span class="block text-[10px] font-semibold" style="color: var(--sys-tint)">{item.route ? 'Buka kegiatan →' : 'Baca →'}</span>
								</button>
							{/each}
						{/if}
					{/each}
					<p class="px-2 pt-2 text-[10px]" style="color: var(--sys-label3)">Persetujuan dilakukan saat Anda membuka kegiatan terkait.</p>
				{/if}
			</div>
		{/if}
	</div>
{/if}
