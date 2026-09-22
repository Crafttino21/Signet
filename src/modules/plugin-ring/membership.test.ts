import { describe, expect, it } from 'vitest';
import { isRemovedFrom, rejoinedSinceRemoval } from './membership';
import type { Heartbeat } from './devices';

/**
 * Removal is a message to one device, and a device id outlives any ring. What
 * follows is what stops that message reaching a device in a ring it was never
 * sent in — the phone that was thrown out of a new ring the moment it joined.
 */

const BEFORE = '2026-09-01T10:00:00.000Z';
const JOINED = '2026-09-10T10:00:00.000Z';
const AFTER = '2026-09-10T12:00:00.000Z';

describe('isRemovedFrom', () => {
	it('is not about a device the list does not name', () => {
		expect(isRemovedFrom({ removed: ['other'] }, 'phone', JOINED)).toBe(false);
		expect(isRemovedFrom({}, 'phone', null)).toBe(false);
	});

	it('does not reach a device that joined after an undated removal', () => {
		// The case that went wrong: the host carried the removal over from an old
		// ring, without a time, and the phone had just joined the new one.
		expect(isRemovedFrom({ removed: ['phone'] }, 'phone', JOINED)).toBe(false);
	});

	it('does not reach a device that joined again after it was removed', () => {
		expect(
			isRemovedFrom({ removed: ['phone'], removedAt: { phone: BEFORE } }, 'phone', JOINED)
		).toBe(false);
	});

	it('reaches a device removed after it joined', () => {
		expect(
			isRemovedFrom({ removed: ['phone'], removedAt: { phone: AFTER } }, 'phone', JOINED)
		).toBe(true);
	});

	it('reaches a device that does not know when it joined, as it always did', () => {
		expect(isRemovedFrom({ removed: ['phone'] }, 'phone', null)).toBe(true);
		expect(
			isRemovedFrom({ removed: ['phone'], removedAt: { phone: AFTER } }, 'phone', null)
		).toBe(true);
	});
});

describe('rejoinedSinceRemoval', () => {
	function beat(id: string, ring: string, joinedAt?: string): Heartbeat {
		return {
			deviceId: id,
			deviceName: id,
			updatedAt: AFTER,
			ring,
			...(joinedAt !== undefined ? { joinedAt } : {}),
		};
	}

	const removed = ['phone'];

	it('lets a device back in that joined this ring after it was removed', () => {
		expect(
			rejoinedSinceRemoval([beat('phone', 'ring', AFTER)], {
				ringId: 'ring',
				removed,
				removedAt: { phone: JOINED },
			})
		).toEqual(['phone']);
	});

	it('lets a device back in over a removal nobody dated', () => {
		expect(
			rejoinedSinceRemoval([beat('phone', 'ring', JOINED)], {
				ringId: 'ring',
				removed,
				removedAt: {},
			})
		).toEqual(['phone']);
	});

	it('keeps a removal the device has not answered yet', () => {
		// Still beating from before it read the snapshot that removed it.
		expect(
			rejoinedSinceRemoval([beat('phone', 'ring', BEFORE)], {
				ringId: 'ring',
				removed,
				removedAt: { phone: JOINED },
			})
		).toEqual([]);
	});

	it('ignores a heartbeat from another ring, or one without a join', () => {
		expect(
			rejoinedSinceRemoval([beat('phone', 'other', AFTER), beat('phone', 'ring')], {
				ringId: 'ring',
				removed,
				removedAt: {},
			})
		).toEqual([]);
	});
});
