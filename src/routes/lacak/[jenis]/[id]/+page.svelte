<!-- src/routes/lacak/[jenis]/[id]/+page.svelte -->
<!--
	Jembatan tautan pelacakan publik (erp-epi /lacak/<jenis>/<id>?h=<sig>) → layar Lapangan dengan AKSI sesuai peran.
	Alur: staf memindai QR di dokumen / membuka tautan WhatsApp → (halaman publik erp-epi menawarkan "Buka di aplikasi
	Lapangan") → di sini. Rute ini berada di luar (app) tetapi tetap kena guard login root +layout.svelte (sama seperti /scan):
	belum login → /login?returnTo=/lacak/... lalu kembali kemari otomatis. Begitu mount, user dijamin sudah login.
	qr_token Surat Jalan hanya diberikan server kepada user login + pemegang tautan bertanda tangan sah (api/lacak/resolve).
-->
<script lang="ts">
	import CircularProgressGauge from '$lib/components/shared/CircularProgressGauge.svelte';
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { goto } from '$app/navigation';
	import { auth } from '$lib/firebase';
	import { IconAlertTriangle, IconArrowLeft } from '@tabler/icons-svelte';

	const jenis = page.params.jenis;
	const id = page.params.id;
	const sig = page.url.searchParams.get('h') || '';

	let status = $state<'resolving' | 'error'>('resolving');
	let errorMsg = $state('');
	let label = $state('');
	// URL halaman publik (baca-saja) dari server; kosong bila server tak menjawab.
	let publikUrl = $state('');

	async function resolve() {
		try {
			const user = auth.currentUser;
			if (!user) throw new Error('Sesi tidak ditemukan. Silakan login ulang.');
			const token = await user.getIdToken();
			const res = await fetch('/api/lacak/resolve', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
				body: JSON.stringify({ jenis, id, sig })
			});
			const out = await res.json().catch(() => ({}));
			publikUrl = out?.publik || '';
			if (!res.ok || !out.target) throw new Error(out?.message || `Gagal memproses tautan (${res.status}).`);
			label = out.label || '';
			// external: jenis tanpa layar Lapangan → halaman publik erp-epi (baca-saja).
			if (out.external) window.location.replace(out.target);
			else await goto(out.target, { replaceState: true });
		} catch (e: any) {
			console.error('[lacak] gagal membuka tautan pelacakan:', e);
			errorMsg = e?.message || 'Gagal membuka tautan pelacakan.';
			status = 'error';
		}
	}

	onMount(resolve);
</script>

<div class="scroll-body">
	<div class="max-w-md mx-auto p-4 pt-10 flex flex-col items-center text-center">
		{#if status === 'resolving'}
			<div class="py-6 flex justify-center">
				<CircularProgressGauge size={64} strokeWidth={5} label="Membuka dokumen..." sublabel={label || 'Mengecek tautan pelacakan'} />
			</div>
		{:else}
			<div class="rounded-xl p-6 w-full" style="background: var(--sys-fill); border: 1px solid var(--sys-sep)">
				<IconAlertTriangle size={28} style="color: var(--red); margin: 0 auto 8px" />
				<p class="text-[13px] font-semibold mb-1" style="color: var(--sys-label)">Tautan tidak dapat dibuka</p>
				<p class="text-[12px] mb-4" style="color: var(--sys-label3)">{errorMsg}</p>
				<p class="text-[11px] mb-4" style="color: var(--sys-label4)">
					Pastikan QR/tautan utuh dan berasal dari dokumen asli. Anda tetap bisa melihat posisi dokumen lewat halaman publik tanpa aksi.
				</p>
				{#if publikUrl}
					<a
						class="block w-full rounded-lg py-2.5 mb-2 text-[13px] font-semibold text-center"
						style="border: 1px solid var(--sys-sep); color: var(--sys-label)"
						href={publikUrl}
						rel="noopener noreferrer"
					>
						Lihat halaman publik
					</a>
				{/if}
				<button
					class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white flex items-center justify-center gap-2"
					style="background: var(--g)"
					onclick={() => goto('/lacak-sj')}
				>
					<IconArrowLeft size={16} /> Ke Lacak Surat Jalan
				</button>
			</div>
		{/if}
	</div>
</div>
