/**
 * Judging whether the sync is actually moving.
 *
 * Every device writes its own small heartbeat file. One writer per file means
 * these can never conflict with each other, unlike a single shared file — and
 * because they travel through the same sync as everything else, a heartbeat that
 * stops arriving *is* the symptom. It measures the existing sync rather than
 * replacing any part of it.
 */

export interface Heartbeat {
	deviceId: string;
	deviceName: string;
	/** ISO timestamp, written by that device with its own clock. */
	updatedAt: string;
}

export type DeviceStatus =
	/** Seen recently. */
	| 'fresh'
	/** Nothing has arrived from this device for a while. */
	| 'stale'
	/** The heartbeat exists but says nothing usable. */
	| 'unknown';

export interface DeviceHealth {
	deviceId: string;
	deviceName: string;
	status: DeviceStatus;
	/** Hours since the heartbeat, floored. Absent when the timestamp is unusable. */
	ageHours?: number;
	isSelf: boolean;
}

export interface HealthOptions {
	now: Date;
	staleAfterHours: number;
	/** This device's id, so it can be marked rather than warned about. */
	selfId: string;
}

const HOUR = 60 * 60 * 1000;

export function isHeartbeat(value: unknown): value is Heartbeat {
	if (typeof value !== 'object' || value === null) {
		return false;
	}
	const candidate = value as Partial<Heartbeat>;
	return (
		typeof candidate.deviceId === 'string' &&
		typeof candidate.deviceName === 'string' &&
		typeof candidate.updatedAt === 'string'
	);
}

/**
 * Turns the collected heartbeats into a per-device verdict.
 *
 * Clocks are not synchronised between devices, so a heartbeat dated slightly in
 * the future is normal rather than an error — it is treated as just-seen. Only
 * time that has genuinely passed counts towards going stale.
 */
export function evaluateHeartbeats(
	beats: readonly Heartbeat[],
	options: HealthOptions
): DeviceHealth[] {
	return beats
		.map((beat): DeviceHealth => {
			const isSelf = beat.deviceId === options.selfId;
			const seen = Date.parse(beat.updatedAt);

			if (Number.isNaN(seen)) {
				return {
					deviceId: beat.deviceId,
					deviceName: beat.deviceName,
					status: 'unknown',
					isSelf,
				};
			}

			// A negative age means the other device's clock runs ahead of ours.
			const ageHours = Math.max(0, Math.floor((options.now.getTime() - seen) / HOUR));

			return {
				deviceId: beat.deviceId,
				deviceName: beat.deviceName,
				status: ageHours >= options.staleAfterHours ? 'stale' : 'fresh',
				ageHours,
				isSelf,
			};
		})
		.sort((a, b) => (a.ageHours ?? Infinity) - (b.ageHours ?? Infinity));
}

/** Devices worth telling the user about — stale or unreadable, and not this one. */
export function devicesNeedingAttention(health: readonly DeviceHealth[]): DeviceHealth[] {
	return health.filter((device) => !device.isSelf && device.status !== 'fresh');
}
