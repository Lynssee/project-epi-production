import directus, { handleDirectusError } from './directus';
import { readItems, readItem, createItem, updateItem } from '@directus/sdk';
import { createProspect, createFollowUp } from './sales';

export type ChannelType = 'WhatsApp' | 'Instagram' | 'Messenger' | 'Webchat';

export interface OmnichannelContact {
	id: number | string;
	name: string;
	channel: ChannelType;
	phone: string;
	email?: string | null;
	identifier?: string;
	customer_id?: number | null;
	prospect_id?: number | null;
	tags?: string | null;
	notes?: string | null;
	last_seen?: string | null;
	createdAt?: string | null;
	// Relasi yang di-enrich
	last_message_preview?: string | null;
	last_message_at?: string | null;
	unread_count?: number;
	conversation_id?: number | null;
}

export interface OmnichannelMessage {
	id: number;
	conversation_id: number;
	direction: 'in' | 'out';
	sender_name: string | null;
	text: string | null;
	timestamp: string | null;
	content_type: string | null;
}

const PAGE_SIZE = 20;

function mapChannelType(raw: string | null | undefined): ChannelType {
	const c = (raw || '').toLowerCase();
	if (c.includes('wa') || c.includes('whatsapp')) return 'WhatsApp';
	if (c.includes('ig') || c.includes('instagram')) return 'Instagram';
	if (c.includes('mess') || c.includes('messenger')) return 'Messenger';
	return 'Webchat';
}

function normalizePhone(raw: string | null | undefined): string {
	if (!raw) return '';
	let p = raw.replace(/[^0-9]/g, '');
	if (p.startsWith('0')) p = '62' + p.slice(1);
	return p;
}

export interface ContactPage {
	contacts: OmnichannelContact[];
	hasMore: boolean;
	total: number;
}

/**
 * Mengambil daftar kontak omnichannel dari Directus (omni_contacts)
 */
export async function fetchContacts(page = 1, search = '', channelFilter?: string): Promise<ContactPage> {
	try {
		const offset = (page - 1) * PAGE_SIZE;
		const filter: any = {};

		if (search.trim()) {
			const s = search.trim();
			filter._or = [
				{ name: { _icontains: s } },
				{ phone: { _icontains: s } },
				{ email: { _icontains: s } }
			];
		}

		if (channelFilter && channelFilter !== 'all') {
			filter.channel_type = { _icontains: channelFilter.toLowerCase() };
		}

		const rows = (await directus.request(
			readItems('omni_contacts', {
				filter,
				fields: [
					'id',
					'name',
					'channel_type',
					'external_id',
					'phone',
					'email',
					'customer_id',
					'prospect_id',
					'tags',
					'notes',
					'last_seen',
					'date_created'
				],
				sort: ['-date_created'],
				limit: PAGE_SIZE + 1,
				offset
			})
		)) as any[];

		const hasMore = rows.length > PAGE_SIZE;
		const sliced = hasMore ? rows.slice(0, PAGE_SIZE) : rows;

		if (sliced.length > 0) {
			const contactIds = sliced.map((c) => c.id).filter(Boolean);
			let convMap = new Map<number, any>();

			// Separated relation fetching: ambil percakapan terakhir terkait kontak
			try {
				const convs = (await directus.request(
					readItems('omni_conversations', {
						filter: { contact_id: { _in: contactIds } },
						fields: ['id', 'contact_id', 'last_message_preview', 'last_message_at', 'unread_count'],
						sort: ['-last_message_at'],
						limit: -1
					})
				)) as any[];
				for (const conv of convs) {
					if (conv.contact_id && !convMap.has(conv.contact_id)) {
						convMap.set(conv.contact_id, conv);
					}
				}
			} catch (convErr) {
				console.warn('[omnichannel] conv fetch error (ignored):', convErr);
			}

			const contacts: OmnichannelContact[] = sliced.map((r) => {
				const conv = convMap.get(r.id);
				return {
					id: r.id,
					name: r.name || r.phone || `Kontak #${r.id}`,
					channel: mapChannelType(r.channel_type),
					phone: r.phone || '',
					email: r.email || null,
					identifier: r.external_id || r.phone || String(r.id),
					customer_id: r.customer_id || null,
					prospect_id: r.prospect_id || null,
					tags: r.tags || null,
					notes: r.notes || null,
					last_seen: r.last_seen || r.date_created || null,
					createdAt: r.date_created || null,
					last_message_preview: conv?.last_message_preview || null,
					last_message_at: conv?.last_message_at || null,
					unread_count: conv?.unread_count || 0,
					conversation_id: conv?.id || null
				};
			});

			return {
				contacts,
				hasMore,
				total: contacts.length
			};
		}
	} catch (error) {
		console.warn('[omnichannel] fetchContacts directus warning:', error);
	}

	return {
		contacts: [],
		hasMore: false,
		total: 0
	};
}

/**
 * Mengambil daftar calon Lead Inbound dari Omnichannel untuk ditarik ke Pipeline Prospek.
 * Dapat memfilter yang belum ditautkan ke prospek (unlinkedOnly = true).
 */
export async function getOmniInboundLeads(opts: {
	search?: string;
	unlinkedOnly?: boolean;
	limit?: number;
} = {}): Promise<OmnichannelContact[]> {
	try {
		const filter: any = {};
		if (opts.unlinkedOnly) {
			filter.prospect_id = { _null: true };
		}
		if (opts.search?.trim()) {
			const s = opts.search.trim();
			filter._or = [
				{ name: { _icontains: s } },
				{ phone: { _icontains: s } },
				{ notes: { _icontains: s } }
			];
		}

		const rows = (await directus.request(
			readItems('omni_contacts', {
				filter,
				fields: [
					'id',
					'name',
					'channel_type',
					'external_id',
					'phone',
					'email',
					'customer_id',
					'prospect_id',
					'tags',
					'notes',
					'last_seen',
					'date_created'
				],
				sort: ['-date_created'],
				limit: opts.limit || 50
			})
		)) as any[];

		if (rows.length === 0) return [];

		// Separated relation fetching for conversations
		const contactIds = rows.map((r) => r.id).filter(Boolean);
		let convMap = new Map<number, any>();
		try {
			const convs = (await directus.request(
				readItems('omni_conversations', {
					filter: { contact_id: { _in: contactIds } },
					fields: ['id', 'contact_id', 'last_message_preview', 'last_message_at', 'unread_count'],
					sort: ['-last_message_at'],
					limit: -1
				})
			)) as any[];
			for (const conv of convs) {
				if (conv.contact_id && !convMap.has(conv.contact_id)) {
					convMap.set(conv.contact_id, conv);
				}
			}
		} catch {}

		return rows.map((r) => {
			const conv = convMap.get(r.id);
			return {
				id: r.id,
				name: r.name || r.phone || `Inbound Lead #${r.id}`,
				channel: mapChannelType(r.channel_type),
				phone: r.phone || '',
				email: r.email || null,
				identifier: r.external_id || r.phone || String(r.id),
				customer_id: r.customer_id || null,
				prospect_id: r.prospect_id || null,
				tags: r.tags || null,
				notes: r.notes || null,
				last_seen: r.last_seen || r.date_created || null,
				createdAt: r.date_created || null,
				last_message_preview: conv?.last_message_preview || null,
				last_message_at: conv?.last_message_at || null,
				unread_count: conv?.unread_count || 0,
				conversation_id: conv?.id || null
			};
		});
	} catch (error) {
		console.warn('[omnichannel] getOmniInboundLeads error:', error);
		return [];
	}
}

/**
 * Konversi kontak Omnichannel menjadi Lead CRM Pipeline Prospek.
 * 1. Membuat record baru di `prospects`
 * 2. Menghubungkan `omni_contacts.prospect_id = prospect.id`
 * 3. Menambahkan log follow-up awal otomatis
 */
export async function convertOmniContactToLead(
	contactId: number | string,
	leadData: {
		name: string;
		company?: string;
		phone: string;
		email?: string;
		notes?: string;
		assignedName: string;
		priority?: 'low' | 'medium' | 'high';
		quotedAmount?: number | null;
		expectedClose?: string | null;
		channelType?: string;
	}
) {
	const ch = leadData.channelType || 'WhatsApp';
	const notes = (leadData.notes || '').trim();
	const initialNotes = notes ? `[Inbound ${ch}] ${notes}` : `[Inbound ${ch}] Dikonversi dari percakapan ${ch} omnichannel`;

	// 1. Buat prospek baru
	const prospect = await createProspect({
		name: leadData.name,
		company: leadData.company || leadData.name,
		phone: leadData.phone,
		email: leadData.email || '',
		notes: initialNotes,
		assignedName: leadData.assignedName,
		priority: leadData.priority || 'medium',
		quotedAmount: leadData.quotedAmount || null,
		expectedClose: leadData.expectedClose || null
	});

	// 2. Tautkan omni_contacts ke prospect.id
	try {
		if (typeof contactId === 'number' || !isNaN(Number(contactId))) {
			await directus.request(
				updateItem('omni_contacts', Number(contactId), {
					prospect_id: prospect.id,
					tags: `crm_lead,${ch.toLowerCase()}`
				})
			);
		}
	} catch (linkErr) {
		console.warn('[omnichannel] gagal update omni_contacts.prospect_id:', linkErr);
	}

	// 3. Rekam follow-up awal otomatis
	try {
		await createFollowUp({
			prospectId: prospect.id,
			type: ch.toLowerCase() === 'whatsapp' ? 'whatsapp' : 'other',
			notes: `Inbound chat diterima via ${ch}. Kontak diimpor ke CRM Pipeline oleh ${leadData.assignedName}.`,
			nextFollowUp: null,
			result: 'Lead Terhubung dari Omnichannel'
		});
	} catch {}

	return prospect;
}

/**
 * Ambil riwayat chat / pesan percakapan omnichannel untuk ditampilkan di detail prospek.
 */
export async function getProspectOmniChat(params: {
	phone?: string | null;
	prospectId?: number | null;
	contactId?: number | null;
}): Promise<{
	contact: OmnichannelContact | null;
	messages: OmnichannelMessage[];
	conversationId: number | null;
}> {
	try {
		let contact: any = null;

		if (params.contactId) {
			contact = await directus.request(
				readItem('omni_contacts', params.contactId, {
					fields: ['id', 'name', 'phone', 'channel_type', 'notes', 'date_created']
				})
			);
		} else if (params.prospectId) {
			const found = (await directus.request(
				readItems('omni_contacts', {
					filter: { prospect_id: { _eq: params.prospectId } },
					fields: ['id', 'name', 'phone', 'channel_type', 'notes', 'date_created'],
					limit: 1
				})
			)) as any[];
			if (found.length > 0) contact = found[0];
		}

		if (!contact && params.phone) {
			const rawPhone = normalizePhone(params.phone);
			if (rawPhone) {
				const found = (await directus.request(
					readItems('omni_contacts', {
						filter: { phone: { _icontains: rawPhone.slice(-9) } },
						fields: ['id', 'name', 'phone', 'channel_type', 'notes', 'date_created'],
						limit: 1
					})
				)) as any[];
				if (found.length > 0) contact = found[0];
			}
		}

		if (!contact) {
			return { contact: null, messages: [], conversationId: null };
		}

		// Cari percakapan terkait kontak ini
		const convs = (await directus.request(
			readItems('omni_conversations', {
				filter: { contact_id: { _eq: contact.id } },
				fields: ['id', 'channel_type', 'last_message_preview', 'last_message_at'],
				sort: ['-last_message_at'],
				limit: 1
			})
		)) as any[];

		const conversationId = convs.length > 0 ? convs[0].id : null;
		let messages: OmnichannelMessage[] = [];

		if (conversationId) {
			messages = (await directus.request(
				readItems('omni_messages', {
					filter: { conversation_id: { _eq: conversationId } },
					fields: ['id', 'conversation_id', 'direction', 'sender_name', 'text', 'timestamp', 'content_type'],
					sort: ['timestamp', 'date_created'],
					limit: 50
				})
			)) as OmnichannelMessage[];
		}

		return {
			contact: {
				id: contact.id,
				name: contact.name || contact.phone,
				channel: mapChannelType(contact.channel_type),
				phone: contact.phone,
				identifier: contact.phone || String(contact.id)
			},
			messages,
			conversationId
		};
	} catch (error) {
		console.warn('[omnichannel] getProspectOmniChat warning:', error);
		return { contact: null, messages: [], conversationId: null };
	}
}

/** Tautkan kontak omnichannel ke Prospek */
export async function linkOmniContactToProspect(contactId: number, prospectId: number): Promise<void> {
	await directus.request(updateItem('omni_contacts', contactId, { prospect_id: prospectId }));
}

/** Lepaskan tautan prospek dari kontak omnichannel */
export async function unlinkOmniContact(contactId: number): Promise<void> {
	await directus.request(updateItem('omni_contacts', contactId, { prospect_id: null }));
}
