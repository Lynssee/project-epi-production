<script lang="ts">
	import { hasLocationConsent, grantLocationConsent } from '$lib/utils/locationConsent';
	import { IconMapPin } from '@tabler/icons-svelte';

	let { children } = $props();
	let showConsent = $state(!hasLocationConsent());

	function accept() {
		grantLocationConsent();
		showConsent = false;
	}
</script>

{#if showConsent}
	<div class="fixed inset-0 z-50 flex items-center justify-center p-4" style="background: rgba(0,0,0,0.4)">
		<div class="bg-[var(--sys-bg)] rounded-2xl max-w-sm w-full p-5 shadow-2xl border border-[var(--sys-sep)]">
			<div class="w-10 h-10 rounded-full flex items-center justify-center mb-3" style="background: var(--gl)">
				<IconMapPin size={20} style="color: var(--g)" />
			</div>
			<h2 class="text-[14px] font-bold mb-2" style="color: var(--sys-label)">Izin Lokasi</h2>
			<p class="text-[12px] mb-4" style="color: var(--sys-label3)">
				Driver App menggunakan lokasi HP Anda hanya untuk keperluan operasional armada
				(mis. checkpoint mulai/tiba trip). Lokasi diambil secara manual saat Anda menekan
				tombol tertentu — bukan dilacak terus-menerus di latar belakang.
			</p>
			<button
				class="w-full rounded-lg py-2.5 text-[13px] font-semibold text-white gradient-bg"
				onclick={accept}
			>
				Saya Mengerti, Lanjutkan
			</button>
		</div>
	</div>
{/if}

{@render children()}
