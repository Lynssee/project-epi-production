<script lang="ts">
	import { goto } from '$app/navigation';
	import { IconArrowLeft, IconDeviceFloppy } from '@tabler/icons-svelte';
	import { authStore, getUserDisplay } from '$lib/stores/auth';
	import { get } from 'svelte/store';
	import directus from '$lib/services/directus';
	import { createItem } from '@directus/sdk';

	let submitting = $state(false);
	let userName = $state('LEADER');
	
	let reportData = $state({
		date: new Date(Date.now() - (new Date()).getTimezoneOffset() * 60000).toISOString().split('T')[0],
		weather: 'Cerah',
		lokasi_hari_ini: '',
		rencana_lokasi_besok: '',
		catatan_umum: '',
		kendala: ''
	});

	const unsubAuth = authStore.subscribe((s) => {
		if (s.user) userName = getUserDisplay(s.user);
	});

	async function submitGeneralReport() {
		try {
			if (!reportData.lokasi_hari_ini) {
				alert('Lokasi hari ini wajib diisi');
				return;
			}
			submitting = true;
			
			await directus.request(createItem('daily_general_reports', {
				date: reportData.date,
				leader_name: userName,
				karyawan_id: get(authStore).karyawanId || null,
				lokasi_hari_ini: reportData.lokasi_hari_ini,
				rencana_lokasi_besok: reportData.rencana_lokasi_besok,
				cuaca: reportData.weather,
				catatan: reportData.catatan_umum,
				kendala: reportData.kendala
			}));

			alert('Laporan General Harian berhasil dikirim!');
			goto('/laporan');
		} catch (e: any) {
			console.error(e);
			alert('Gagal mengirim laporan. Coba lagi beberapa saat lagi.');
		} finally {
			submitting = false;
		}
	}
</script>

<div class="flex flex-col h-full bg-[var(--sys-bg)] pb-24">
	<!-- Top App Bar -->
	<div class="top-app-bar" style="background: var(--sys-bg); border-bottom: 1px solid var(--sys-sep)">
		<button class="tbb" onclick={() => goto('/laporan')}><IconArrowLeft size={20} /></button>
		<h1>Daily General Report</h1>
		<button class="tbb"></button>
	</div>

	<div class="scroll-body p-4 max-w-2xl mx-auto w-full">
		<div class="bg-white p-4 rounded-xl shadow-sm border border-[var(--sys-sep)] flex flex-col gap-4">
			
			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<label class="f-label">Tanggal <span style="color: var(--re)">*</span></label>
					<input type="date" bind:value={reportData.date} class="f-input" required />
				</div>
				<div>
					<label class="f-label">Cuaca <span style="color: var(--re)">*</span></label>
					<select bind:value={reportData.weather} class="f-select" required>
						<option value="Cerah">Cerah</option>
						<option value="Berawan">Berawan</option>
						<option value="Gerimis">Gerimis</option>
						<option value="Hujan">Hujan</option>
						<option value="Hujan Deras">Hujan Deras</option>
					</select>
				</div>
			</div>

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				<div>
					<label class="f-label">Lokasi Hari Ini <span style="color: var(--re)">*</span></label>
					<input type="text" bind:value={reportData.lokasi_hari_ini} class="f-input" placeholder="Posisi Anda hari ini" required />
				</div>
				<div>
					<label class="f-label">Rencana Lokasi Besok <span style="color: var(--re)">*</span></label>
					<input type="text" bind:value={reportData.rencana_lokasi_besok} class="f-input" placeholder="Rencana tujuan besok" required />
				</div>
			</div>

			<div>
				<label class="f-label">Kendala (Jika ada)</label>
				<textarea bind:value={reportData.kendala} class="f-textarea" placeholder="Tuliskan kendala hari ini" style="height: 80px"></textarea>
			</div>
			
			<div>
				<label class="f-label">Catatan Umum</label>
				<textarea bind:value={reportData.catatan_umum} class="f-textarea" placeholder="Aktivitas atau catatan lainnya" style="height: 80px"></textarea>
			</div>

			<div class="mt-4 pt-4 border-t border-[var(--sys-sep)]">
				<p class="text-[12px] text-[var(--sys-label4)] mb-2">Report By: <strong>{userName}</strong></p>
			</div>
		</div>
	</div>

	<!-- Bottom Action -->
	<div class="fixed bottom-0 left-0 right-0 p-4 bg-white border-t border-[var(--sys-sep)] z-10 flex gap-3 lg:left-64 lg:w-[calc(100%-256px)]">
		<button 
			class="btn flex-1 flex items-center justify-center gap-2 font-bold py-3 text-[14px]" 
			style="background: var(--b); color: white;" 
			onclick={submitGeneralReport} 
			disabled={submitting}
		>
			<IconDeviceFloppy size={18} />
			{submitting ? 'Menyimpan...' : 'Kirim Laporan'}
		</button>
	</div>
</div>
