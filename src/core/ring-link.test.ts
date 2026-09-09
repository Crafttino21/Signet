import { describe, expect, it, vi } from 'vitest';
import { RingLink } from './ring-link';

/**
 * The seam between the ring and the sync.
 *
 * Small, but it carries the promise that joining a ring is all anyone has to do:
 * the sync module puts its server address in, the ring publishes it, and every
 * other device hears it. What is checked here is that nothing falls through the
 * gap — particularly that a module which starts after the snapshot was already
 * read still learns about it.
 */

describe('what the ring carries', () => {
	it('hands what the host contributed to whoever publishes', () => {
		const link = new RingLink();
		link.contribute({ serverUrl: 'http://10.0.0.2:8787' });

		expect(link.contribution()).toEqual({ serverUrl: 'http://10.0.0.2:8787' });
	});

	it('keeps what was contributed earlier when only part is updated', () => {
		const link = new RingLink();
		link.contribute({ serverUrl: 'http://10.0.0.2:8787' });
		link.contribute({});

		expect(link.contribution()).toEqual({ serverUrl: 'http://10.0.0.2:8787' });
	});

	it('tells listeners what the host said', () => {
		const link = new RingLink();
		const heard = vi.fn();
		link.onAnnounce(heard);

		link.announce({ serverUrl: 'https://sync.example.com' });

		expect(heard).toHaveBeenCalledWith({ serverUrl: 'https://sync.example.com' });
	});

	it('replays the last announcement to a listener that arrives late', () => {
		// Module load order is not something a feature should have to reason about.
		const link = new RingLink();
		link.announce({ serverUrl: 'https://sync.example.com' });

		const heard = vi.fn();
		link.onAnnounce(heard);

		expect(heard).toHaveBeenCalledWith({ serverUrl: 'https://sync.example.com' });
	});

	it('says nothing to a listener that has unsubscribed', () => {
		const link = new RingLink();
		const heard = vi.fn();
		const stop = link.onAnnounce(heard);
		stop();

		link.announce({ serverUrl: 'https://sync.example.com' });

		expect(heard).not.toHaveBeenCalled();
	});

	it('hands out copies, so a listener cannot rewrite what the ring said', () => {
		const link = new RingLink();
		link.announce({ serverUrl: 'https://sync.example.com' });

		link.onAnnounce((info) => {
			info.serverUrl = 'http://somewhere-else.invalid';
		});
		const second = vi.fn();
		link.onAnnounce(second);

		expect(second).toHaveBeenCalledWith({ serverUrl: 'https://sync.example.com' });
	});

	it('passes a request to publish to the ring', () => {
		const link = new RingLink();
		const publish = vi.fn();
		link.onPublishRequest(publish);

		link.requestPublish();

		expect(publish).toHaveBeenCalledOnce();
	});

	it('drops a request to publish when nobody is listening', () => {
		// Every device that is not the host, which is most of them.
		const link = new RingLink();

		expect(() => {
			link.requestPublish();
		}).not.toThrow();
	});
});
