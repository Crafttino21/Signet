/**
 * Where the sync server is, and who said so.
 *
 * Two devices can disagree about the server's address for a good reason: the
 * host publishes the one it uses, and another device may reach the same machine
 * over a VPN, under a different name, or not at all. So an address a person
 * typed here outranks one that arrived through the ring, and that ranking has to
 * survive in the settings — otherwise the next snapshot quietly overwrites a
 * deliberate choice.
 *
 * The reverse case is just as real: a server that moves to a new IP, a new port
 * or behind TLS. A device that had adopted the old address from the ring adopts
 * the new one the same way, which is what makes moving the server a job done
 * once on the host rather than once per device.
 */

/** Who put the current address there. */
export type ServerUrlSource = 'user' | 'ring';

/**
 * An address is about to be used for requests and sockets, and it may have
 * arrived from a file. Only the two schemes this speaks are accepted — the check
 * costs nothing and keeps anything else from ever reaching a request.
 */
export function isUsableServerUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

/** Trailing slashes only ever cause double slashes further down. */
export function normaliseServerUrl(value: string): string {
	return value.trim().replace(/\/+$/, '');
}

/**
 * The address to store after the ring announced one, or undefined to keep what
 * is already there.
 *
 * Returning undefined for an unchanged address matters as much as the rest: the
 * ring announces on every join and every snapshot read, and adopting an address
 * that is already in place would repeat the notice and re-run the claim each
 * time.
 */
export function shouldAdopt(
	current: { serverUrl: string; serverUrlSource: ServerUrlSource },
	incoming: string | undefined
): string | undefined {
	if (incoming === undefined) {
		return undefined;
	}

	const url = normaliseServerUrl(incoming);
	if (!url || url === current.serverUrl || !isUsableServerUrl(url)) {
		return undefined;
	}

	// An empty slot takes anything; a filled one only gives way to the ring if the
	// ring is where it came from.
	return !current.serverUrl || current.serverUrlSource === 'ring' ? url : undefined;
}
