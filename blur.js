import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { warn } from './logger.js';

// Prefers Glass my Shell's public API (global.glass_my_shell); otherwise
// uses Blur my Shell's pipeline code the same way its own components do (via global.blur_my_shell).
// Widgets get a "Widgets" pipeline that is editable in Blur my Shell's preferences.
export const BMS_UUID = 'blur-my-shell@aunetx';
export const BLUR_UUIDS = [BMS_UUID, 'glass-my-shell@osmaxwell'];
const PIPELINE_NAME = 'Widgets';
const CORNER_RADIUS = 26; // matches .widget border-radius in stylesheet.css

let Pipeline = null;

export function blurAvailable() {
  return Boolean(global.glass_my_shell || (Pipeline && global.blur_my_shell?._pipelines_manager));
}

export async function loadBlur() {
  const bms = global.blur_my_shell;

  if (!bms?.path) {
    Pipeline = null;
    return;
  }

  try {
    ({Pipeline} = await import(`file://${bms.path}/conveniences/pipeline.js`));
  } catch (error) {
    Pipeline = null;
    warn('bms-import', `Blur my Shell pipeline unavailable: ${error.message}`);
  }
}

function pipelineId(bms) {
  const manager = bms._pipelines_manager;
  const existing = Object.entries(manager.pipelines).find(([, pipeline]) => pipeline.name === PIPELINE_NAME);

  if (existing) {
    return existing[0];
  }

  const settings = bms.getSettings();

  return manager.create_pipeline(PIPELINE_NAME, [
    {type: 'native_static_gaussian_blur', params: {
      radius: settings.get_value('sigma').deep_unpack(),
      brightness: settings.get_value('brightness').deep_unpack(),
    }},
    {type: 'corner', params: {radius: CORNER_RADIUS, corners_top: true, corners_bottom: true}},
  ]);
}

// Puts a blurred wallpaper copy behind `actor`, clipped to its bounds. `layer` must span the primary monitor.
export function attachBlur(actor, layer) {
  // Glass my Shell returns null while Blur my Shell is active; fall through to it then.
  if (global.glass_my_shell?.attach(actor, {radius: CORNER_RADIUS})) {
    return;
  }

  if (!blurAvailable()) {
    return;
  }

  const bms = global.blur_my_shell;

  try {
    const group = new Meta.BackgroundGroup({width: 0, height: 0});
    const managers = [];
    const pipeline = new Pipeline(bms._effects_manager, bms._pipelines_manager, pipelineId(bms));
    const background = pipeline.create_background_with_effects(
      Main.layoutManager.primaryIndex, managers, group, 'widgets-blur', false);
    const sync = () => background.set_clip(actor.x, actor.y - background.y, actor.width, actor.height);

    layer.insert_child_below(group, actor);
    sync();
    actor.connectObject('notify::allocation', sync, 'destroy', () => group.destroy(), group);
    group.connect('destroy', () => {
      actor.disconnectObject(group);

      try {
        pipeline.destroy();
        managers.forEach(manager => manager.destroy());
      } catch (error) {
        warn('bms-cleanup', `Blur cleanup failed: ${error.message}`);
      }
    });
  } catch (error) {
    warn('bms-attach', `Could not blur widget: ${error.message}`);
  }
}
