// SPDX-License-Identifier: GPL-3.0-or-later

// A local water log with a daily goal and an hourly view of today's drinks.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {VERTICAL} from '../compat.js';
import {icon, label} from '../widgets.js';
import {Page} from './page.js';

const DEFAULT_GOAL_ML = 2000;
const DEFAULT_SERVING_ML = 250;
const CHART_HOURS = 12;

function litres(ml) {
    return `${(ml / 1000).toFixed(1)} L`;
}

export const WaterPage = GObject.registerClass(
class WaterPage extends Page {
    _init(daemon, settings, {height}) {
        super._init(daemon, {
            style_class: 'isle-page isle-water',
            layout_manager: new Clutter.BinLayout(),
            height,
        });
        this.name = 'water';
        this._settings = settings;
        this._entries = [];

        const layout = new St.BoxLayout({style_class: 'isle-water-layout', x_expand: true, y_expand: true});
        const summary = new St.BoxLayout({...VERTICAL, style_class: 'isle-water-summary', y_align: Clutter.ActorAlign.CENTER});

        const heading = new St.BoxLayout({style_class: 'isle-water-heading'});
        heading.add_child(new St.Icon({gicon: icon('isle-water-blue'), icon_size: 16}));
        heading.add_child(label('Water Reminder', 'isle-water-title'));
        summary.add_child(heading);

        const amount = new St.BoxLayout({style_class: 'isle-water-amount', y_align: Clutter.ActorAlign.CENTER});
        this._total = label('0.0', 'isle-water-total');
        this._goal = label('/ 2.0 L', 'isle-water-goal');
        amount.add_child(this._total);
        amount.add_child(this._goal);
        summary.add_child(amount);

        this._status = label('Today · 0% · 2.0 L left', 'isle-water-status');
        summary.add_child(this._status);

        this._progressTrack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'isle-water-progress-track',
            x_expand: true,
        });
        this._progressFill = new St.Widget({
            style_class: 'isle-water-progress-fill',
            x_align: Clutter.ActorAlign.START,
            y_expand: true,
        });
        this._progressTrack.add_child(this._progressFill);
        this._progressTrack.connect('notify::width', () => this._syncProgress());
        summary.add_child(this._progressTrack);

        const actions = new St.BoxLayout({style_class: 'isle-water-actions'});
        const drinkContents = new St.BoxLayout({style_class: 'isle-water-button-contents'});
        drinkContents.add_child(new St.Icon({gicon: icon('isle-water'), icon_size: 13}));
        this._drinkLabel = label('', 'isle-water-button-label');
        drinkContents.add_child(this._drinkLabel);
        this._drinkButton = new St.Button({
            style_class: 'isle-water-button isle-water-drink',
            child: drinkContents,
            can_focus: true,
            accessible_name: 'Log a drink of water',
        });
        this._drinkButton.connect('clicked', () => this._drink());
        actions.add_child(this._drinkButton);

        const settingsContents = new St.BoxLayout({style_class: 'isle-water-button-contents'});
        settingsContents.add_child(new St.Icon({gicon: icon('isle-settings'), icon_size: 13}));
        settingsContents.add_child(label('Settings', 'isle-water-button-label'));
        const settingsButton = new St.Button({
            style_class: 'isle-water-button isle-water-settings',
            child: settingsContents,
            can_focus: true,
            accessible_name: 'Water tracker settings',
        });
        settingsButton.connect('clicked', () => this.emit('settings-requested'));
        actions.add_child(settingsButton);
        summary.add_child(actions);
        layout.add_child(summary);

        this._chart = new St.DrawingArea({style_class: 'isle-water-chart', x_expand: true, y_expand: true});
        this._chart.connect('repaint', area => this._paintChart(area));
        layout.add_child(this._chart);
        this.add_child(layout);

        this.watch(['waterEntries'], () => this._update());
        this._settingsChanged = [
            settings.connect('changed::water-goal-ml', () => this._update()),
            settings.connect('changed::water-serving-ml', () => this._syncDrinkLabel()),
        ];
        this.connect('destroy', () => this._settingsChanged.forEach(id => settings.disconnect(id)));
        this._update();
    }

    _todayEntries() {
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start);
        end.setDate(end.getDate() + 1);
        return (this.daemon.state.waterEntries ?? []).filter(entry =>
            entry.at_ms >= start.getTime() && entry.at_ms < end.getTime());
    }

    _update() {
        this._entries = this._todayEntries();
        const total = this._entries.reduce((sum, entry) => sum + entry.amount_ml, 0);
        const goal = this._settings.get_int('water-goal-ml') || DEFAULT_GOAL_ML;
        const percent = Math.round(total / goal * 100);
        this._total.text = (total / 1000).toFixed(1);
        this._goal.text = `/ ${litres(goal)}`;
        this._status.text = total >= goal
            ? `Today · ${percent}% · Goal reached`
            : `Today · ${percent}% · ${litres(goal - total)} left`;
        this._syncDrinkLabel();
        this._syncProgress(total / goal);
        this._chart.queue_repaint();
    }

    _syncDrinkLabel() {
        const amount = this._settings.get_int('water-serving-ml') || DEFAULT_SERVING_ML;
        this._drinkLabel.text = `Drink · ${amount} ml`;
    }

    _syncProgress(fraction = null) {
        if (!this._progressTrack || !this._progressFill)
            return;
        if (fraction === null) {
            const goal = this._settings.get_int('water-goal-ml') || DEFAULT_GOAL_ML;
            const total = this._entries.reduce((sum, entry) => sum + entry.amount_ml, 0);
            fraction = total / goal;
        }
        this._progressFill.width = Math.max(0, this._progressTrack.width * Math.min(1, fraction));
    }

    _drink() {
        const amount = this._settings.get_int('water-serving-ml') || DEFAULT_SERVING_ML;
        this.daemon.call('water', 'Drink', amount);
    }

    _paintChart(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }

        const now = new Date();
        const startHour = Math.max(0, now.getHours() - 6);
        const hourly = Array(CHART_HOURS).fill(0);
        for (const entry of this._entries) {
            const hour = new Date(entry.at_ms).getHours();
            const index = hour - startHour;
            if (index >= 0 && index < CHART_HOURS)
                hourly[index] += entry.amount_ml;
        }
        const peak = Math.max(0, ...hourly);
        const scale = Math.max(400, Math.ceil(peak / 200) * 200);
        const left = 4;
        const right = 30;
        const top = 8;
        const bottom = 22;
        const plotWidth = Math.max(1, width - left - right);
        const plotHeight = Math.max(1, height - top - bottom);

        cr.setLineWidth(1);
        cr.setSourceRGBA(1, 1, 1, 0.1);
        for (const fraction of [0, 0.5, 1]) {
            const y = top + plotHeight * (1 - fraction);
            cr.moveTo(left, y);
            cr.lineTo(left + plotWidth, y);
            cr.stroke();
        }

        cr.selectFontFace('Inter', 0, 0);
        cr.setFontSize(9);
        cr.setSourceRGBA(1, 1, 1, 0.42);
        cr.moveTo(left + plotWidth + 5, top + 3);
        cr.showText(`${scale}`);
        cr.moveTo(left + plotWidth + 5, top + plotHeight / 2 + 3);
        cr.showText(`${Math.round(scale / 2)}`);
        cr.moveTo(left + plotWidth + 5, top + plotHeight + 3);
        cr.showText('0 ml');

        const slot = plotWidth / CHART_HOURS;
        const barWidth = Math.min(10, slot * 0.58);
        for (let index = 0; index < CHART_HOURS; index++) {
            const barHeight = Math.min(plotHeight, hourly[index] / scale * plotHeight);
            if (barHeight > 0) {
                const x = left + slot * index + (slot - barWidth) / 2;
                const y = top + plotHeight - barHeight;
                const radius = Math.min(barWidth / 2, barHeight / 2, 5);
                cr.setSourceRGBA(0.22, 0.68, 1, 0.9);
                cr.newSubPath();
                cr.arc(x + barWidth - radius, y + radius, radius, -Math.PI / 2, 0);
                cr.arc(x + barWidth - radius, y + barHeight - radius, radius, 0, Math.PI / 2);
                cr.arc(x + radius, y + barHeight - radius, radius, Math.PI / 2, Math.PI);
                cr.arc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5);
                cr.closePath();
                cr.fill();
            } else {
                const x = left + slot * index + (slot - barWidth) / 2;
                cr.setSourceRGBA(0.22, 0.68, 1, 0.16);
                cr.rectangle(x, top + plotHeight - 3, barWidth, 3);
                cr.fill();
            }
            const hour = (startHour + index) % 24;
            if (hour % 3 === 0) {
                cr.setSourceRGBA(1, 1, 1, 0.42);
                cr.moveTo(left + slot * index, height - 5);
                cr.showText(String(hour).padStart(2, '0'));
            }
        }
        if (peak === 0) {
            cr.setSourceRGBA(1, 1, 1, 0.38);
            cr.selectFontFace('Inter', 0, 0);
            cr.setFontSize(10);
            cr.moveTo(left + 12, top + plotHeight / 2 + 3);
            cr.showText('Log a drink to start today’s chart');
        }
        cr.$dispose();
    }
});
