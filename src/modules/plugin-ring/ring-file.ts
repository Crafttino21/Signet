import { normalizePath } from 'obsidian';
import type { App } from 'obsidian';
import { t } from '../../i18n';
import { deriveRingId, isRingEnvelope, openSnapshot } from '@signet/protocol';
import type { Bytes, RingEnvelope } from '@signet/protocol';
import { isRingSnapshot } from './types';

export type RingFileState =
	| { status: 'absent' }
	/**
	 * The file is there but cannot be understood right now. That is an expected,
	 * temporary condition — a sync client replacing the file can easily be caught
	 * mid-write — so this is deliberately distinct from "wrong secret", and the
	 * right response is to try again later rather than to warn about tampering.
	 */
	| { status: 'unreadable'; message: string }
	| { status: 'ok'; envelope: RingEnvelope };

/**
 * The ring file itself.
 *
 * It is an ordinary, visible vault file rather than something under the config
 * directory — that is the whole point. Config folders do not travel to mobile in
 * this setup, ordinary vault files do, so the ring rides along on whatever sync
 * the user already runs. Being visible, it is reached through the vault API.
 */
export class RingFile {
	readonly path: string;

	constructor(
		private readonly app: App,
		path: string
	) {
		this.path = normalizePath(path);
	}

	async read(): Promise<RingFileState> {
		const contents = await this.readContents();
		if (contents === undefined) {
			return { status: 'absent' };
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(contents);
		} catch {
			return { status: 'unreadable', message: t('ring.file.notJson') };
		}

		if (!isRingEnvelope(parsed)) {
			return { status: 'unreadable', message: t('ring.file.notSnapshot') };
		}
		return { status: 'ok', envelope: parsed };
	}

	/**
	 * The file's text, or undefined if it is really not there.
	 *
	 * The index is asked first, because a file it knows about is a file Obsidian
	 * will report changes for. But the index is not the disk: a sync client that
	 * drops the ring file in while Obsidian is running leaves a file that exists
	 * and is not indexed yet — the ordinary case on a phone, where the app is
	 * opened and the sync arrives seconds later. Trusting the index alone there
	 * meant telling the user there was no ring file while it sat in the vault.
	 */
	private async readContents(): Promise<string | undefined> {
		const file = this.app.vault.getFileByPath(this.path);
		if (file) {
			return this.app.vault.read(file);
		}

		if (await this.app.vault.adapter.exists(this.path)) {
			return this.app.vault.adapter.read(this.path);
		}
		return undefined;
	}

	/**
	 * Moves the file aside so a fresh ring can be published over it.
	 *
	 * It goes to the trash, never to a delete: that file is another ring's only
	 * state, and this plugin has one rule about other people's data it does not
	 * bend. Returns false when the file exists on disk but Obsidian has not
	 * indexed it — `trashFile` needs a `TFile`, and writing over it through the
	 * adapter instead would be exactly the destruction being avoided.
	 */
	async trashExisting(): Promise<boolean> {
		const file = this.app.vault.getFileByPath(this.path);
		if (!file) {
			return !(await this.app.vault.adapter.exists(this.path));
		}
		await this.app.fileManager.trashFile(file);
		return true;
	}

	async write(envelope: RingEnvelope): Promise<void> {
		const contents = JSON.stringify(envelope, null, 2);
		const existing = this.app.vault.getFileByPath(this.path);

		if (existing) {
			await this.app.vault.modify(existing, contents);
			return;
		}

		await this.ensureParentFolder();

		// Same gap the other way round: `create` refuses a path that is already on
		// disk, so a host whose index has not caught up could never publish again.
		if (await this.app.vault.adapter.exists(this.path)) {
			await this.app.vault.adapter.write(this.path, contents);
			return;
		}

		await this.app.vault.create(this.path, contents);
	}

	/**
	 * Sync clients rename rather than merge when two devices write at once, leaving
	 * copies like `plugin-ring (conflicted copy).json` next to the real file. They
	 * are worth surfacing: they mean two devices were both publishing.
	 */
	findConflictCopies(): string[] {
		const lastSlash = this.path.lastIndexOf('/');
		const folder = lastSlash < 0 ? '' : this.path.slice(0, lastSlash);
		const fileName = this.path.slice(lastSlash + 1);
		const stem = fileName.replace(/\.json$/, '');

		return this.app.vault
			.getFiles()
			.filter((file) => {
				if (file.path === this.path) {
					return false;
				}
				const parent = file.parent?.path === '/' ? '' : (file.parent?.path ?? '');
				return (
					parent === folder && file.name.startsWith(stem) && file.name.endsWith('.json')
				);
			})
			.map((file) => file.path);
	}

	private async ensureParentFolder(): Promise<void> {
		const lastSlash = this.path.lastIndexOf('/');
		if (lastSlash < 0) {
			return;
		}

		const folder = this.path.slice(0, lastSlash);
		if (this.app.vault.getFolderByPath(folder)) {
			return;
		}
		// `createFolder` throws on a folder that is on disk but not indexed, which
		// is the same staleness the file itself has to cope with.
		if (await this.app.vault.adapter.exists(folder)) {
			return;
		}
		await this.app.vault.createFolder(folder);
	}
}

/**
 * What the file lying at the ring's path actually is.
 *
 * Told apart before anything is overwritten, because the three cases want three
 * different answers and only one of them is a race:
 *
 * - `free` — nothing there, publish away.
 * - `ours` — our ring; the sequence number decides who is behind.
 * - `foreign` — someone else's ring, or a leftover from a ring this device used
 *   to be in. Decided from the ring id, which the envelope carries in the clear
 *   for exactly this purpose, so no decryption is attempted or needed.
 * - `corrupt` — our ring id, but the contents will not open. Usually a file
 *   caught halfway through being written by a sync client.
 *
 * The distinction matters because `foreign` is recoverable and `corrupt` is not:
 * overwriting a file that only looks broken would throw away the ring.
 */
export type RingFileVerdict = 'free' | 'ours' | 'foreign' | 'corrupt';

export async function classifyRingFile(
	state: RingFileState,
	secret: Bytes
): Promise<RingFileVerdict> {
	if (state.status === 'absent') {
		return 'free';
	}
	if (state.status === 'unreadable') {
		return 'corrupt';
	}

	if (state.envelope.ring !== (await deriveRingId(secret))) {
		return 'foreign';
	}

	try {
		return isRingSnapshot(await openSnapshot(secret, state.envelope)) ? 'ours' : 'corrupt';
	} catch {
		return 'corrupt';
	}
}
