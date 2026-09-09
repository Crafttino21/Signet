/**
 * Stand-in for the `obsidian` module, which only exists inside the Obsidian app
 * at runtime. `vitest.config.ts` aliases `obsidian` to this file.
 *
 * Only the surface the plugin actually imports is modelled here, and `Component`
 * reproduces the real load/unload semantics, since that is what the registry
 * relies on. Grow this file whenever a module starts importing something new —
 * a missing export shows up as a test-only failure that never happens in Obsidian.
 *
 * Note that types still come from the real `obsidian` package during typechecking;
 * this file is only substituted at test runtime.
 */

export interface EventRef {
	offref?: () => void;
}

export class Component {
	private loaded = false;
	private children: Component[] = [];
	private cleanups: Array<() => unknown> = [];

	load(): void {
		if (this.loaded) return;
		this.loaded = true;
		this.onload();
		for (const child of this.children) {
			child.load();
		}
	}

	onload(): void {}

	unload(): void {
		if (!this.loaded) return;
		this.loaded = false;

		let child = this.children.pop();
		while (child) {
			child.unload();
			child = this.children.pop();
		}

		let cleanup = this.cleanups.pop();
		while (cleanup) {
			cleanup();
			cleanup = this.cleanups.pop();
		}

		this.onunload();
	}

	onunload(): void {}

	addChild<T extends Component>(component: T): T {
		this.children.push(component);
		if (this.loaded) {
			component.load();
		}
		return component;
	}

	removeChild<T extends Component>(component: T): T {
		const index = this.children.indexOf(component);
		if (index >= 0) {
			this.children.splice(index, 1);
		}
		component.unload();
		return component;
	}

	register(cb: () => unknown): void {
		this.cleanups.push(cb);
	}

	registerEvent(eventRef: EventRef): void {
		this.register(() => eventRef.offref?.());
	}

	registerDomEvent(el: EventTarget, type: string, callback: EventListener): void {
		el.addEventListener(type, callback);
		this.register(() => el.removeEventListener(type, callback));
	}

	registerInterval(id: number): number {
		this.register(() => clearInterval(id));
		return id;
	}
}

export interface Command {
	id: string;
	name: string;
	icon?: string;
	callback?: () => unknown;
	checkCallback?: (checking: boolean) => boolean | void;
}

export class Plugin extends Component {
	/** Commands currently registered, keyed by their prefixed id. */
	readonly commands = new Map<string, Command>();
	/** Ribbon icons currently in the DOM. */
	readonly ribbonIcons: HTMLElement[] = [];
	constructor(
		public app: unknown = {},
		public manifest: { id: string } = { id: 'toolbox' }
	) {
		super();
	}

	addCommand(command: Command): Command {
		const registered = { ...command, id: `${this.manifest.id}:${command.id}` };
		this.commands.set(registered.id, registered);
		return registered;
	}

	removeCommand(commandId: string): void {
		this.commands.delete(commandId);
	}

	addRibbonIcon(_icon: string, title: string, callback: (evt: MouseEvent) => void): HTMLElement {
		const el = document.createElement('div');
		el.setAttribute('aria-label', title);
		el.addEventListener('click', callback as EventListener);
		document.body.appendChild(el);
		this.ribbonIcons.push(el);
		return el;
	}

	addStatusBarItem(): HTMLElement {
		return document.createElement('div');
	}

	addSettingTab(_tab: unknown): void {}

	loadData(): Promise<unknown> {
		return Promise.resolve(null);
	}

	saveData(_data: unknown): Promise<void> {
		return Promise.resolve();
	}
}

export class PluginSettingTab {
	containerEl: HTMLElement = document.createElement('div');

	constructor(
		public app: unknown,
		public plugin: unknown
	) {}

	display(): void {}
	hide(): void {}
}

class ValueComponent {
	setPlaceholder(_value: string): this {
		return this;
	}
	setValue(_value: unknown): this {
		return this;
	}
	onChange(_cb: (value: never) => unknown): this {
		return this;
	}
}

export class Setting {
	constructor(public containerEl: HTMLElement) {}

	setName(_name: string): this {
		return this;
	}
	setDesc(_desc: string): this {
		return this;
	}
	setHeading(): this {
		return this;
	}
	addText(cb: (component: ValueComponent) => unknown): this {
		cb(new ValueComponent());
		return this;
	}
	addToggle(cb: (component: ValueComponent) => unknown): this {
		cb(new ValueComponent());
		return this;
	}
	addTextArea(cb: (component: ValueComponent) => unknown): this {
		cb(new ValueComponent());
		return this;
	}
}

export class Notice {
	constructor(public message: string) {}
	hide(): void {}
}

export interface RequestUrlParam {
	url: string;
	method?: string;
	body?: string | ArrayBuffer;
	headers?: Record<string, string>;
	throw?: boolean;
}

export interface RequestUrlResponse {
	status: number;
	text: string;
	json: unknown;
	arrayBuffer: ArrayBuffer;
}

/**
 * Obsidian's CORS-free HTTP call. The stub goes through `fetch`, which is enough
 * for tests to talk to a real server over a real socket.
 */
export async function requestUrl(request: RequestUrlParam | string): Promise<RequestUrlResponse> {
	const options = typeof request === 'string' ? { url: request } : request;
	const response = await fetch(options.url, {
		method: options.method ?? 'GET',
		headers: options.headers,
		body: options.body as BodyInit | undefined,
	});

	const arrayBuffer = await response.arrayBuffer();
	const text = new TextDecoder().decode(arrayBuffer);

	return {
		status: response.status,
		text,
		get json(): unknown {
			return JSON.parse(text) as unknown;
		},
		arrayBuffer,
	};
}

/** Obsidian's UI language. Tests drive the locale through initI18n() instead. */
export function getLanguage(): string {
	return 'en';
}

export function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

/**
 * Enough of a view to satisfy an `instanceof` check. The sync indicator picks
 * markdown views out of the workspace that way, and a test that imports the
 * module it lives in would otherwise fail on a name that is not there.
 */
export class MarkdownView {
	file: { path: string } | null = null;

	addAction(_icon: string, _title: string, _callback: () => void): HTMLElement {
		return document.createElement('div');
	}
}

/** Draws an icon into an element. Tests only care that it does not throw. */
export function setIcon(element: HTMLElement, icon: string): void {
	element.setAttribute('data-icon', icon);
}

/** Which platform Obsidian thinks it is on. Tests run as the desktop app. */
export const Platform = {
	isDesktopApp: true,
	isMobile: false,
};
