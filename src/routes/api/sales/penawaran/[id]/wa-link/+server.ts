// src/routes/api/sales/penawaran/[id]/wa-link/+server.ts
// SI-TAMA Sales §5a — buat link WhatsApp berisi pesan penawaran.
// Auth Firebase biasa (requireUser). Nomor WA diambil dari omni_contacts.phone
// (bila penawaran berasal dari Omnichannel) atau master_customer, lalu dinormalisasi
// ke format 62xxx. Bila nomor tidak ditemukan, wa_number/wa_link = null supaya
// frontend menampilkan modal input nomor manual.

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/firebaseAuth';
import { directusServerJson } from '$lib/server/directus';
import { fetchPenawaran, normalizeWaNumber, buildWaMessage } from '$lib/server/penawaranExport';

export const GET: RequestHandler = async (event) => {
	await requireUser(event);

	const id = event.params.id;
	if (!id) throw error(400, 'ID penawaran wajib.');

	const data = await fetchPenawaran(id);
	if (!data) throw error(404, 'Penawaran tidak ditemukan.');

	const { header } = data;
	const message = buildWaMessage(header);

	let rawPhone: string | null = null;
	let phoneSource: 'omni_contacts' | 'master_customer' | null = null;

	if (header.omni_contact_id) {
		try {
			const res = await directusServerJson<{ data: { phone: string | null } }>(
				`/items/omni_contacts/${header.omni_contact_id}?fields=phone`
			);
			if (res?.data?.phone) {
				rawPhone = res.data.phone;
				phoneSource = 'omni_contacts';
			}
		} catch (e) {
			console.warn('[penawaran/wa-link] gagal baca omni_contacts:', (e as Error).message);
		}
	}

	if (!rawPhone && header.customer_id) {
		try {
			const res = await directusServerJson<{ data: { telp: string | null } }>(
				`/items/master_customer/${header.customer_id}?fields=telp`
			);
			if (res?.data?.telp) {
				rawPhone = res.data.telp;
				phoneSource = 'master_customer';
			}
		} catch (e) {
			console.warn('[penawaran/wa-link] gagal baca master_customer:', (e as Error).message);
		}
	}

	const waNumber = normalizeWaNumber(rawPhone);
	const waLink = waNumber ? `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}` : null;

	return json({
		wa_number: waNumber,
		wa_link: waLink,
		message,
		phone_source: waNumber ? phoneSource : null
	});
};
