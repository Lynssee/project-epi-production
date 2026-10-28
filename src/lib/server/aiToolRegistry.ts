// src/lib/server/aiToolRegistry.ts
// SERVER-ONLY. Kontrak tool Asisten AI untuk dashboard lapangan (project-epi).
// Fase 1 — Rencana Implementasi Asisten Eltama v2.0 §7/§13/§19.2.
//
// Bentuk (name/description/parameters/requiredPermission/group) SENGAJA
// disalin secara terkendali dari lib/server/aiToolRegistry.js di erp-epi-1 —
// itu SUMBER KEBENARAN kontrak. Pelaksananya (aiToolExecutors.ts) TIDAK
// dibagi, ditulis terpisah karena bentuk data izin di kedua repo berbeda.
//
// Grup "Inti" (§7.1): `cari_lintas_modul` membungkus runSearch() yang sudah
// ada di searchService.ts — mencakup Proyek, Work Order, Equipment, Tiket
// Maintenance, Stok Lapangan, dan Panduan modul sekaligus, dengan
// penyaringan izin yang SUDAH dibangun di runSearch() itu sendiri.
//
// Grup "Pemeliharaan" (§7.1 "Modul tumbuh bertahap"): `status_p2h` dan
// `riwayat_perbaikan` — query baru tapi grounded pada skema nyata (lihat
// komentar di aiToolExecutors.ts), digerbang izin `input_maintenance` yang
// sama dipakai searchService.ts untuk koleksi equipment/work_order.
//
// Grup "Draf" (§8 — Jalur Draf-dan-Persetujuan): `siapkan_draf_requisition`
// HANYA menyiapkan preview (resolve nama barang ke identitas_barang_id),
// TIDAK PERNAH menulis. Penulisan nyata (createRequisition + createApprovalRequest,
// sudah teruji dipakai endpoint requisition manual) hanya terjadi lewat
// POST /api/ai-assistant/draft-requisition SETELAH pengguna menekan tombol
// "Buat Draf" eksplisit di AsistenSheet — bukan otomatis dari tool call ini.
//
// Tool lain (status_proyek, rab_vs_aktual, draf_work_order, draf_tiket, dst)
// DITUNDA: masing-masing perlu eksplorasi skema tersendiri di luar cakupan
// pengerjaan ini.

export const MAX_TOOLS_PER_REQUEST = 15;

export interface ToolRegistryEntry {
	name: string;
	requiredPermission: string | string[] | null;
	group: string;
	definition: {
		type: 'function';
		function: {
			name: string;
			description: string;
			parameters: Record<string, unknown>;
		};
	};
}

export const TOOL_REGISTRY: ToolRegistryEntry[] = [
	{
		name: 'cari_dokumen_tds_msds',
		requiredPermission: null,
		group: 'rnd',
		definition: {
			type: 'function',
			function: {
				name: 'cari_dokumen_tds_msds',
				description:
					'Cari data dan status dokumen Technical Data Sheet (TDS) serta Material Safety Data Sheet (MSDS) untuk produk cat atau bahan baku (misal "OX 950", "epoxy", "hardener"). Mengembalikan kode produk, nama produk, status ketersediaan file TDS & MSDS, nomor versi, tanggal terbit & kadaluarsa, serta tautan file URL.',
				parameters: {
					type: 'object',
					properties: {
						q: { type: 'string', description: 'Kata kunci nama produk atau kode produk/item (mis. "OX 950", "epoxy primer", "hardener clear").' },
						limit: { type: 'integer', description: 'Jumlah maksimum hasil (1-10). Default 5.' }
					},
					required: ['q']
				}
			}
		}
	},
	{
		name: 'cari_lintas_modul',
		// null: izin disaring DI DALAM runSearch() sendiri (per-koleksi, dari
		// permissions user) — bukan digerbang di sini. Lihat aiToolExecutors.ts.
		requiredPermission: null,
		group: 'inti',
		definition: {
			type: 'function',
			function: {
				name: 'cari_lintas_modul',
				description:
					'Cari data lintas modul dashboard lapangan: Proyek, Work Order, Equipment, Tiket Maintenance, Stok/Sparepart lapangan, dan Panduan cara pakai aplikasi. Gunakan untuk pertanyaan seperti status proyek, cari nomor WO, cek stok sparepart, atau "bagaimana cara...".',
				parameters: {
					type: 'object',
					properties: {
						q: { type: 'string', description: 'Kata kunci pencarian, mis. nomor WO, nama proyek, atau nama sparepart.' }
					},
					required: ['q']
				}
			}
		}
	},
	{
		name: 'status_p2h',
		requiredPermission: 'input_maintenance',
		group: 'pemeliharaan',
		definition: {
			type: 'function',
			function: {
				name: 'status_p2h',
				description: 'Cek hasil P2H (pemeriksaan sebelum pemakaian) TERAKHIR untuk satu equipment/alat tertentu: tanggal, hasil (Go/No-Go), dan keterangan.',
				parameters: {
					type: 'object',
					properties: {
						equipment: { type: 'string', description: 'Nama atau kode equipment/alat.' }
					},
					required: ['equipment']
				}
			}
		}
	},
	{
		name: 'riwayat_perbaikan',
		requiredPermission: 'input_maintenance',
		group: 'pemeliharaan',
		definition: {
			type: 'function',
			function: {
				name: 'riwayat_perbaikan',
				description: 'Cari riwayat Work Order (perbaikan) untuk satu equipment/alat tertentu: nomor WO, status, keluhan, dan tanggal.',
				parameters: {
					type: 'object',
					properties: {
						equipment: { type: 'string', description: 'Nama atau kode equipment/alat.' },
						limit: { type: 'integer', description: 'Jumlah maksimum hasil (1-10). Default 5.' }
					},
					required: ['equipment']
				}
			}
		}
	},
	{
		name: 'siapkan_draf_requisition',
		requiredPermission: null,
		group: 'draf',
		definition: {
			type: 'function',
			function: {
				name: 'siapkan_draf_requisition',
				description:
					'Siapkan PRATINJAU pengajuan barang internal (requisition) untuk departemen sendiri. HANYA menyiapkan pratinjau — TIDAK membuat data apa pun. Pengguna akan melihat kartu konfirmasi dan harus menekan "Buat Draf" sendiri.',
				parameters: {
					type: 'object',
					properties: {
						item: { type: 'string', description: 'Nama barang yang diajukan.' },
						quantity: { type: 'number', description: 'Jumlah yang diajukan.' },
						keterangan: { type: 'string', description: 'Keperluan/alasan pengajuan (opsional).' }
					},
					required: ['item', 'quantity']
				}
			}
		}
	},
	{
		// 5B#1 (implementation_plan_asisten_ai_v2.md) — "killer feature" lapangan:
		// foto kerusakan alat → draf tiket maintenance. Menumpang Fase 1 Attachment
		// (gambar sudah dilihat model lewat content part image_url pada giliran yang
		// sama) — tool ini HANYA menyiapkan preview, sama seperti siapkan_draf_requisition.
		// Penulisan nyata (work_order quick-create, pola sama dengan auto-WO P2H di
		// preventive/p2h/submit/+server.ts) lewat POST /api/ai-assistant/draft-maintenance-ticket
		// setelah pengguna menekan "Buat Tiket".
		//
		// 5B#3 (Draf WO dari chat) SENGAJA TIDAK jadi tool terpisah — foto opsional
		// di sini sejak awal (parameter tool tidak pernah mewajibkannya), jadi tool
		// yang sama sudah menutupi "draf WO murni dari teks" tanpa duplikasi jalur
		// tulis work_order. Deskripsi & system prompt digeneralisasi (bukan cuma
		// dipicu foto) supaya model juga memanggilnya dari permintaan teks biasa.
		name: 'siapkan_draf_tiket_maintenance',
		requiredPermission: null,
		group: 'draf',
		definition: {
			type: 'function',
			function: {
				name: 'siapkan_draf_tiket_maintenance',
				description:
					'Siapkan PRATINJAU tiket/Work Order maintenance untuk satu equipment/alat — dari foto kerusakan yang diunggah, DAN/ATAU dari deskripsi teks pengguna saja (foto opsional, tidak wajib). Gunakan setiap kali pengguna melaporkan kerusakan atau minta dibuatkan WO/tiket, dengan atau tanpa foto. HANYA menyiapkan pratinjau — TIDAK membuat data apa pun. Bila ada foto, deskripsikan dulu apa yang terlihat (jenis kerusakan) sebelum memanggil tool ini, lalu isi "keluhan" dari deskripsi itu.',
				parameters: {
					type: 'object',
					properties: {
						equipment: { type: 'string', description: 'Nama atau kode equipment/alat yang rusak.' },
						keluhan: { type: 'string', description: 'Deskripsi kerusakan (dari analisis foto dan/atau kata-kata pengguna).' },
						urgency: {
							type: 'string',
							enum: ['minor', 'darurat'],
							description: 'Tingkat urgensi. "darurat" hanya bila kerusakan jelas berbahaya/menghentikan operasi total. Default "minor".'
						}
					},
					required: ['equipment', 'keluhan']
				}
			}
		}
	},
	{
		name: 'cek_jadwal_pm',
		requiredPermission: 'input_preventive',
		group: 'pemeliharaan',
		definition: {
			type: 'function',
			function: {
				name: 'cek_jadwal_pm',
				description: 'Cek jadwal Preventive Maintenance (PM) untuk satu equipment/alat tertentu: daftar tugas PM, tanggal jatuh tempo, dan status (termasuk yang sudah terlambat).',
				parameters: {
					type: 'object',
					properties: {
						equipment: { type: 'string', description: 'Nama atau kode equipment/alat.' }
					},
					required: ['equipment']
				}
			}
		}
	},
	{
		name: 'cek_status_requisition',
		requiredPermission: 'access_requisition',
		group: 'requisition',
		definition: {
			type: 'function',
			function: {
				name: 'cek_status_requisition',
				description: 'Cek status pengajuan barang internal (requisition) milik pengguna sendiri. Bisa difilter dengan kata kunci nomor pengajuan, atau kosongkan untuk daftar terbaru.',
				parameters: {
					type: 'object',
					properties: {
						q: { type: 'string', description: 'Kata kunci nomor pengajuan (opsional).' }
					}
				}
			}
		}
	},
	{
		// Fase 3 — implementation_plan_ai_pertajam.md: tool expansion lapangan.
		// Digerbang sama seperti sumber 'projects' di searchService.ts, project-scoping
		// nyata dilakukan di executor lewat ctx.projectIds (pola sama status_p2h dkk).
		name: 'cek_stok_proyek',
		requiredPermission: ['view_all_projects', 'view_own_projects'],
		group: 'inventory',
		definition: {
			type: 'function',
			function: {
				name: 'cek_stok_proyek',
				description: 'Cek stok material/sparepart di proyek tertentu (bukan stok gudang pusat): qty diterima, qty terpakai, qty tersisa (on hand), dan status (normal/rendah/kritis/lebih dari RAB).',
				parameters: {
					type: 'object',
					properties: {
						proyek: { type: 'string', description: 'Nama atau kode proyek.' },
						item: { type: 'string', description: 'Nama barang/material (opsional — kosongkan untuk semua item proyek ini).' }
					},
					required: ['proyek']
				}
			}
		}
	},
	{
		name: 'cek_surat_jalan',
		requiredPermission: ['view_all_projects', 'view_own_projects'],
		group: 'logistik',
		definition: {
			type: 'function',
			function: {
				name: 'cek_surat_jalan',
				description: 'Cek status Surat Jalan (SJ) terkait proyek tertentu: nomor SJ, status, driver, tujuan, dan apakah sudah diterima/di-GR.',
				parameters: {
					type: 'object',
					properties: {
						proyek: { type: 'string', description: 'Nama atau kode proyek.' },
						limit: { type: 'integer', description: 'Jumlah maksimum hasil (1-10). Default 5.' }
					},
					required: ['proyek']
				}
			}
		}
	},
	{
		// Self-scoped via resolveKaryawanByEmail(ctx.userEmail) di executor — sama
		// seperti cek_status_requisition — jadi TIDAK butuh requiredPermission khusus.
		name: 'cek_absensi_saya',
		requiredPermission: null,
		group: 'ess',
		definition: {
			type: 'function',
			function: {
				name: 'cek_absensi_saya',
				description: 'Cek rekap kehadiran (absensi) SAYA SENDIRI bulan ini: tanggal, status, jam masuk/pulang.',
				parameters: { type: 'object', properties: {} }
			}
		}
	},
	{
		name: 'cek_saldo_cuti_saya',
		requiredPermission: null,
		group: 'ess',
		definition: {
			type: 'function',
			function: {
				name: 'cek_saldo_cuti_saya',
				description: 'Cek saldo cuti SAYA SENDIRI: total jatah cuti, terpakai, dan sisa. Juga menampilkan pengajuan cuti terbaru beserta statusnya.',
				parameters: { type: 'object', properties: {} }
			}
		}
	}
];

/** Pilih tool (format OpenAI function-calling) yang boleh dikirim ke model. */
export function selectToolsForUser(permissions: string[]) {
	const allowed = TOOL_REGISTRY.filter(
		(t) => t.requiredPermission == null || hasAnyPermission(permissions || [], t.requiredPermission)
	);
	return allowed.slice(0, MAX_TOOLS_PER_REQUEST).map((t) => t.definition);
}

function hasAnyPermission(permissions: string[], required: string | string[]): boolean {
	if (permissions.includes('*')) return true;
	const list = Array.isArray(required) ? required : [required];
	return list.some((p) => permissions.includes(p));
}
