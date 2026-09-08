import { describe, expect, it } from 'vitest';
import { devicesNeedingAttention, evaluateHeartbeats, isHeartbeat } from './health';
import type { Heartbeat } from './health';

const now = new Date('2026-09-08T12:00:00.000Z');
const options = { now, staleAfterHours: 24, selfId: 'desktop' };

function beat(over: Partial<Heartbeat> & { deviceId: string }): Heartbeat {
	return { deviceName: over.deviceId, updatedAt: now.toISOString(), ...over };
}

describe('evaluateHeartbeats', () => {
	it('counts a recent heartbeat as fresh', () => {
		const [device] = evaluateHeartbeats(
			[beat({ deviceId: 'phone', updatedAt: '2026-09-08T10:00:00.000Z' })],
			options
		);

		expect(device).toMatchObject({ status: 'fresh', ageHours: 2, isSelf: false });
	});

	it('counts a device that has not been seen for a day as stale', () => {
		const [device] = evaluateHeartbeats(
			[
				beat({
					deviceId: 'phone',
					deviceName: 'Handy',
					updatedAt: '2026-09-04T12:00:00.000Z',
				}),
			],
			options
		);

		expect(device).toMatchObject({ status: 'stale', ageHours: 96, deviceName: 'Handy' });
	});

	it('does not raise an alarm when another clock runs ahead', () => {
		// Devices do not share a clock. A heartbeat from the near future means the
		// other device is ahead, not that something is wrong.
		const [device] = evaluateHeartbeats(
			[beat({ deviceId: 'phone', updatedAt: '2026-09-08T12:30:00.000Z' })],
			options
		);

		expect(device).toMatchObject({ status: 'fresh', ageHours: 0 });
	});

	it('marks an unusable timestamp as unknown rather than guessing', () => {
		const [device] = evaluateHeartbeats(
			[beat({ deviceId: 'phone', updatedAt: 'gestern' })],
			options
		);

		expect(device).toMatchObject({ status: 'unknown' });
		expect(device?.ageHours).toBeUndefined();
	});

	it('marks this device as itself', () => {
		const [device] = evaluateHeartbeats([beat({ deviceId: 'desktop' })], options);
		expect(device?.isSelf).toBe(true);
	});

	it('lists the most recently seen device first', () => {
		const health = evaluateHeartbeats(
			[
				beat({ deviceId: 'old', updatedAt: '2026-09-01T12:00:00.000Z' }),
				beat({ deviceId: 'new', updatedAt: '2026-09-08T11:00:00.000Z' }),
			],
			options
		);

		expect(health.map((device) => device.deviceId)).toEqual(['new', 'old']);
	});
});

describe('devicesNeedingAttention', () => {
	it('reports stale and unknown devices but never this one', () => {
		const health = evaluateHeartbeats(
			[
				beat({ deviceId: 'desktop', updatedAt: '2026-01-01T00:00:00.000Z' }),
				beat({ deviceId: 'phone', updatedAt: '2026-09-01T12:00:00.000Z' }),
				beat({ deviceId: 'tablet' }),
			],
			options
		);

		// The desktop is ancient too, but warning about the device you are looking
		// at helps nobody.
		expect(devicesNeedingAttention(health).map((device) => device.deviceId)).toEqual(['phone']);
	});
});

describe('isHeartbeat', () => {
	it('rejects anything that is not a heartbeat', () => {
		expect(isHeartbeat(null)).toBe(false);
		expect(isHeartbeat({ deviceId: 'a' })).toBe(false);
		expect(isHeartbeat({ deviceId: 'a', deviceName: 'b', updatedAt: 1 })).toBe(false);
		expect(isHeartbeat({ deviceId: 'a', deviceName: 'b', updatedAt: 'c' })).toBe(true);
	});
});
