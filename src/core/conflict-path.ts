/**
 * The name a second version of a note gets when neither may replace the other.
 *
 * Deliberately shaped like the conflict copies other sync tools leave behind, so
 * `patterns.ts` in the vault sync already knows how to find them and the panel
 * can count them. A copy nobody looks at is the same as a lost edit.
 *
 * In core because two modules keep both versions: the vault sync when both
 * sides of a file changed, and live editing when a note changed on this device
 * in a way the room cannot be shown to already contain.
 */
export function conflictPath(path: string, when: Date): string {
	const stamp = when.toISOString().slice(0, 19).replace('T', ' ').replace(/:/g, '');
	const dot = path.lastIndexOf('.');
	const slash = path.lastIndexOf('/');

	const hasExtension = dot > slash + 1;
	const stem = hasExtension ? path.slice(0, dot) : path;
	const extension = hasExtension ? path.slice(dot) : '';

	return `${stem} (conflicted copy ${stamp})${extension}`;
}
