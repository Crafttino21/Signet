import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { isHeartbeat } from './health';
import type { Heartbeat } from './health';

/**
 * The heartbeat files.
 *
 * Each device owns exactly one file, named after its id. That is the whole trick:
 * with a single writer per file there is nothing for two devices to disagree
 * about, so the health check cannot become another source of the conflicts it is
 * meant to report.
 *
 * They are ordinary vault files so that they travel through whatever sync the user
 * already runs — which is also what makes them a measurement of it.
 */
export class HeartbeatStore {
	readonly folder: string;

	constructor(
		private readonly app: App,
		folder: string
	) {
		this.folder = normalizePath(folder);
	}

	private pathFor(deviceId: string): string {
		// Device ids are UUIDs, but a stray separator would escape the folder.
		const safe = deviceId.replace(/[^\w-]/g, '');
		return normalizePath(`${this.folder}/${safe}.json`);
	}

	async write(beat: Heartbeat): Promise<void> {
		const path = this.pathFor(beat.deviceId);
		const contents = JSON.stringify(beat, null, 2);

		const existing = this.app.vault.getFileByPath(path);
		if (existing) {
			await this.app.vault.modify(existing, contents);
			return;
		}

		if (!this.app.vault.getFolderByPath(this.folder)) {
			await this.app.vault.createFolder(this.folder);
		}
		await this.app.vault.create(path, contents);
	}

	/** Every readable heartbeat. Unreadable ones are skipped, not reported as errors. */
	async readAll(): Promise<Heartbeat[]> {
		const folder = this.app.vault.getFolderByPath(this.folder);
		if (!folder) {
			return [];
		}

		const beats: Heartbeat[] = [];
		for (const file of this.app.vault.getFiles()) {
			if (file.parent?.path !== folder.path || file.extension !== 'json') {
				continue;
			}

			try {
				const parsed: unknown = JSON.parse(await this.app.vault.cachedRead(file));
				if (isHeartbeat(parsed)) {
					beats.push(parsed);
				}
			} catch {
				// A half-synced file is expected now and then; it is not news.
				continue;
			}
		}

		return beats;
	}
}
