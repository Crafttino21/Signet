/**
 * A name for this device, when nobody has given it one.
 *
 * A ring full of "Desktop", "Desktop" and "Mobile device" is a list you cannot
 * act on: the whole point of the roster is deciding which device to remove or
 * hand the ring to, and that needs names that differ. So one is made up on
 * first run and written into the settings like any other, where it can be
 * changed to something meaningful whenever the user cares to.
 *
 * The words are here rather than in the translations on purpose. A device name
 * is data: it is written into the vault, read by every other device, and shown
 * on machines whose interface language is not necessarily this one. A name that
 * changed with the reader's locale would be a different device to each of them.
 */

const ADJECTIVES = [
	'amber',
	'bright',
	'calm',
	'clever',
	'copper',
	'crimson',
	'eager',
	'gentle',
	'golden',
	'hidden',
	'ivory',
	'jolly',
	'keen',
	'lively',
	'lucky',
	'mellow',
	'nimble',
	'olive',
	'patient',
	'quiet',
	'rapid',
	'silver',
	'steady',
	'sunny',
	'tidy',
	'velvet',
	'wandering',
	'witty',
];

const NOUNS = [
	'otter',
	'heron',
	'badger',
	'falcon',
	'marten',
	'lynx',
	'raven',
	'ibex',
	'weasel',
	'plover',
	'beaver',
	'osprey',
	'stoat',
	'kestrel',
	'puffin',
	'salmon',
	'hare',
	'shrew',
	'grebe',
	'marmot',
	'wren',
	'pika',
	'sable',
	'auk',
];

function capitalise(word: string): string {
	return word.charAt(0).toUpperCase() + word.slice(1);
}

/** A random unsigned integer. `getRandomValues` fills the array it is given. */
function randomNumber(): number {
	return crypto.getRandomValues(new Uint32Array(1))[0] ?? 0;
}

function pick(list: readonly string[]): string {
	return list[randomNumber() % list.length] ?? list[0] ?? '';
}

/** Two words and a number: enough to tell four devices apart at a glance. */
export function randomDeviceName(): string {
	const tail = String(randomNumber() % 100).padStart(2, '0');
	return `${capitalise(pick(ADJECTIVES))} ${capitalise(pick(NOUNS))} ${tail}`;
}
