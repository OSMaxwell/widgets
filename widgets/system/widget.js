import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

export const type = 'system';
export const label = 'System';
export const stylesheet = 'widgets/system/stylesheet.css';
export const defaultSize = 'small';

const REFRESH_SECONDS = 2;
const RAPL_ENERGY = '/sys/class/powercap/intel-rapl:0/energy_uj';

function read(path) {
	try {
		return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
	} catch {
		return null;
	};
};

// Aggregate "cpu" line of /proc/stat → [busy, total] jiffies.
export function cpuTimes(stat) {
	const fields = stat.split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
	const total = fields.reduce((a, b) => a + b, 0);
	const idle = fields[3] + (fields[4] ?? 0);

	return [total - idle, total];
};

// Returns [usedKiB, totalKiB].
export function memUsage(meminfo) {
	const value = key => Number(meminfo.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'))?.[1] ?? 0);
	const total = value('MemTotal');

	return [total - value('MemAvailable'), total];
};

function avgFreqGHz() {
	const khz = [];

	for (let cpu = 0; ; cpu++) {
		const value = read(`/sys/devices/system/cpu/cpu${cpu}/cpufreq/scaling_cur_freq`);

		if (value === null) {
			break;
		};

		khz.push(Number(value));
	};

	return khz.length ? khz.reduce((a, b) => a + b, 0) / khz.length / 1e6 : null;
};

function cpuTempC() {
	for (let i = 0; ; i++) {
		const name = read(`/sys/class/hwmon/hwmon${i}/name`);

		if (name === null) {
			return null;
		};

		if (['coretemp', 'k10temp', 'zenpower'].includes(name.trim())) {
			const milli = read(`/sys/class/hwmon/hwmon${i}/temp1_input`);

			return milli === null ? null : Number(milli) / 1000;
		};
	};
};

function gib(kib) {
	return (kib / 1048576).toFixed(1);
};

export function style(theme) {
	return `background-color: ${theme.background}; border-color: ${theme.border}; color: ${theme.text};`;
};

export function render({body, createLabel, theme}) {
	const rows = {};

	for (const [key, name] of [['kernel', 'Kernel'], ['cpu', 'CPU'], ['freq', 'Freq'], ['power', 'Power'], ['ram', 'RAM']]) {
		const row = new St.BoxLayout({style_class: 'widget-system-row', x_expand: true, y_expand: true, y_align: Clutter.ActorAlign.CENTER});
		const value = createLabel('–', 'widget-system-value', `color: ${theme.text};`);

		value.x_align = Clutter.ActorAlign.END;
		row.add_child(createLabel(name, 'widget-system-name', `color: ${theme.muted};`));
		row.add_child(value);
		body.add_child(row);
		rows[key] = {row, value};
	};

	const ram = new St.Widget({style_class: 'widget-system-bar', x_expand: true, style: `background-color: ${theme.border};`});

	rows.kernel.value.text = read('/proc/sys/kernel/osrelease')?.trim() ?? 'n/a';
	rows.kernel.value.add_style_class_name('widget-system-small');
	const ramFill = new St.Widget({style: `background-color: ${theme.accent}; border-radius: 3px;`});

	ram.add_child(ramFill);
	body.add_child(ram);

	let ramFraction = 0;
	const setRamFill = () => ramFill.set_size(ram.width * ramFraction, 6);
	let lastCpu = cpuTimes(read('/proc/stat') ?? 'cpu 0 0 0 0');
	let lastEnergy = null;
	let lastTime = GLib.get_monotonic_time();

	const update = () => {
		const now = GLib.get_monotonic_time();
		const cpu = cpuTimes(read('/proc/stat') ?? 'cpu 0 0 0 0');
		const dTotal = cpu[1] - lastCpu[1];

		rows.cpu.value.text = dTotal > 0 ? `${Math.round((cpu[0] - lastCpu[0]) / dTotal * 100)}%` : '–';
		lastCpu = cpu;

		const freq = avgFreqGHz();
		rows.freq.value.text = freq === null ? 'n/a' : `${freq.toFixed(2)} GHz`;

		// RAPL is root-only on most kernels (CVE-2020-8694); fall back to temperature.
		const energy = read(RAPL_ENERGY);

		if (energy !== null) {
			const uj = Number(energy);

			rows.power.value.text = lastEnergy !== null && uj >= lastEnergy
				? `${((uj - lastEnergy) / (now - lastTime)).toFixed(1)} W`
				: '–';
			lastEnergy = uj;
		} else {
			const temp = cpuTempC();

			rows.power.row.get_first_child().text = 'Temp';
			rows.power.value.text = temp === null ? 'n/a' : `${Math.round(temp)} °C`;
		};

		lastTime = now;

		const [used, total] = memUsage(read('/proc/meminfo') ?? '');
		rows.ram.value.text = `${gib(used)} / ${gib(total)} GiB`;
		ramFraction = total ? used / total : 0;
		setRamFill();
		return GLib.SOURCE_CONTINUE;
	};

	update();
	ram.connect('notify::width', setRamFill);

	const timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, update);

	// body is reused across re-renders (destroy_all_children), so tie the timer to our own child.
	ram.connect('destroy', () => GLib.Source.remove(timeoutId));
};
