import { describe, expect, it } from 'vitest';
import {
	BEAT_EVERY_MINUTES,
	buildRoster,
	HERE_WITHIN_MINUTES,
	isHeartbeat,
	isHereNow,
} from './devices';
import type { DeviceHealth, Heartbeat } from './devices';
import { randomDeviceName } from '../../core/device-name';

/**
 * The roster is the list somebody acts on — removes a device, hands the ring
 * over — so the order and the labelling are not decoration. This device first
 * because it is the one you are looking from, the host second because it is the
 * one the others follow, and the rest by how recently they were here.
 */

const NOW = new Date('2026-09-10T12:00:00.000Z');

function beat(id: string, name: string, minutesAgo: number): Heartbeat {
	return {
		deviceId: id,
		deviceName: name,
		updatedAt: new Date(NOW.getTime() - minutesAgo * 60_000).toISOString(),
	};
}

function roster(beats: Heartbeat[], selfId = 'me', hostId: string | null = 'host') {
	return buildRoster(beats, { now: NOW, staleAfterMinutes: 15, selfId, hostId });
}

describe('buildRoster', () => {
	it('puts this device first, then the host, then the rest by freshness', () => {
		const list = roster([
			beat('other', 'Quiet Otter 07', 3),
			beat('stale', 'Amber Heron 42', 900),
			beat('host', 'Golden Lynx 11', 30),
			beat('me', 'Tidy Wren 03', 1),
		]);

		expect(list.map((device) => device.deviceId)).toEqual(['me', 'host', 'other', 'stale']);
	});

	it('marks this device and the host', () => {
		const [self, host] = roster([beat('me', 'Me', 0), beat('host', 'Host', 1)]);

		expect(self?.isSelf).toBe(true);
		expect(self?.isHost).toBe(false);
		expect(host?.isHost).toBe(true);
		expect(host?.isSelf).toBe(false);
	});

	it('calls a device stale once it has been away long enough', () => {
		const [fresh, stale] = roster([beat('a', 'A', 14), beat('b', 'B', 16)], 'none', null);

		expect(fresh?.status).toBe('fresh');
		expect(stale?.status).toBe('stale');
		expect(stale?.ageMinutes).toBe(16);
	});

	it('treats a clock that runs ahead as just seen', () => {
		// Two devices rarely agree to the second, and a negative age would read as
		// a device that has not been here for minus three minutes.
		const [device] = roster([beat('a', 'A', -3)], 'none', null);

		expect(device?.ageMinutes).toBe(0);
		expect(device?.status).toBe('fresh');
	});

	it('keeps an unreadable timestamp in the list rather than dropping it', () => {
		// The device is in the ring either way, and a roster that silently omits
		// one is worse than a roster that says it cannot tell.
		const [device] = roster(
			[{ deviceId: 'a', deviceName: 'A', updatedAt: 'soon' }],
			'none',
			null
		);

		expect(device?.status).toBe('unknown');
		expect(device?.ageMinutes).toBeUndefined();
	});
});

describe('isHeartbeat', () => {
	it('accepts what a device writes and refuses the rest', () => {
		expect(isHeartbeat(beat('a', 'A', 0))).toBe(true);
		expect(isHeartbeat({ deviceId: '', deviceName: 'A', updatedAt: 'x' })).toBe(false);
		expect(isHeartbeat({ deviceId: 'a', updatedAt: 'x' })).toBe(false);
		expect(isHeartbeat(null)).toBe(false);
		expect(isHeartbeat('a heartbeat')).toBe(false);
	});
});

describe('randomDeviceName', () => {
	it('is two words and a number', () => {
		expect(randomDeviceName()).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+ \d{2}$/);
	});

	it('rarely repeats itself', () => {
		// The point of the name is telling devices apart, so a handful of them
		// landing on the same one would defeat it.
		const names = new Set(Array.from({ length: 50 }, () => randomDeviceName()));
		expect(names.size).toBeGreaterThan(45);
	});
});

/**
 * A device that is sitting there open must not read as absent.
 *
 * It writes itself every five minutes, so at any moment the newest heartbeat
 * is up to five minutes old — and while "here now" meant "under two minutes",
 * a device in active use looked away for three minutes out of every five.
 */
describe('isHereNow', () => {
	function device(ageMinutes: number | undefined, isSelf = false): DeviceHealth {
		return {
			deviceId: 'a',
			deviceName: 'A',
			status: 'fresh',
			ageMinutes,
			isSelf,
			isHost: false,
		};
	}

	it('covers a whole beat cycle, with room for the trip and the clocks', () => {
		expect(HERE_WITHIN_MINUTES).toBeGreaterThan(BEAT_EVERY_MINUTES);
		for (let age = 0; age <= BEAT_EVERY_MINUTES; age += 1) {
			expect(isHereNow(device(age)), `age ${String(age)}`).toBe(true);
		}
	});

	it('stops claiming presence for a device that really has been away', () => {
		expect(isHereNow(device(HERE_WITHIN_MINUTES))).toBe(false);
		expect(isHereNow(device(60))).toBe(false);
	});

	it('always counts this device, which needs no heartbeat to be here', () => {
		expect(isHereNow(device(undefined, true))).toBe(true);
	});

	it('does not guess for an unreadable timestamp', () => {
		expect(isHereNow(device(undefined))).toBe(false);
	});
});
