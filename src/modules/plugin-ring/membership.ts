import type { Heartbeat } from './devices';
import type { RingSnapshot } from './types';

/**
 * Whether a snapshot's removals are about this device, in this ring.
 *
 * Removal used to be a bare list of device ids, and a device id outlives any
 * ring: it belongs to the install. So a host that had once removed a phone went
 * on publishing that into every ring it made afterwards, and the phone was
 * thrown out of a ring it had just joined for something that happened in
 * another one. Joining with the code is a deliberate act, and a removal only
 * counts when it came after it.
 *
 * When either time is missing the answer depends on which. A removal the host
 * did not date comes from an older build; it still counts for a device that
 * does not know when it joined either, because that device may well be the one
 * it was meant for — but not for one that joined since, which is the case that
 * went wrong. A dated removal against an undated join counts: nothing says the
 * device came back afterwards.
 */
export function isRemovedFrom(
	snapshot: Pick<RingSnapshot, 'removed' | 'removedAt'>,
	deviceId: string,
	ringSince: string | null
): boolean {
	if (snapshot.removed?.includes(deviceId) !== true) {
		return false;
	}

	const removed = Date.parse(snapshot.removedAt?.[deviceId] ?? '');
	const joined = Date.parse(ringSince ?? '');

	if (Number.isNaN(joined)) {
		return true;
	}
	if (Number.isNaN(removed)) {
		return false;
	}
	return removed > joined;
}

/**
 * The removed devices that have since come back with the code.
 *
 * Seen from the host: a heartbeat in this ring whose device joined after it was
 * removed. A removed device stops beating when it leaves, so a heartbeat that
 * names this ring and a later join can only come from somebody who typed the
 * code in again. Undated removals give way to any dated join, for the reason
 * {@link isRemovedFrom} gives.
 */
export function rejoinedSinceRemoval(
	beats: readonly Heartbeat[],
	options: {
		ringId: string;
		removed: readonly string[];
		removedAt: Readonly<Record<string, string>>;
	}
): string[] {
	const removed = new Set(options.removed);
	const back = new Set<string>();

	for (const beat of beats) {
		if (!removed.has(beat.deviceId) || beat.ring !== options.ringId) {
			continue;
		}
		const joined = Date.parse(beat.joinedAt ?? '');
		if (Number.isNaN(joined)) {
			continue;
		}
		const at = Date.parse(options.removedAt[beat.deviceId] ?? '');
		if (Number.isNaN(at) || joined > at) {
			back.add(beat.deviceId);
		}
	}

	return [...back];
}
