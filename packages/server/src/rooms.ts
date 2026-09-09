import { randomBytes } from 'node:crypto';
import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
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

export interface RoomLog {
	generation: number;
	updates: string[];
}

/** Past this many updates, the next client to join is asked to compact. */
export const COMPACT_THRESHOLD = 200;

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
		} catch {
			return 0;
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
		} catch {
			return { generation, updates: [] };
		}
	}

	async append(vaultId: string, roomId: string, update: string): Promise<void> {
		return this.serialise(`${vaultId}/${roomId}`, async () => {
			const generation = Math.max(1, await this.latestGeneration(vaultId, roomId));
			const path = this.logPath(vaultId, roomId, generation);

			await mkdir(dirname(path), { recursive: true });
			// Append rather than rewrite: a room under active editing is written to
			// constantly, and rewriting the whole log each time would not scale.
			const { appendFile } = await import('node:fs/promises');
			await appendFile(path, `${update}\n`);
		});
	}

	/**
	 * Replaces the log with a single merged update, as a new generation.
	 *
	 * Refuses when the client compacted an older generation than the current one:
	 * it would be discarding updates it never saw.
	 */
	async compact(
		vaultId: string,
		roomId: string,
		basedOn: number,
		merged: string
	): Promise<{ ok: true; generation: number } | { ok: false; generation: number }> {
		return this.serialise(`${vaultId}/${roomId}`, async () => {
			const current = await this.latestGeneration(vaultId, roomId);
			if (basedOn !== current) {
				return { ok: false, generation: current };
			}

			const next = current + 1;
			await this.writeAtomic(this.logPath(vaultId, roomId, next), `${merged}\n`);
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
