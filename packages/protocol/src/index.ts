/**
 * Everything the plugin and the server must agree on.
 *
 * Both sides import this one package rather than each carrying their own copy.
 * A sync protocol implemented twice drifts, and the drift shows up as corrupted
 * or silently dropped data — so there is exactly one implementation.
 */

export type { Bytes } from './code';
export { InvalidRingCodeError, formatRingCode, generateRingSecret, parseRingCode } from './code';

export type { RingEnvelope } from './crypto';
export {
	RingDecryptionError,
	deriveRingId,
	isRingEnvelope,
	openSnapshot,
	sealSnapshot,
} from './crypto';

export * from './keys';
export * from './blob';
export * from './wire';
