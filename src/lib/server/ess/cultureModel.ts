// Dipindah ke $lib/utils agar bisa dipakai klien (folder $lib/server tidak boleh diimpor browser). Shim agar impor lama tetap jalan.
export * from '$lib/utils/cultureModel';
