/**
 * An in-memory stand-in for an Obsidian vault.
 *
 * Enough of the API for the sync engine to run against: files with stats, binary
 * reads and writes, folders, the hidden-file adapter, and a trash that keeps what
 * it is given. Keeping the trash inspectable matters — several of the guarantees
 * this project makes are about things going to the trash rather than disappearing,
 * and a test can only hold us to that if it can look inside.
 */

interface FakeStat {
	mtime: number;
	size: number;
}

export interface FakeFile {
	path: string;
	name: string;
	extension: string;
	stat: FakeStat;
	parent: { path: string } | null;
}

function folderOf(path: string): string {
	const slash = path.lastIndexOf('/');
	return slash < 0 ? '' : path.slice(0, slash);
}

function nameOf(path: string): string {
	return path.slice(path.lastIndexOf('/') + 1);
}

function extensionOf(path: string): string {
	const name = nameOf(path);
	const dot = name.lastIndexOf('.');
	return dot <= 0 ? '' : name.slice(dot + 1);
}

export class FakeVault {
	readonly configDir = '.obsidian';
	readonly files = new Map<string, Uint8Array>();
	readonly folders = new Set<string>();
	/**
	 * On disk, but not in the file index.
	 *
	 * Two different things live here, and in Obsidian they are the same thing: files
	 * the index never carries (anything under the config folder), and files that are
	 * simply not indexed *yet* — what a sync client leaves behind when it drops a
	 * file into an open vault. Both are reachable through the adapter and invisible
	 * to `getFileByPath`, which is exactly the situation this models.
	 */
	readonly hidden = new Map<string, string>();
	readonly trashed: string[] = [];

	private clock = 1_000;

	/** The adapter is the disk: it sees indexed and unindexed files alike. */
	readonly adapter = {
		read: (path: string): Promise<string> => {
			const value = this.hidden.get(path) ?? this.text(path);
			return value === undefined
				? Promise.reject(new Error(`No such file: ${path}`))
				: Promise.resolve(value);
		},
		write: (path: string, data: string): Promise<void> => {
			if (this.files.has(path)) {
				this.put(path, data);
			} else {
				this.hidden.set(path, data);
			}
			return Promise.resolve();
		},
		exists: (path: string): Promise<boolean> =>
			Promise.resolve(
				this.hidden.has(path) ||
					this.files.has(path) ||
					this.folders.has(path) ||
					// A folder exists on disk as soon as something is in it, whether or
					// not the index has been told about either.
					[...this.hidden.keys(), ...this.files.keys()].some((other) =>
						other.startsWith(`${path}/`)
					)
			),
		mkdir: (): Promise<void> => Promise.resolve(),
		/** Everything directly inside a folder, indexed or not — the disk's view. */
		list: (path: string): Promise<{ files: string[]; folders: string[] }> => {
			const prefix = path === '' ? '' : `${path}/`;
			const files = new Set<string>();
			const folders = new Set<string>();

			for (const other of [...this.hidden.keys(), ...this.files.keys()]) {
				if (!other.startsWith(prefix)) {
					continue;
				}
				const rest = other.slice(prefix.length);
				const slash = rest.indexOf('/');
				if (slash < 0) {
					files.add(other);
				} else {
					folders.add(`${prefix}${rest.slice(0, slash)}`);
				}
			}

			return files.size + folders.size === 0 && !this.folders.has(path)
				? Promise.reject(new Error(`No such folder: ${path}`))
				: Promise.resolve({ files: [...files].sort(), folders: [...folders].sort() });
		},
	};

	readonly fileManager = {
		trashFile: (file: FakeFile): Promise<void> => {
			this.files.delete(file.path);
			this.trashed.push(file.path);
			return Promise.resolve();
		},
	};

	/** Writes a file the way a person would, advancing the clock as an edit does. */
	put(path: string, text: string): void {
		this.clock += 1;
		this.files.set(path, new TextEncoder().encode(text));
	}

	text(path: string): string | undefined {
		const bytes = this.files.get(path);
		return bytes === undefined ? undefined : new TextDecoder().decode(bytes);
	}

	remove(path: string): void {
		this.files.delete(path);
	}

	private stat(path: string): FakeStat {
		return { mtime: this.clock, size: this.files.get(path)?.byteLength ?? 0 };
	}

	private toFile(path: string): FakeFile {
		const parent = folderOf(path);
		return {
			path,
			name: nameOf(path),
			extension: extensionOf(path),
			stat: this.stat(path),
			parent: parent === '' ? null : { path: parent },
		};
	}

	readonly vault = {
		configDir: this.configDir,
		adapter: this.adapter,
		getFiles: (): FakeFile[] => [...this.files.keys()].sort().map((path) => this.toFile(path)),
		getMarkdownFiles: (): FakeFile[] =>
			this.vault.getFiles().filter((file) => file.extension === 'md'),
		getFileByPath: (path: string): FakeFile | null =>
			this.files.has(path) ? this.toFile(path) : null,
		getFolderByPath: (path: string): { path: string } | null =>
			this.folders.has(path) ? { path } : null,
		/**
		 * Throws on a folder that is already there, the way Obsidian does —
		 * including one that is on disk and not in the index, which is the case
		 * that stopped heartbeats being written at all.
		 */
		createFolder: (path: string): Promise<{ path: string }> => {
			if (this.folders.has(path)) {
				return Promise.reject(new Error(`Folder already exists: ${path}`));
			}
			const onDisk = [...this.hidden.keys(), ...this.files.keys()].some((other) =>
				other.startsWith(`${path}/`)
			);
			if (onDisk) {
				return Promise.reject(new Error(`Folder already exists: ${path}`));
			}
			this.folders.add(path);
			return Promise.resolve({ path });
		},
		readBinary: (file: FakeFile): Promise<ArrayBuffer> => {
			const bytes = this.files.get(file.path);
			if (!bytes) {
				return Promise.reject(new Error(`No such file: ${file.path}`));
			}
			return Promise.resolve(
				bytes.buffer.slice(
					bytes.byteOffset,
					bytes.byteOffset + bytes.byteLength
				) as ArrayBuffer
			);
		},
		createBinary: (path: string, data: ArrayBuffer): Promise<FakeFile> => {
			this.clock += 1;
			this.files.set(path, new Uint8Array(data));
			this.folders.add(folderOf(path));
			return Promise.resolve(this.toFile(path));
		},
		modifyBinary: (file: FakeFile, data: ArrayBuffer): Promise<void> => {
			this.clock += 1;
			this.files.set(file.path, new Uint8Array(data));
			return Promise.resolve();
		},
		read: (file: FakeFile): Promise<string> => Promise.resolve(this.text(file.path) ?? ''),
		/**
		 * Refuses a path that is already on disk, the way Obsidian does — including
		 * one the index has not caught up with, which is the whole point of the
		 * distinction.
		 */
		create: (path: string, contents: string): Promise<FakeFile> => {
			if (this.files.has(path) || this.hidden.has(path)) {
				return Promise.reject(new Error(`File already exists: ${path}`));
			}
			this.put(path, contents);
			this.folders.add(folderOf(path));
			return Promise.resolve(this.toFile(path));
		},
		modify: (file: FakeFile, contents: string): Promise<void> => {
			this.put(file.path, contents);
			return Promise.resolve();
		},
	};

	/** Shaped like the `App` the engine expects. */
	get app(): unknown {
		return { vault: this.vault, fileManager: this.fileManager };
	}
}
