/**
 * Keeping two open devices in step.
 *
 * Two halves, and both only run while Obsidian is actually in front of someone:
 *
 * - **Listening.** One request is parked on the server, which answers the moment
 *   another device commits. That is the difference between live and polling: an
 *   idle vault costs one open connection instead of a request every few seconds,
 *   and a change arrives in about as long as it takes to travel the network.
 * - **Announcing.** Local edits are collected and pushed after a short pause, so
 *   a burst of typing becomes one commit rather than thirty.
 *
 * Both stop when the window loses focus, and neither is attempted in the
 * background. On mobile that is not a policy choice: iOS suspends a backgrounded
 * app and Android vendors kill it, so a loop that assumed otherwise would simply
 * die mid-request and leave a half-finished sync behind.
 */

export interface LiveOptions {
	/** How long a parked request may wait before the server answers anyway. */
	waitSeconds: number;
	/** Quiet period after the last local edit before pushing. */
	debounceMs: number;
	/** How long to hold off after a failure, so a broken server is not hammered. */
	backoffMs: number;
	/**
	 * Floor on how often a pass may come round.
	 *
	 * A server that parks the request makes this irrelevant. One that answers
	 * immediately — an old build, or a proxy that will not hold a connection —
	 * would otherwise turn the loop into a request flood.
	 */
	minIntervalMs: number;
}

export const DEFAULT_LIVE_OPTIONS: LiveOptions = {
	waitSeconds: 45,
	debounceMs: 2_000,
	backoffMs: 15_000,
	minIntervalMs: 1_000,
};

export interface LiveHandlers {
	/** The commit this device already has, so the server knows what to wait past. */
	currentSeq: () => number;
	/** Asks the server to hold until something newer exists. Resolves with its head. */
	waitForRemote: (since: number, seconds: number) => Promise<number>;
	/** Runs a sync. Errors are reported, not thrown. */
	sync: () => Promise<void>;
	/** True while this device should be doing live work at all. */
	isActive: () => boolean;
	onError: (error: unknown) => void;
}

/**
 * Drives the listening half.
 *
 * Deliberately a plain loop rather than a timer: each pass waits for the server,
 * so there is never more than one request in flight and no way for a slow answer
 * to pile up behind a fast timer.
 */
export class LiveSession {
	private running = false;
	private stopped = false;
	private pushTimer: number | undefined;

	constructor(
		private readonly handlers: LiveHandlers,
		private readonly options: LiveOptions = DEFAULT_LIVE_OPTIONS
	) {}

	get isRunning(): boolean {
		return this.running;
	}

	start(): void {
		if (this.running) {
			return;
		}
		this.running = true;
		this.stopped = false;
		void this.loop();
	}

	stop(): void {
		this.stopped = true;
		this.running = false;
		if (this.pushTimer !== undefined) {
			window.clearTimeout(this.pushTimer);
			this.pushTimer = undefined;
		}
	}

	/**
	 * Notes a local change. The push happens once the edits stop, so holding a key
	 * down does not produce a commit per character.
	 */
	noteLocalChange(): void {
		if (!this.running) {
			return;
		}
		if (this.pushTimer !== undefined) {
			window.clearTimeout(this.pushTimer);
		}
		this.pushTimer = window.setTimeout(() => {
			this.pushTimer = undefined;
			void this.runSync();
		}, this.options.debounceMs);
	}

	private async loop(): Promise<void> {
		while (!this.stopped) {
			if (!this.handlers.isActive()) {
				// Not in front of anyone. Stop rather than park a request that the
				// operating system may kill anyway.
				this.running = false;
				return;
			}

			const startedAt = Date.now();

			try {
				const head = await this.handlers.waitForRemote(
					this.handlers.currentSeq(),
					this.options.waitSeconds
				);

				if (this.stopped) {
					return;
				}
				if (head > this.handlers.currentSeq()) {
					await this.runSync();
				}
			} catch (error) {
				this.handlers.onError(error);
				// A server that is down should be asked again occasionally, not
				// continuously.
				await this.pause(this.options.backoffMs);
				continue;
			}

			// Guards against a server that answers straight away instead of parking
			// the request: without this the loop would spin as fast as the network.
			const elapsed = Date.now() - startedAt;
			if (elapsed < this.options.minIntervalMs) {
				await this.pause(this.options.minIntervalMs - elapsed);
			}
		}
	}

	private async runSync(): Promise<void> {
		try {
			await this.handlers.sync();
		} catch (error) {
			this.handlers.onError(error);
		}
	}

	private pause(ms: number): Promise<void> {
		return new Promise((resolve) => {
			window.setTimeout(resolve, ms);
		});
	}
}
