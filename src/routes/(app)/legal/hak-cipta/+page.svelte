<!-- src/routes/(app)/legal/hak-cipta/+page.svelte -->
<script lang="ts">
	const tahun = new Date().getFullYear();
</script>

<svelte:head>
	<title>Hak Cipta & Legal — SI-TAMA Lapangan</title>
</svelte:head>

<div class="max-w-4xl mx-auto px-4 py-8">
	<div class="mb-6">
		<h1 class="text-xl md:text-2xl font-black tracking-tight" style="color: var(--sys-label)">
			Hak Cipta &amp; Legal
		</h1>
		<p class="text-xs md:text-sm mt-1" style="color: var(--sys-label3)">
			SI-TAMA — Sistem Informasi Eltama Lapangan
		</p>
	</div>

	<div
		class="rounded-2xl p-6 md:p-8 space-y-6 text-sm leading-relaxed"
		style="background: var(--sys-bg2); border: 1px solid var(--sys-sep); color: var(--sys-label2)"
	>
		<section>
			<p>
				Aplikasi SI-TAMA Operational Dashboard beserta seluruh source code, basis data, desain antarmuka, dokumentasi,
				alur kerja, dan materi di dalamnya (&ldquo;Aplikasi&rdquo;) adalah milik dan hak cipta penuh
				<strong style="color: var(--sys-label)"> PT. Eltama Prima Indo</strong>.
			</p>
			<p class="mt-2 font-semibold" style="color: var(--sys-label)">
				&copy; {tahun} PT. Eltama Prima Indo. Seluruh hak cipta dilindungi undang-undang.
			</p>
		</section>

		<section>
			<h2 class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label4)">Dasar Hukum</h2>
			<p>
				Perlindungan hak cipta atas Aplikasi ini tunduk pada Undang-Undang Republik Indonesia
				Nomor 28 Tahun 2014 tentang Hak Cipta, di mana Program Komputer merupakan salah satu
				jenis Ciptaan yang dilindungi. Hak cipta timbul secara otomatis sejak Aplikasi
				diwujudkan dalam bentuk nyata, tanpa memerlukan pendaftaran formal.
			</p>
		</section>

		<section>
			<h2 class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label4)">Kepemilikan</h2>
			<p>
				Aplikasi ini dikembangkan oleh dan/atau untuk kepentingan PT. Eltama Prima Indo.
				Seluruh hak kekayaan intelektual atas Aplikasi — termasuk namun tidak terbatas pada
				source code, struktur basis data, logo, dan tampilan antarmuka — adalah milik penuh
				PT. Eltama Prima Indo, terlepas dari pihak yang menuliskan kodenya.
			</p>
		</section>

		<section>
			<h2 class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label4)">Larangan</h2>
			<p>Tanpa izin tertulis dari PT. Eltama Prima Indo, dilarang keras untuk:</p>
			<ul class="list-disc list-inside mt-2 space-y-1" style="color: var(--sys-label3)">
				<li>Menyalin, mendistribusikan, atau memperbanyak Aplikasi maupun bagian-bagiannya;</li>
				<li>Melakukan reverse-engineering, dekompilasi, atau ekstraksi source code;</li>
				<li>Menggunakan Aplikasi di luar keperluan operasional resmi PT. Eltama Prima Indo;</li>
				<li>Membagikan kredensial akses kepada pihak luar yang tidak berwenang;</li>
				<li>Mengklaim kepemilikan atau menyerahkan hak atas Aplikasi kepada pihak ketiga.</li>
			</ul>
		</section>

		<section>
			<h2 class="text-xs font-bold uppercase tracking-wider mb-2" style="color: var(--sys-label4)">Sanksi Pelanggaran</h2>
			<p>
				Pelanggaran terhadap hak cipta ini dapat dikenakan sanksi perdata berupa tuntutan
				ganti rugi maupun sanksi pidana sesuai ketentuan peraturan perundang-undangan
				yang berlaku di Republik Indonesia.
			</p>
		</section>

		<section class="pt-4 border-t" style="border-color: var(--sys-sep)">
			<p class="text-xs" style="color: var(--sys-label4)">
				Pertanyaan mengenai hak cipta, lisensi, atau izin penggunaan dapat diajukan secara resmi
				ke manajemen PT. Eltama Prima Indo.
			</p>
		</section>
	</div>
</div>
