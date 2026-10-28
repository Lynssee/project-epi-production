// Tipe murni (aman dipakai klien) untuk layar Transfer Antar Gudang di kiosk. F4-C.

export interface KioskTransferItemRow {
	id: number;
	item_id: number;
	nama: string;
	satuan: string | null;
	quantity: number;
	received_quantity: number | null;
	from_rak_nama: string | null;
}

export interface KioskTransferRow {
	id: number;
	transfer_no: string;
	status: string;
	transfer_date: string | null;
	from_id: number;
	from_nama: string;
	to_id: number;
	to_nama: string;
	notes: string | null;
	rejected_reason: string | null;
	saya_pemohon: boolean;
	/** Saya PIC gudang asal → boleh setujui/tolak (draft). */
	bisa_setujui: boolean;
	/** Saya PIC gudang tujuan → boleh terima (in_transit). */
	bisa_terima: boolean;
	/** Pemohon boleh batalkan draft-nya; PIC asal boleh batalkan in_transit. */
	bisa_batal: boolean;
	items: KioskTransferItemRow[];
}
