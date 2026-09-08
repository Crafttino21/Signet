import type { ModuleDescriptor } from '../core/module';
import { exampleCommandModule } from './example-command';
import { exampleEventsModule } from './example-events';
import { exampleViewModule } from './example-view';

/**
 * Every module the plugin knows about. This list is the only place that needs
 * touching when a feature is added — the order here is the order shown in settings.
 */
export const TOOLBOX_MODULES: readonly ModuleDescriptor[] = [
	exampleCommandModule,
	exampleViewModule,
	exampleEventsModule,
];
