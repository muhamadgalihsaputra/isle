// SPDX-License-Identifier: GPL-3.0-or-later

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {VERTICAL} from '../compat.js';
import {label} from '../widgets.js';
import {Page} from './page.js';

export const PrayerPage = GObject.registerClass(
class PrayerPage extends Page {
    _init(daemon, {height}) {
        super._init(daemon, {style_class: 'isle-page isle-prayer', layout_manager: new Clutter.BinLayout(), height});
        this.name = 'prayer';
        this._column = new St.BoxLayout({...VERTICAL, x_expand: true, y_expand: true});
        this.add_child(this._column);
        this.watch(['prayer'], () => this._update());
        this._update();
    }

    _nextPrayer(prayers) {
        if (!prayers?.length)
            return null;
        const now = new Date();
        const currentMinutes = now.getHours() * 60 + now.getMinutes();
        for (const prayer of prayers) {
            const [h, m] = prayer.time.split(':').map(Number);
            if (h * 60 + m > currentMinutes)
                return prayer.name;
        }
        return prayers[0].name;
    }

    _update() {
        this._column.destroy_all_children();
        const schedule = this.daemon.state.prayer;
        if (schedule?.status !== 'ready') {
            const header = new St.BoxLayout({style_class: 'isle-prayer-header'});
            header.add_child(label('Prayer Times', 'isle-prayer-title', {x_expand: true}));
            this._column.add_child(header);
            const text = schedule?.status === 'error'
                ? 'Could not load prayer times. Check your connection.'
                : 'Set a city in Settings → Daily Life';
            this._column.add_child(label(text, 'isle-prayer-empty', {
                x_align: Clutter.ActorAlign.CENTER, y_expand: true,
            }));
            return;
        }
        const header = new St.BoxLayout({style_class: 'isle-prayer-header'});
        header.add_child(label(`${schedule.city}, ${schedule.country}`, 'isle-prayer-title', {x_expand: true}));
        header.add_child(label(schedule.date, 'isle-prayer-date'));
        this._column.add_child(header);

        const nextName = this._nextPrayer(schedule.prayers);
        const row = new St.BoxLayout({x_expand: true, y_expand: true, style_class: 'isle-prayer-grid'});
        for (const prayer of schedule.prayers ?? []) {
            const isNext = prayer.name === nextName;
            const card = new St.BoxLayout({
                ...VERTICAL,
                x_expand: true,
                style_class: isNext ? 'isle-prayer-card active' : 'isle-prayer-card',
                y_align: Clutter.ActorAlign.CENTER,
            });
            card.add_child(label(prayer.name, 'isle-prayer-card-name', {x_align: Clutter.ActorAlign.CENTER}));
            card.add_child(label(prayer.time, 'isle-prayer-card-time', {x_align: Clutter.ActorAlign.CENTER}));
            if (isNext) {
                card.add_child(label('NEXT', 'isle-prayer-card-badge', {x_align: Clutter.ActorAlign.CENTER}));
            }
            row.add_child(card);
        }
        this._column.add_child(row);
        const footer = new St.BoxLayout({style_class: 'isle-prayer-footer'});
        footer.add_child(label(`Kemenag · ${schedule.timezone}`, 'isle-prayer-source', {
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._column.add_child(footer);
    }
});
