import type { ModuleDescriptor } from '../core/module';
import { pluginRingModule } from './plugin-ring';

/**
 * Every module the plugin knows about. This list is the only place that needs
 * touching when a feature is added — the order here is the order shown in settings.
 */
export const TOOLBOX_MODULES: readonly ModuleDescriptor[] = [pluginRingModule];
