<!-- Stub penampil PDF khusus tes DOM (jsdom tidak punya URL.createObjectURL). Tidak dipakai di aplikasi. -->
<script lang="ts">
	let { title = '' }: { src?: unknown; title?: string; show?: boolean; onClose?: () => void } = $props();
</script>

<div data-testid="pdf-viewer-stub">{title}</div>
