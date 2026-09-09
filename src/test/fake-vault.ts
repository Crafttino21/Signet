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
	/** Hidden files, reached only through the adapter, exactly as in Obsidian. */
	readonly hidden = new Map<string, string>();
	readonly trashed: string[] = [];

	private clock = 1_000;

	readonly adapter = {
		read: (path: string): Promise<string> => {
			const value = this.hidden.get(path);
			return value === undefined
				? Promise.reject(new Error(`No such file: ${path}`))
				: Promise.resolve(value);
		},
		write: (path: string, data: string): Promise<void> => {
			this.hidden.set(path, data);
			return Promise.resolve();
		},
		exists: (path: string): Promise<boolean> => Promise.resolve(this.hidden.has(path)),
		mkdir: (): Promise<void> => Promise.resolve(),
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
		createFolder: (path: string): Promise<{ path: string }> => {
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
	};

	/** Shaped like the `App` the engine expects. */
	get app(): unknown {
		return { vault: this.vault, fileManager: this.fileManager };
	}
}
