// src/lib/server/shared/signatureVerify.ts
// SERVER-ONLY. Generalized hash/verify helpers for the universal Signature
// Service (F0). Re-exports the existing, unchanged ESS hash implementation —
// no fork, no behavior change — plus a key-builder for non-HR envelopes.
// Lives under shared/ (not ess/) since future non-ESS lapangan signing code
// (e.g. driver/PO signing) should not need to import from an ESS-named path.

export { computeVerifyHash } from '../ess/hrDocVerify';

/** Stable ref key for a signature_envelope, used in place of a nomor_dokumen. */
export function computeEnvelopeRefKey(modulAsal: string, refId: string): string {
	return `${modulAsal}:${refId}`;
}
