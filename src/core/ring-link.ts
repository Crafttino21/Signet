/**
 * What the ring carries besides plugins.
 *
 * The ring already moves an encrypted snapshot between the devices, and the
 * address of the sync server belongs in it: a device that has the ring code has
 * everything needed to talk to that server anyway, so making the user type the
 * address on each device is asking for something the ring could simply say. Which
 * it does, inside the same AES-GCM envelope as the rest — the address of a server
 * on a home network is not something to publish to a vault a stranger might read.
 *
 * This is the seam between the two modules. The ring module knows how to read and
 * write the snapshot but nothing about servers; the sync module knows about
 * servers but must not learn how to open a ring file. So neither imports the
 * other: one contributes what it wants said, the other says it, and what comes
 * back from the host is announced to whoever is listening.
 *
 * Deliberately shared mutable state on the plugin rather than settings, for the
 * same reason as the live-editing registry: both sides need the current answer,
 * and a copy that lags is a copy that syncs to the wrong place.
 */

/** The part of a snapshot that is not about plugins. */
export interface RingInfo {
	/**
	 * Where the host says its sync server is. Absent when the host has none, which
	 * is the ordinary state of a ring used only to keep plugins in step.
	 */
	serverUrl?: string;
}

export class RingLink {
	private local: RingInfo = {};
	private expecting = 0;
	private heard: RingInfo | undefined;
	private readonly listeners = new Set<(info: RingInfo) => void>();
	private readonly publishers = new Set<() => void>();

	/**
	 * What this device would tell the ring about itself.
	 *
	 * Only read when this device is the host and publishes; on every other device
	 * it sits there unused, which is simpler than asking who the host is.
	 */
	contribute(info: RingInfo): void {
		this.local = { ...this.local, ...info };
	}

	contribution(): RingInfo {
		return { ...this.local };
	}

	/**
	 * Says that a module intends to publish a server address once it has one.
	 *
	 * Deliberately separate from {@link contribute}: this is about what is going
	 * to be said, not about what is said, and it must not end up inside a
	 * published snapshot. What it buys is the difference between "this ring keeps
	 * plugins in step and wants no server" and "the server is not set up yet" —
	 * two states that look identical from here and need opposite advice, because
	 * a code handed out in the second one carries no address and strands whoever
	 * joins with it.
	 *
	 * Returns the undo, so switching the module off takes the claim with it.
	 */
	expectServer(): () => void {
		this.expecting += 1;
		return () => {
			this.expecting -= 1;
		};
	}

	isServerExpected(): boolean {
		return this.expecting > 0;
	}

	/** What the host's snapshot said. Called by the ring after reading one. */
	announce(info: RingInfo): void {
		this.heard = { ...info };
		for (const listener of this.listeners) {
			listener({ ...info });
		}
	}

	/**
	 * Listens for what the host says.
	 *
	 * The last announcement is replayed immediately, because a module that loads
	 * after the ring has already read a snapshot would otherwise wait for the next
	 * one — which, for a ring that rarely changes, could be days.
	 */
	onAnnounce(listener: (info: RingInfo) => void): () => void {
		this.listeners.add(listener);
		if (this.heard) {
			listener({ ...this.heard });
		}
		return () => this.listeners.delete(listener);
	}

	/**
	 * Asks the host to publish, because something worth sharing changed here.
	 *
	 * Ignored on a device that is not the host: the ring module is the only
	 * listener, and it knows which of the two this device is.
	 */
	requestPublish(): void {
		for (const publisher of this.publishers) {
			publisher();
		}
	}

	onPublishRequest(handler: () => void): () => void {
		this.publishers.add(handler);
		return () => this.publishers.delete(handler);
	}
}
