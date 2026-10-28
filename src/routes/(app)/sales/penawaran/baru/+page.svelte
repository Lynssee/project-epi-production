<script lang="ts">
	import { goto } from '$app/navigation';
	import { authStore } from '$lib/stores/auth';
	import { rolesStore } from '$lib/stores/roles';
	import { hasPermission } from '$lib/constants/permissions';
	import PenawaranEditor from '$lib/components/sales/PenawaranEditor.svelte';
	import { IconArrowLeft } from '@tabler/icons-svelte';

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
		<h1 class="text-[16px] font-bold mb-4" style="color: var(--sys-label)">Penawaran Baru</h1>

		<PenawaranEditor penawaranId={null} />
	</div>
</div>
