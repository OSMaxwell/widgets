import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';
import St from 'gi://St';

import { VERTICAL } from '../../compat.js';
import { lookupToken, normalizeHost } from '../../secret.js';

export const type = 'github';
export const label = 'GitHub Activity';
export const stylesheet = 'widgets/github/stylesheet.css';
export const defaultSize = 'medium';

const MAX_WEEKS = 53;
const INSET = 32; // .widget padding 15px + border 1px, both sides
const HEADER = 40;
const SPACING = 10;
const GAP = 3;
const REFRESH_SECONDS = 600;
const RETRY_SECONDS = 60;
export const LEVELS = ['NONE', 'FIRST_QUARTILE', 'SECOND_QUARTILE', 'THIRD_QUARTILE', 'FOURTH_QUARTILE'];
const GREENS = [null, '#0e4429', '#006d32', '#26a641', '#39d353'];
const QUERY = `{ viewer { url login name avatarUrl(size: 96) contributionsCollection { contributionCalendar {
  totalContributions weeks { contributionDays { contributionLevel } } } } } }`;

let session = null;
let cache = null; // {host, time, url, total, weeks}
let profileUrl = null;

export const endpoint = host => host === 'github.com'
  ? 'https://api.github.com/graphql'
  : `https://${host}/api/graphql`;

// Square size and week count that fill a widget of the given outer size.
export function gridLayout(width, height) {
  const cell = Math.floor((height - INSET - HEADER - SPACING - 6 * GAP) / 7);
  const weeks = Math.min(MAX_WEEKS, Math.floor((width - INSET + GAP) / (cell + GAP)));

  return {cell, weeks};
};

// GraphQL response -> {url, login, name, avatarUrl, total, weeks: number[][] of level indexes}.
export function parseCalendar(json) {
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  };

  const viewer = json.data.viewer;
  const calendar = viewer.contributionsCollection.contributionCalendar;

  return {
    url: viewer.url,
    login: viewer.login,
    name: viewer.name || viewer.login,
    avatarUrl: viewer.avatarUrl,
    total: calendar.totalContributions,
    weeks: calendar.weeks.slice(-MAX_WEEKS).map(week =>
      week.contributionDays.map(day => Math.max(0, LEVELS.indexOf(day.contributionLevel)))),
  };
};

async function request(method, url, token, body = null) {
  session ??= new Soup.Session({timeout: 20});

  const message = Soup.Message.new(method, url);
  message.request_headers.append('Authorization', `bearer ${token}`);
  message.request_headers.append('User-Agent', 'gnome-shell-widgets');

  if (body) {
    message.set_request_body_from_bytes('application/json',
      new GLib.Bytes(new TextEncoder().encode(JSON.stringify(body))));
  };

  const bytes = await new Promise((resolve, reject) => {
    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (_session, result) => {
      try {
        resolve(session.send_and_read_finish(result));
      } catch (error) {
        reject(error);
      };
    });
  });

  if (message.status_code !== 200) {
    throw new Error(`HTTP ${message.status_code}`);
  };

  return bytes.get_data();
};

async function fetchCalendar(host, token) {
  return parseCalendar(JSON.parse(new TextDecoder().decode(await request('POST', endpoint(host), token, {query: QUERY}))));
};

// Avatars on GHE usually need auth, so download with the token. One file per URL: St caches textures by path.
async function avatarFile(url, token) {
  const dir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'widgets']);
  const path = GLib.build_filenamev([dir, `github-${GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, url, -1)}.png`]);

  if (!GLib.file_test(path, GLib.FileTest.EXISTS)) {
    GLib.mkdir_with_parents(dir, 0o700);
    GLib.file_set_contents(path, await request('GET', url, token));
  };

  return path;
};

export function onClick(extension) {
  if (profileUrl) {
    Gio.AppInfo.launch_default_for_uri(profileUrl, null);
  } else {
    extension.openPreferences();
  };
};

export function style(theme) {
  return `background-color: ${theme.background}; border-color: ${theme.border}; color: ${theme.text};`;
};

export function render({body, createLabel, theme, settings, widget, sizeForWidget}) {
  const {cell, weeks} = gridLayout(...sizeForWidget(widget));
  const header = new St.BoxLayout({style_class: 'widget-github-header', x_expand: true});
  const avatar = new St.Widget({style_class: 'widget-github-avatar', style: `background-color: ${theme.border};`});
  const text = new St.BoxLayout({...VERTICAL, x_expand: true, y_align: Clutter.ActorAlign.CENTER});
  const title = createLabel('GitHub', 'widget-github-title', `color: ${theme.text};`);
  const subtitle = createLabel('', 'widget-github-subtitle', `color: ${theme.muted};`);
  const grid = new St.BoxLayout({style_class: 'widget-github-grid', x_align: Clutter.ActorAlign.CENTER, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
  const host = normalizeHost(settings.get_string('github-host'));
  let timeoutId = 0;
  let alive = true;

  title.clutter_text.set_line_wrap(false);
  text.add_child(title);
  text.add_child(subtitle);
  header.add_child(avatar);
  header.add_child(text);
  body.add_child(header);
  body.add_child(grid);

  const draw = data => {
    grid.destroy_all_children();
    title.text = data.name;
    subtitle.text = `${data.total.toLocaleString()} contributions this year`;

    if (data.avatarPath) {
      avatar.style = `background-image: url("file://${data.avatarPath}");`;
    };

    for (const week of data.weeks.slice(-weeks)) {
      const column = new St.BoxLayout({...VERTICAL, style_class: 'widget-github-week'});

      for (const level of week) {
        column.add_child(new St.Widget({
          style_class: 'widget-github-day',
          style: `width: ${cell}px; height: ${cell}px; background-color: ${GREENS[level] ?? theme.border};`,
        }));
      };

      grid.add_child(column);
    };
  };

  const schedule = seconds => {
    timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, seconds, () => {
      timeoutId = 0;
      update();
      return GLib.SOURCE_REMOVE;
    });
  };

  const update = async () => {
    try {
      if (cache?.host === host && GLib.get_monotonic_time() - cache.time < REFRESH_SECONDS * 1e6) {
        draw(cache);
        schedule(REFRESH_SECONDS);
        return;
      };

      const token = host ? await lookupToken(host) : null;

      if (!token) {
        profileUrl = null;
        alive && (title.text = 'Click to connect GitHub in Settings');
        alive && schedule(RETRY_SECONDS);
        return;
      };

      const data = await fetchCalendar(host, token);

      const avatarPath = data.avatarUrl
        ? await avatarFile(data.avatarUrl, token).catch(() => null)
        : null;

      cache = {...data, avatarPath, host, time: GLib.get_monotonic_time()};
      profileUrl = data.url;

      if (alive) {
        draw(cache);
        schedule(REFRESH_SECONDS);
      };
    } catch (error) {
      if (alive) {
        title.text = `GitHub: ${error.message}`;
        schedule(RETRY_SECONDS);
      };
    };
  };

  // body is reused across re-renders, so tie cleanup to our own child.
  grid.connect('destroy', () => {
    alive = false;

    if (timeoutId) {
      GLib.Source.remove(timeoutId);
    };
  });

  update();
};
