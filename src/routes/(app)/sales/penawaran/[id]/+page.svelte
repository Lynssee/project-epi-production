<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import PenawaranEditor from '$lib/components/sales/PenawaranEditor.svelte';
	import { IconArrowLeft } from '@tabler/icons-svelte';

	let penawaranId = $derived($page.params.id as string);

	$effect(() => {
		const roleId = $authStore.roleId;
		const checked = $authStore.checked;
		const roles = $rolesStore;
		if (checked && roles.length > 0 && !hasPermission(roleId, 'input_sales', roles, $authStore.roleIds)) {
			goto('/');
		}
	});
</script>

<div class="scroll-body">
	<div class="max-w-2xl mx-auto p-4 pb-24">
		<button class="flex items-center gap-1.5 text-[12px] font-medium mb-3" style="color: var(--sys-label3)" onclick={() => goto('/sales/penawaran')}>
			<IconArrowLeft size={15} /> Kembali
		</button>
		<h1 class="text-[16px] font-bold mb-4" style="color: var(--sys-label)">Edit Penawaran</h1>

		{#key penawaranId}
			<PenawaranEditor {penawaranId} />
		{/key}
	</div>
</div>
