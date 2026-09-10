/**
 * The ring code: what the user carries from one device to the next.
 *
 * 15 random bytes (120 bits) in Crockford base32 — 24 characters exactly, no
 * padding — grouped for typing on a phone:
 *
 *     TBX1-K3M9PQ-R7XZ2W-8HTVBN-4CDFG5
 *
 * Crockford's alphabet leaves out I, L, O and U, so there is nothing to confuse
 * with 1 and 0, and {@link parseRingCode} folds the lookalikes back in anyway.
 * The code is the whole secret: it derives the encryption key, and knowing it is
 * what authorises a device to read and write the ring.
 *
 * A **join code** is the same thing with the address of the sync server packed
 * onto the end:
 *
 *     TBX1-K3M9PQ-R7XZ2W-8HTVBN-4CDFG5-019R9S-X0
 *
 * That suffix exists to break a deadlock. The server address travels inside the
 * encrypted ring snapshot, which is an ordinary vault file — so it reaches a new
 * device only once something has synced, and nothing can sync until the device
 * knows where the server is. Eight extra characters end the circle: everything
 * else a device needs it already derives from the secret, so with the address in
 * hand it fetches the vault itself, snapshot included.
 *
 * The address is no more secret than the code it is appended to. Anyone holding
 * the code can read the ring, and the ring says where the server is.
 */

/**
 * Byte arrays backed by a plain ArrayBuffer. Web Crypto's `BufferSource` insists
 * on this over the wider `ArrayBufferLike`, so saying it once here keeps casts out
 * of every call site.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SECRET_BYTES = 15;
const CODE_CHARS = 24; // 15 bytes * 8 bits / 5 bits per char
const PREFIX = 'TBX1';
const GROUP = 6;

/** The port the sync server listens on unless it was told otherwise. */
export const DEFAULT_SYNC_PORT = 8787;

/** Hostname characters, six bits each. Anything outside this is not encodable. */
const HOST_SYMBOLS = 'abcdefghijklmnopqrstuvwxyz0123456789.-';
const HOST_MAX = 63;

/** The ports that cost nothing to carry, because a two-bit code names them. */
const PORT_CODES = [DEFAULT_SYNC_PORT, 443, 80];
const PORT_EXPLICIT = 3;

export class InvalidRingCodeError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'InvalidRingCodeError';
	}
}

/**
 * A join code from a newer version of Toolbox, carrying something this one does
 * not understand.
 *
 * It extends {@link InvalidRingCodeError} on purpose: every existing call site
 * catches that one, and a code this version cannot use is a code it must refuse.
 * Only the wording differs.
 */
export class UnsupportedJoinCodeError extends InvalidRingCodeError {
	constructor(message: string) {
		super(message);
		this.name = 'UnsupportedJoinCodeError';
	}
}

/** Where the sync server is, in the smallest form that survives being typed. */
export interface JoinAddress {
	scheme: 'http' | 'https';
	/** An IPv4 literal or a hostname, lowercase. */
	host: string;
	/** Always concrete, so nothing downstream has to guess a default. */
	port: number;
}

/** What a join code says. `address` is absent for a plain ring code. */
export interface JoinCode {
	secret: Bytes;
	address?: JoinAddress;
}

function encodeBase32(bytes: Uint8Array): string {
	let bits = 0;
	let value = 0;
	let out = '';

	for (const byte of bytes) {
		value = (value << 8) | byte;
		bits += 8;
		while (bits >= 5) {
			bits -= 5;
			out += ALPHABET[(value >>> bits) & 31];
		}
	}

	if (bits > 0) {
		out += ALPHABET[(value << (5 - bits)) & 31];
	}
	return out;
}

function decodeBase32(text: string): Bytes {
	const bytes: number[] = [];
	let bits = 0;
	let value = 0;

	for (const char of text) {
		const index = ALPHABET.indexOf(char);
		if (index < 0) {
			throw new InvalidRingCodeError(`Not a valid character in a ring code: ${char}`);
		}
		value = (value << 5) | index;
		bits += 5;
		if (bits >= 8) {
			bits -= 8;
			bytes.push((value >>> bits) & 255);
		}
	}

	return new Uint8Array(bytes);
}

/**
 * The address suffix is a bit stream rather than bytes, because rounding every
 * field up to eight bits would cost characters a person has to type. Five bits
 * go in and out per base32 character, most significant first.
 */
class BitWriter {
	private bits = '';

	push(value: number, width: number): void {
		for (let i = width - 1; i >= 0; i -= 1) {
			this.bits += (value >>> i) & 1 ? '1' : '0';
		}
	}

	/** Base32 with the last character's spare low bits left at zero. */
	toBase32(): string {
		let out = '';
		for (let i = 0; i < this.bits.length; i += 5) {
			out += ALPHABET[Number.parseInt(this.bits.slice(i, i + 5).padEnd(5, '0'), 2)];
		}
		return out;
	}
}

class BitReader {
	private at = 0;
	private readonly bits: string;

	constructor(text: string) {
		let bits = '';
		for (const char of text) {
			const index = ALPHABET.indexOf(char);
			if (index < 0) {
				throw new InvalidRingCodeError(`Not a valid character in a ring code: ${char}`);
			}
			bits += index.toString(2).padStart(5, '0');
		}
		this.bits = bits;
	}

	take(width: number): number {
		if (this.at + width > this.bits.length) {
			throw new InvalidRingCodeError('The address in this code is cut short.');
		}
		const value = Number.parseInt(this.bits.slice(this.at, this.at + width), 2);
		this.at += width;
		return value;
	}

	/**
	 * Everything after the last field must be the zero padding the writer added.
	 * A mistyped final character usually lands here, and saying so beats decoding
	 * an address that is quietly one bit different from the one on the screen.
	 */
	end(): void {
		const rest = this.bits.slice(this.at);
		if (rest.length >= 5 || rest.includes('1')) {
			throw new InvalidRingCodeError('This code has more after the address than it should.');
		}
	}
}

function isIPv4(host: string): boolean {
	const parts = host.split('.');
	return (
		parts.length === 4 &&
		parts.every(
			(part) =>
				/^\d{1,3}$/.test(part) && Number(part) <= 255 && (part === '0' || part[0] !== '0')
		)
	);
}

function encodeAddress(address: JoinAddress): string {
	const writer = new BitWriter();
	const ipv4 = isIPv4(address.host);
	const named = PORT_CODES.indexOf(address.port);
	const portCode = named < 0 ? PORT_EXPLICIT : named;

	writer.push(0, 1); // Reserved. A newer version sets this; this one refuses those.
	writer.push(address.scheme === 'https' ? 1 : 0, 1);
	writer.push(ipv4 ? 0 : 1, 1);
	writer.push(portCode, 2);

	if (ipv4) {
		for (const part of address.host.split('.')) {
			writer.push(Number(part), 8);
		}
	} else {
		writer.push(address.host.length, 6);
		for (const char of address.host) {
			writer.push(HOST_SYMBOLS.indexOf(char), 6);
		}
	}

	if (portCode === PORT_EXPLICIT) {
		writer.push(address.port, 16);
	}

	return writer.toBase32();
}

function decodeAddress(suffix: string): JoinAddress {
	const reader = new BitReader(suffix);

	if (reader.take(1) === 1) {
		throw new UnsupportedJoinCodeError(
			'This code was made by a newer version of Toolbox. Update the plugin on this device first.'
		);
	}

	const scheme = reader.take(1) === 1 ? 'https' : 'http';
	const named = reader.take(1) === 1;
	const portCode = reader.take(2);

	let host: string;
	if (!named) {
		host = [reader.take(8), reader.take(8), reader.take(8), reader.take(8)].join('.');
	} else {
		const length = reader.take(6);
		if (length === 0) {
			throw new InvalidRingCodeError('The address in this code has no host.');
		}
		let out = '';
		for (let i = 0; i < length; i += 1) {
			const symbol = HOST_SYMBOLS[reader.take(6)];
			if (symbol === undefined) {
				throw new InvalidRingCodeError('The address in this code is not readable.');
			}
			out += symbol;
		}
		host = out;
	}

	const port = portCode === PORT_EXPLICIT ? reader.take(16) : PORT_CODES[portCode];
	if (port === undefined || port === 0) {
		throw new InvalidRingCodeError('The address in this code has no port.');
	}
	reader.end();

	return { scheme, host, port };
}

/**
 * Reads a server address out of a URL, or says it cannot.
 *
 * Never throws: an address that will not fit — IPv6, a path, a host with unusual
 * characters — simply means the join code stays the short one and the address is
 * typed by hand on the other device. Refusing to show a code at all would be a
 * worse answer than showing one that carries a little less.
 */
export function addressFromUrl(value: string): JoinAddress | undefined {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return undefined;
	}

	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		return undefined;
	}
	if (url.username || url.password || url.search || url.hash) {
		return undefined;
	}
	if (url.pathname !== '' && url.pathname !== '/') {
		return undefined;
	}

	const host = url.hostname.toLowerCase();
	if (host.length === 0 || host.length > HOST_MAX) {
		return undefined;
	}
	if (!isIPv4(host) && ![...host].every((char) => HOST_SYMBOLS.includes(char))) {
		return undefined;
	}

	const scheme = url.protocol === 'https:' ? 'https' : 'http';
	const implied = scheme === 'https' ? 443 : 80;
	const port = url.port === '' ? implied : Number(url.port);
	if (!Number.isInteger(port) || port <= 0 || port > 65535) {
		return undefined;
	}

	return { scheme, host, port };
}

/**
 * The address as something `requestUrl` and `new URL()` both accept.
 *
 * The port is written out for `http`, even when it is 80. Leaving it off would
 * be prettier and would lose information: `http://host:80` printed as
 * `http://host` reads, on the device that receives it, as an address with no
 * port at all — and a plain-http address with no port is exactly the one that
 * gets the sync server's usual port filled in for it. The port someone typed
 * would quietly become a different one on the next device.
 *
 * `https` on 443 is the one case where that cannot happen, because nothing ever
 * fills a port in for it, so it is written the way people write it. Which also
 * makes the address identical on the device that typed it and the device that
 * received it, rather than the same server under two spellings.
 */
export function addressToUrl(address: JoinAddress): string {
	if (address.scheme === 'https' && address.port === 443) {
		return `https://${address.host}`;
	}
	return `${address.scheme}://${address.host}:${String(address.port)}`;
}

function group(body: string): string {
	const groups: string[] = [];
	for (let i = 0; i < body.length; i += GROUP) {
		groups.push(body.slice(i, i + GROUP));
	}
	return [PREFIX, ...groups].join('-');
}

/** Formats raw secret bytes as the code the user sees. */
export function formatRingCode(secret: Uint8Array): string {
	if (secret.length !== SECRET_BYTES) {
		throw new InvalidRingCodeError(`A ring secret is ${SECRET_BYTES} bytes`);
	}
	return group(encodeBase32(secret));
}

/**
 * The code to hand to another device: the ring secret, plus the server address
 * when there is one that fits. Without an address it is character-for-character
 * the plain ring code, so there is only ever one code to keep track of.
 */
export function formatJoinCode(secret: Uint8Array, address?: JoinAddress): string {
	if (secret.length !== SECRET_BYTES) {
		throw new InvalidRingCodeError(`A ring secret is ${SECRET_BYTES} bytes`);
	}
	return group(encodeBase32(secret) + (address ? encodeAddress(address) : ''));
}

function clean(input: string): string {
	return input.toUpperCase().replace(/[\s-]/g, '').replace(/[IL]/g, '1').replace(/O/g, '0');
}

function read(body: string): JoinCode {
	if (body.length < CODE_CHARS) {
		throw new InvalidRingCodeError(
			`A ring code has at least ${CODE_CHARS} characters after the prefix, this one has ${String(body.length)}`
		);
	}

	// 24 base32 chars carry 120 bits exactly, so nothing is left over to fold into
	// the suffix — the split is a fixed offset rather than a guess.
	const secret = decodeBase32(body.slice(0, CODE_CHARS)).slice(0, SECRET_BYTES);
	const suffix = body.slice(CODE_CHARS);
	return suffix.length === 0 ? { secret } : { secret, address: decodeAddress(suffix) };
}

/**
 * Parses a code the user typed or pasted, with or without a server address.
 *
 * Tolerant about spacing, case, missing dashes and the Crockford lookalikes;
 * strict about everything else.
 */
export function parseJoinCode(input: string): JoinCode {
	const body = clean(input);

	// The prefix is stripped only if what remains still parses. One body in a
	// million happens to start with the four characters of the prefix, and eating
	// them would turn a valid code into a mysterious one.
	if (body.startsWith(PREFIX)) {
		try {
			return read(body.slice(PREFIX.length));
		} catch (error) {
			if (error instanceof UnsupportedJoinCodeError) {
				throw error;
			}
		}
	}

	return read(body);
}

/**
 * The ring secret out of any code. Everything that derives keys goes through
 * here, and none of it needs to know whether an address came along.
 */
export function parseRingCode(input: string): Bytes {
	return parseJoinCode(input).secret;
}

/** A fresh random ring secret. */
export function generateRingSecret(): Bytes {
	const secret = new Uint8Array(SECRET_BYTES);
	globalThis.crypto.getRandomValues(secret);
	return secret;
}
