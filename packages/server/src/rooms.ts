import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

/**
 * Storage for collaboration rooms.
 *
 * A room is the history of one note as a list of sealed updates. The server can
 * neither read them nor tell which note they belong to — the id is keyed with a
 * key it never sees.
 *
 * Unlike the file store, a room's log has to be bounded: it grows with every
 * keystroke, and a client rebuilding a year of edits on every open would be
 * unusable. Compaction is how that is handled, and it keeps the same promise as
 * everything else here — a compacted log is written as a *new* generation and the
 * old one stays on disk. Nothing is destroyed, it simply stops being read.
 */

/**
 * Whether a failure to read means "there is nothing here".
 *
 * Only one errno does. Everything else — a permission that changed, too many
 * open files, a volume that hiccuped — used to be swallowed into the same empty
 * answer, and an empty answer is not inert: a client that is told a room has no
 * history treats that as licence to seed the room from whatever is on its own
 * disk. A momentary read failure on the server therefore published one device's
 * possibly stale copy of a note to everybody. The room has to be able to say
 * "ask me again" as distinct from "I am new".
 */
function isMissing(error: unknown): boolean {
	return (error as { code?: unknown } | null)?.code === 'ENOENT';
}

export interface RoomLog {
	generation: number;
	updates: string[];
}

/** Past this many updates, the next client to join is asked to compact. */
export const COMPACT_THRESHOLD = 200;

/**
 * The largest a single room's current log may grow before appends are refused.
 *
 * `COMPACT_THRESHOLD` is advice to clients and always was: nothing here checked
 * it, so a room nobody compacted grew for as long as somebody kept typing. A byte
 * ceiling is the version that does not depend on the client cooperating.
 * Generous — an ordinary note compacts long before this — and reached only by a
 * client that is not compacting when it is asked to.
 */
const MAX_LOG_BYTES = 64 * 1024 * 1024;

export class RoomStore {
	/** One promise chain per room, so two appends cannot interleave. */
	private readonly queues = new Map<string, Promise<unknown>>();

	constructor(private readonly root: string) {}

	private roomDir(vaultId: string, roomId: string): string {
		return join(this.root, 'vaults', vaultId, 'rooms', roomId);
	}

	private async writeAtomic(path: string, data: string): Promise<void> {
		await mkdir(dirname(path), { recursive: true });
		const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
		await writeFile(temp, data);
		await rename(temp, path);
	}

	/** The newest generation on disk, or 0 when the room is new. */
	private async latestGeneration(vaultId: string, roomId: string): Promise<number> {
		try {
			const entries = await readdir(this.roomDir(vaultId, roomId));
			const generations = entries
				.map((name) => /^gen-(\d+)\.log$/.exec(name)?.[1])
				.filter((value): value is string => value !== undefined)
				.map(Number);
			return generations.length === 0 ? 0 : Math.max(...generations);
		} catch (error) {
			if (isMissing(error)) {
				return 0;
			}
			throw error;
		}
	}

	private logPath(vaultId: string, roomId: string, generation: number): string {
		return join(this.roomDir(vaultId, roomId), `gen-${String(generation)}.log`);
	}

	/**
	 * Everything a joining client needs to rebuild the document.
	 *
	 * One sealed update per line: appending is then a single write with no need to
	 * read what is already there.
	 */
	async read(vaultId: string, roomId: string): Promise<RoomLog> {
		const generation = await this.latestGeneration(vaultId, roomId);
		if (generation === 0) {
			return { generation: 0, updates: [] };
		}

		try {
			const raw = await readFile(this.logPath(vaultId, roomId, generation), 'utf8');
			return {
				generation,
				updates: raw.split('\n').filter((line) => line.length > 0),
			};
		} catch (error) {
			if (isMissing(error)) {
				// The directory listing named this generation a moment ago, so this is
				// a room being compacted underneath us rather than an empty one.
				// Saying "empty" would be as wrong here as anywhere else.
				throw new Error(
					`Room ${roomId} lost generation ${String(generation)} while reading.`
				);
			}
			throw error;
		}
	}

	async append(vaultId: string, roomId: string, update: string): Promise<'stored' | 'full'> {
		return this.serialise(`${vaultId}/${roomId}`, async () => {
			const generation = Math.max(1, await this.latestGeneration(vaultId, roomId));
			const path = this.logPath(vaultId, roomId, generation);

			let held = 0;
			try {
				held = (await stat(path)).size;
			} catch {
				// No log yet, which is the ordinary case for a room's first update.
			}
			if (held + update.length + 1 > MAX_LOG_BYTES) {
				return 'full';
			}

			await mkdir(dirname(path), { recursive: true });
			// Append rather than rewrite: a room under active editing is written to
			// constantly, and rewriting the whole log each time would not scale.
			const { appendFile } = await import('node:fs/promises');
			await appendFile(path, `${update}\n`);
			return 'stored';
		});
	}

	/**
	 * Replaces the log with a single merged update, as a new generation.
	 *
	 * Refuses when the client compacted an older generation than the current one:
	 * it would be discarding updates it never saw.
	 *
	 * The generation check alone is not enough, and that gap cost edits. A client
	 * rebuilds the document from the log, merges it, and sends the result — and
	 * anything appended to that same generation in between is covered by neither
	 * the merge nor the check. The new generation would then be missing those
	 * entries, and since only the newest generation is ever read, they stop
	 * existing. Invisibly, too: every peer still connected holds them in memory,
	 * so it only shows once everybody has disconnected.
	 *
	 * So a client that says how many entries it merged gets the rest appended
	 * after the merge. A client that does not say is trusted as before, because
	 * refusing it outright would leave an old client unable to compact at all.
	 */
	async compact(
		vaultId: string,
		roomId: string,
		basedOn: number,
		merged: string,
		covered?: number
	): Promise<{ ok: true; generation: number } | { ok: false; generation: number }> {
		return this.serialise(`${vaultId}/${roomId}`, async () => {
			const current = await this.latestGeneration(vaultId, roomId);
			if (basedOn !== current) {
				return { ok: false, generation: current };
			}

			const lines = covered === undefined ? [] : (await this.read(vaultId, roomId)).updates;
			const tail = covered === undefined ? [] : lines.slice(covered);

			const next = current + 1;
			await this.writeAtomic(
				this.logPath(vaultId, roomId, next),
				[merged, ...tail].map((line) => `${line}\n`).join('')
			);
			return { ok: true, generation: next };
		});
	}

	private serialise<T>(key: string, task: () => Promise<T>): Promise<T> {
		const previous = this.queues.get(key) ?? Promise.resolve();
		const run = previous.then(task, task);
		this.queues.set(
			key,
			run.catch(() => undefined)
		);
		return run;
	}
}
