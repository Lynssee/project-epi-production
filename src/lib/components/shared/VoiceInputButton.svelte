<script lang="ts">
	// Fase 5 (rencana "Package & Fitur Addons" §3/§5) — isi field teks pakai suara.
	// Web Speech API murni, nol package baru. Berguna saat tangan kotor di lapangan
	// (mekanik, satpam) atau saat mengetik lambat di HP.
	//
	// Dukungan browser: hanya Chrome/Android WebView (webkitSpeechRecognition) yang
	// benar-benar reliable di lapangan — tombol disembunyikan total kalau API tidak ada,
	// BUKAN ditampilkan lalu gagal saat diklik.

	import IconMicrophone from '@tabler/icons-svelte/icons/microphone';
	import IconMicrophoneOff from '@tabler/icons-svelte/icons/microphone-off';

	let { onResult, lang = 'id-ID' }: { onResult: (text: string) => void; lang?: string } = $props();

	let listening = $state(false);
	let errorMsg = $state('');
	let recognition: any = null;

	const SpeechRecognitionCtor =
		typeof window !== 'undefined' ? (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition : null;
	const supported = !!SpeechRecognitionCtor;

	function stop() {
		recognition?.stop();
		listening = false;
	}

	function start() {
		errorMsg = '';
		const rec = new SpeechRecognitionCtor();
		rec.lang = lang;
		rec.interimResults = false;
		rec.maxAlternatives = 1;
		rec.onresult = (e: any) => {
			const text = e.results?.[0]?.[0]?.transcript?.trim();
			if (text) onResult(text);
		};
		rec.onerror = (e: any) => {
			listening = false;
			// 'no-speech'/'aborted' bukan kegagalan nyata — pengguna sengaja berhenti/diam.
			if (e?.error && e.error !== 'no-speech' && e.error !== 'aborted') {
				errorMsg = 'Gagal merekam suara. Coba lagi.';
			}
		};
		rec.onend = () => {
			listening = false;
		};
		recognition = rec;
		listening = true;
		rec.start();
	}

	function toggle() {
		if (listening) stop();
		else start();
	}
</script>

{#if supported}
	<button
		type="button"
		class="voice-btn {listening ? 'voice-btn--active' : ''}"
		onclick={toggle}
		title={listening ? 'Berhenti merekam' : 'Isi dengan suara'}
		aria-label={listening ? 'Berhenti merekam' : 'Isi dengan suara'}
	>
		{#if listening}
			<IconMicrophoneOff size={16} />
		{:else}
			<IconMicrophone size={16} />
		{/if}
	</button>
	{#if errorMsg}
		<span class="voice-error">{errorMsg}</span>
	{/if}
{/if}

<style>
	.voice-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 9999px;
		border: 1px solid var(--sys-sep, #e5e7eb);
		background: var(--sys-fill, #f3f4f6);
		color: var(--sys-label2, #4b5563);
		flex-shrink: 0;
	}
	.voice-btn--active {
		background: #dc2626;
		border-color: #dc2626;
		color: white;
		animation: voice-pulse 1.2s ease-in-out infinite;
	}
	.voice-error {
		font-size: 11px;
		color: #dc2626;
	}
	@keyframes voice-pulse {
		0%, 100% { opacity: 1; }
		50% { opacity: 0.6; }
	}
</style>
