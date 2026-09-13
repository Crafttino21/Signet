import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * On-disk storage for one server.
 *
 * The defining property is that it is **append-only**. A commit is written under a
 * new sequence number and never rewritten; a blob is written under the id of its
 * own content and never replaced. Nothing here deletes anything.
 *
 * That is deliberate, and it is what makes a self-built sync defensible: the worst
 * a broken client can do is add a version nobody wanted. It cannot destroy an
 * older one, so any past state of the vault remains reachable.
 *
 * The server holds only ciphertext. It cannot read a note, a filename, or even
 * tell whether two vaults contain the same document.
 */

export interface VaultAuth {
	tokenHash: string;
	createdAt: string;
}

export interface VaultHead {
	seq: number;
	updatedAt: string | null;
}

export type AppendResult =
	| { ok: true; seq: number }
	/** The caller built on an old commit; it must catch up and retry. */
	| { ok: false; head: number };

const SEQ_DIGITS = 12;

function padSeq(seq: number): string {
	return String(seq).padStart(SEQ_DIGITS, '0');
}

export function sha256Hex(value: string): string {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Constant-time comparison, so a wrong secret cannot be guessed byte by byte.
 *
 * Both sides are digested first, which is what makes the comparison genuinely
 * length-blind. The previous version returned early when the lengths differed
 * and compared a buffer against itself to burn the same time — but a short
 * buffer takes less time than a long one, so the early return still leaked how
 * long the configured secret is. On the token path both sides are always 64 hex
 * characters and it never mattered; on the registration path one side is
 * whatever the caller sent.
 *
 * Digesting is safe here because both inputs are already high-entropy: a token
 * derived from a 120-bit secret, or a registration secret this server refuses to
 * start without 32 characters of. It is not a password hash and must never be
 * used as one.
 */
export function secretsMatch(a: string, b: string): boolean {
	return timingSafeEqual(
		createHash('sha256').update(a, 'utf8').digest(),
		createHash('sha256').update(b, 'utf8').digest()
	);
}

export class VaultStore {
	/** One promise chain per vault, so two pushes cannot interleave. */
	private readonly queues = new Map<string, Promise<unknown>>();

	/**
	 * Devices currently holding a long-poll open on each vault.
	 *
	 * This is what makes live sync possible without hammering the server: an idle
	 * device parks one request and is woken the moment another device commits,
	 * instead of asking every few seconds and mostly being told nothing changed.
	 */
	private readonly waiters = new Map<string, Set<(head: VaultHead) => void>>();

	constructor(private readonly root: string) {}

	private vaultDir(vaultId: string): string {
		return join(this.root, 'vaults', vaultId);
	}

	private blobPath(vaultId: string, blobId: string): string {
		// Sharded, because a flat directory of tens of thousands of files is slow
		// on most filesystems.
		return join(this.vaultDir(vaultId), 'blobs', blobId.slice(0, 2), blobId);
	}

	/** Write to a temporary name and rename, so a reader never sees half a file. */
	private async writeAtomic(path: string, data: Buffer | string): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
		await writeFile(temp, data);
		await rename(temp, path);
	}

	private async readJson<T>(path: string): Promise<T | undefined> {
		try {
			return JSON.parse(await readFile(path, 'utf8')) as T;
		} catch {
			return undefined;
		}
	}

	async readAuth(vaultId: string): Promise<VaultAuth | undefined> {
		return this.readJson<VaultAuth>(join(this.vaultDir(vaultId), 'auth.json'));
	}

	/**
	 * Registers a vault the first time. Registering an existing vault is not an
	 * error, but it never changes the stored token — otherwise anyone holding the
	 * registration secret could take over someone else's vault.
	 */
	async register(vaultId: string, tokenHash: string): Promise<'created' | 'exists'> {
		return this.serialise(vaultId, async () => {
			if (await this.readAuth(vaultId)) {
				return 'exists';
			}
			const auth: VaultAuth = { tokenHash, createdAt: new Date().toISOString() };
			await this.writeAtomic(
				join(this.vaultDir(vaultId), 'auth.json'),
				JSON.stringify(auth, null, 2)
			);
			return 'created';
		});
	}

	async readHead(vaultId: string): Promise<VaultHead> {
		return (
			(await this.readJson<VaultHead>(join(this.vaultDir(vaultId), 'HEAD.json'))) ?? {
				seq: 0,
				updatedAt: null,
			}
		);
	}

	/**
	 * Resolves as soon as the vault moves past `sinceSeq`, or when the wait runs
	 * out — whichever comes first. A timeout is a normal outcome, not an error:
	 * the client simply asks again.
	 */
	async waitForChange(vaultId: string, sinceSeq: number, timeoutMs: number): Promise<VaultHead> {
		const current = await this.readHead(vaultId);
		if (current.seq > sinceSeq) {
			return current;
		}

		return new Promise<VaultHead>((resolve) => {
			const listeners = this.waiters.get(vaultId) ?? new Set();
			this.waiters.set(vaultId, listeners);

			const finish = (head: VaultHead): void => {
				clearTimeout(timer);
				listeners.delete(notify);
				if (listeners.size === 0) {
					this.waiters.delete(vaultId);
				}
				resolve(head);
			};

			const notify = (head: VaultHead): void => {
				finish(head);
			};
			const timer = setTimeout(() => {
				finish(current);
			}, timeoutMs);
			// A parked request must never hold the process open on shutdown.
			timer.unref?.();

			listeners.add(notify);
		});
	}

	/** Wakes everyone parked on this vault. */
	private announce(vaultId: string, head: VaultHead): void {
		const listeners = this.waiters.get(vaultId);
		if (!listeners) {
			return;
		}
		// Copied first: each listener removes itself as it runs.
		for (const listener of [...listeners]) {
			listener(head);
		}
	}

	async readCommit(vaultId: string, seq: number): Promise<Buffer | undefined> {
		try {
			return await readFile(join(this.vaultDir(vaultId), 'commits', `${padSeq(seq)}.json`));
		} catch {
			return undefined;
		}
	}

	/**
	 * Adds a commit, but only if the caller was up to date.
	 *
	 * The check plus the write happen inside the vault's queue, so two devices
	 * pushing at the same moment cannot both believe they were current.
	 */
	async appendCommit(vaultId: string, baseSeq: number, body: Buffer): Promise<AppendResult> {
		return this.serialise(vaultId, async () => {
			const head = await this.readHead(vaultId);
			if (baseSeq !== head.seq) {
				return { ok: false, head: head.seq };
			}

			const seq = head.seq + 1;
			await this.writeAtomic(
				join(this.vaultDir(vaultId), 'commits', `${padSeq(seq)}.json`),
				body
			);
			// HEAD moves last. A crash between the two leaves an orphan commit that
			// nothing points at, which is harmless; the reverse would lose it.
			const next: VaultHead = { seq, updatedAt: new Date().toISOString() };
			await this.writeAtomic(
				join(this.vaultDir(vaultId), 'HEAD.json'),
				JSON.stringify(next, null, 2)
			);

			// Only once the commit is durable. Waking a device earlier would send it
			// to fetch a commit that is not on disk yet.
			this.announce(vaultId, next);
			return { ok: true, seq };
		});
	}

	/**
	 * Whether the store already holds this blob.
	 *
	 * Asks for the size rather than the contents. Reading the whole file to answer
	 * a yes-or-no question meant re-uploading an existing 100 MB blob read 100 MB
	 * off disk to decide to do nothing, which is a free amplifier for anybody who
	 * wants one.
	 */
	async hasBlob(vaultId: string, blobId: string): Promise<boolean> {
		try {
			await stat(this.blobPath(vaultId, blobId));
			return true;
		} catch {
			return false;
		}
	}

	async readBlob(vaultId: string, blobId: string): Promise<Buffer | undefined> {
		try {
			return await readFile(this.blobPath(vaultId, blobId));
		} catch {
			return undefined;
		}
	}

	/**
	 * Stores a blob. Content-addressed, so writing one that already exists is a
	 * no-op rather than an overwrite — there is no way for a client to replace the
	 * bytes another version still refers to.
	 *
	 * Refuses once the vault is at its ceiling. Nothing here is ever deleted, which
	 * is what makes the store safe and also means a ceiling is the only thing that
	 * bounds it: every blob id is derived from its own contents, so a client
	 * uploading junk has a fresh id every time and the de-duplication above never
	 * fires. One member in a loop is the whole disk.
	 */
	async writeBlob(
		vaultId: string,
		blobId: string,
		bytes: Buffer,
		maxVaultBytes = 0
	): Promise<'stored' | 'exists' | 'full'> {
		if (await this.hasBlob(vaultId, blobId)) {
			return 'exists';
		}

		if (maxVaultBytes > 0 && (await this.usage(vaultId)) + bytes.byteLength > maxVaultBytes) {
			return 'full';
		}

		await this.writeAtomic(this.blobPath(vaultId, blobId), bytes);
		return 'stored';
	}

	/**
	 * How many bytes a vault occupies.
	 *
	 * Walked rather than tracked in a counter. A counter is a second source of
	 * truth that a crash mid-write leaves wrong, and this runs once per upload of
	 * something the client has already spent longer encrypting.
	 */
	async usage(vaultId: string): Promise<number> {
		let total = 0;

		const walk = async (dir: string): Promise<void> => {
			let entries;
			try {
				entries = await readdir(dir, { withFileTypes: true });
			} catch {
				return;
			}
			for (const entry of entries) {
				const path = join(dir, entry.name);
				if (entry.isDirectory()) {
					await walk(path);
				} else {
					try {
						total += (await stat(path)).size;
					} catch {
						// Gone between the listing and the question. Not ours to mind.
					}
				}
			}
		};

		await walk(this.vaultDir(vaultId));
		return total;
	}

	/** Rough figures for the health endpoint. Never touches note content. */
	async stats(): Promise<{ vaults: number }> {
		try {
			const entries = await readdir(join(this.root, 'vaults'));
			return { vaults: entries.length };
		} catch {
			return { vaults: 0 };
		}
	}

	private serialise<T>(vaultId: string, task: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(vaultId) ?? Promise.resolve();
		const run = previous.then(task, task);
		this.queues.set(
			vaultId,
			run.catch(() => undefined)
		);
		return run;
	}
}
