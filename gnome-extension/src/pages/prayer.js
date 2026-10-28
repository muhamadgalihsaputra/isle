// SPDX-License-Identifier: GPL-3.0-or-later

import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {VERTICAL, px} from '../compat.js';
import * as Format from '../format.js';
import {icon, label} from '../widgets.js';
import {Page} from './page.js';

const LOCAL_NAMES = {Fajr: 'Subuh', Dhuhr: 'Dzuhur', Asr: 'Ashar', Isha: 'Isya'};

function prayerName(name) {
    return LOCAL_NAMES[name] ?? name;
}

function arcPoint(t, left, right, top, bottom) {
    const inverse = 1 - t;
    const span = right - left;
    const p0 = {x: left, y: bottom};
    const p1 = {x: left + span * 0.24, y: top};
    const p2 = {x: right - span * 0.24, y: top};
    const p3 = {x: right, y: bottom};
    return {
        x: inverse ** 3 * p0.x + 3 * inverse ** 2 * t * p1.x + 3 * inverse * t ** 2 * p2.x + t ** 3 * p3.x,
        y: inverse ** 3 * p0.y + 3 * inverse ** 2 * t * p1.y + 3 * inverse * t ** 2 * p2.y + t ** 3 * p3.y,
    };
}

export const PrayerPage = GObject.registerClass(
class PrayerPage extends Page {
    _init(daemon, {height}) {
        super._init(daemon, {
            style_class: 'isle-page isle-prayer',
            layout_manager: new Clutter.BinLayout(),
            height,
        });
        this.name = 'prayer';
        this._column = new St.BoxLayout({...VERTICAL, x_expand: true, y_expand: true, style_class: 'isle-prayer-column'});
        this.add_child(this._column);
        this.watch(['prayer'], () => this._update());
        this._update();
    }

    _prayerStatus(prayers) {
        if (!prayers || !prayers.length)
            return null;
        const now = new Date();
        const currentMins = now.getHours() * 60 + now.getMinutes();

        let nextIndex = -1;
        for (let i = 0; i < prayers.length; i++) {
            const [h, m] = prayers[i].time.split(':').map(Number);
            if (h * 60 + m > currentMins) {
                nextIndex = i;
                break;
            }
        }

        const isTomorrow = (nextIndex === -1);
        if (isTomorrow)
            nextIndex = 0;

        const nextPrayer = prayers[nextIndex];
        const [h, m] = nextPrayer.time.split(':').map(Number);
        const targetDate = new Date();
        if (isTomorrow)
            targetDate.setDate(targetDate.getDate() + 1);
        targetDate.setHours(h, m, 0, 0);

        const diffMs = targetDate.getTime() - now.getTime();
        const totalMins = Math.max(0, Math.floor(diffMs / 60000));
        const hours = Math.floor(totalMins / 60);
        const mins = totalMins % 60;
        const countdown = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

        const previousIndex = (nextIndex + prayers.length - 1) % prayers.length;
        const [previousHour, previousMinute] = prayers[previousIndex].time.split(':').map(Number);
        const previousDate = new Date(targetDate);
        previousDate.setHours(previousHour, previousMinute, 0, 0);
        if (previousIndex >= nextIndex)
            previousDate.setDate(previousDate.getDate() - 1);
        const interval = targetDate.getTime() - previousDate.getTime();
        const progress = Math.max(0, Math.min(1, (now.getTime() - previousDate.getTime()) / interval));

        return {nextIndex, nextName: nextPrayer.name, countdown, isTomorrow, progress};
    }

    _heading(city = '') {
        const heading = new St.BoxLayout({style_class: 'isle-prayer-heading'});
        heading.add_child(new St.Icon({gicon: icon('isle-prayer'), icon_size: 15, style_class: 'isle-prayer-heading-icon'}));
        heading.add_child(label('Prayer', 'isle-prayer-title', {x_expand: true}));
        heading.add_child(label([city, Format.longDate()].filter(Boolean).join(' · '), 'isle-prayer-date'));
        return heading;
    }

    _syncProgress(progress) {
        if (this._progressTrack && this._progressFill)
            this._progressFill.width = Math.max(0, this._progressTrack.width * progress);
    }

    _update() {
        this.cancel('prayer-countdown');
        this._column.destroy_all_children();
        this._nextCountdown = null;
        this._progressTrack = null;
        this._progressFill = null;
        const schedule = this.daemon.state.prayer;
        if (schedule?.status !== 'ready') {
            this._column.add_child(this._heading(schedule?.city));
            const text = schedule?.status === 'error'
                ? 'Could not load prayer times. Check your connection.'
                : 'Set a city in Settings → Daily Life';
            this._column.add_child(label(text, 'isle-prayer-empty', {
                x_align: Clutter.ActorAlign.CENTER,
                y_expand: true,
            }));
            return;
        }

        const info = this._prayerStatus(schedule.prayers);
        const prayers = schedule.prayers ?? [];
        this._column.add_child(this._heading(schedule.city));
        const row = new St.BoxLayout({style_class: 'isle-prayer-row', x_expand: true, y_expand: true});

        const hero = new St.BoxLayout({...VERTICAL, style_class: 'isle-prayer-hero', y_align: Clutter.ActorAlign.CENTER});
        const heroTop = new St.BoxLayout({style_class: 'isle-prayer-hero-top'});
        heroTop.add_child(label('UP NEXT', 'isle-prayer-eyebrow'));
        hero.add_child(heroTop);
        hero.add_child(label(info ? prayerName(info.nextName) : 'Prayer times', 'isle-prayer-next-name'));
        const nextDetails = new St.BoxLayout({style_class: 'isle-prayer-next-details', y_align: Clutter.ActorAlign.CENTER});
        nextDetails.add_child(label(info ? prayers[info.nextIndex].time : '—', 'isle-prayer-next-time'));
        this._nextCountdown = label(info ? this._countdownText(info) : 'No upcoming time', 'isle-prayer-next-countdown', {
            y_align: Clutter.ActorAlign.CENTER,
        });
        nextDetails.add_child(this._nextCountdown);
        hero.add_child(nextDetails);
        this._progressTrack = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'isle-prayer-progress-track',
            x_expand: true,
        });
        this._progressFill = new St.Widget({
            style_class: 'isle-prayer-progress-fill',
            x_align: Clutter.ActorAlign.START,
            y_expand: true,
        });
        this._progressTrack.add_child(this._progressFill);
        this._progressTrack.connect('notify::width', () => this._syncProgress(info?.progress ?? 0));
        hero.add_child(this._progressTrack);
        row.add_child(hero);

        this._arcData = {prayers, nextIndex: info?.nextIndex ?? -1, isTomorrow: Boolean(info?.isTomorrow)};
        this._arc = new St.DrawingArea({style_class: 'isle-prayer-arc', x_expand: true});
        this._arc.connect('repaint', area => this._paintArc(area));
        const timeline = new St.BoxLayout({...VERTICAL, style_class: 'isle-prayer-timeline', x_expand: true, y_expand: true});
        timeline.add_child(this._arc);
        const labels = new St.BoxLayout({style_class: 'isle-prayer-labels', x_expand: true});
        for (let i = 0; i < prayers.length; i++) {
            const prayer = prayers[i];
            const isNext = Boolean(info && i === info.nextIndex);
            const isPast = Boolean(info && (info.isTomorrow ? i !== info.nextIndex : i < info.nextIndex));
            let markClass = 'isle-prayer-mark';
            if (isNext)
                markClass += ' next';
            else if (isPast)
                markClass += ' past';
            const mark = new St.BoxLayout({...VERTICAL, x_expand: true, style_class: markClass});
            mark.add_child(label(prayerName(prayer.name), 'isle-prayer-mark-name', {x_align: Clutter.ActorAlign.CENTER}));
            mark.add_child(label(prayer.time, 'isle-prayer-mark-time', {x_align: Clutter.ActorAlign.CENTER}));
            labels.add_child(mark);
        }
        timeline.add_child(labels);
        row.add_child(timeline);
        this._column.add_child(row);
        this._arc.queue_repaint();
        this._syncProgress(info?.progress ?? 0);

        const footer = new St.BoxLayout({style_class: 'isle-prayer-footer'});
        footer.add_child(label(`Kemenag · ${schedule.timezone}`, 'isle-prayer-source', {
            x_expand: true,
            x_align: Clutter.ActorAlign.CENTER,
        }));
        this._column.add_child(footer);

        this._nextIndex = info?.nextIndex ?? -1;
        this._nextIsTomorrow = Boolean(info?.isTomorrow);
        this._scheduleCountdown();
    }

    _paintArc(area) {
        const cr = area.get_context();
        const [width, height] = area.get_surface_size();
        if (width <= 0 || height <= 0) {
            cr.$dispose();
            return;
        }
        const {prayers, nextIndex} = this._arcData ?? {};
        if (!prayers?.length) {
            cr.$dispose();
            return;
        }

        const left = px(12);
        const right = width - px(12);
        const top = px(8);
        const bottom = height - px(11);
        const drawArc = () => {
            cr.moveTo(left, bottom);
            cr.curveTo(left + (right - left) * 0.24, top, right - (right - left) * 0.24, top, right, bottom);
        };

        cr.setLineCap(Cairo.LineCap.ROUND);
        cr.setLineWidth(px(8));
        cr.setSourceRGBA(0.18, 0.38, 0.92, 0.14);
        drawArc();
        cr.stroke();

        const path = new Cairo.LinearGradient(left, 0, right, 0);
        path.addColorStopRGBA(0, 0.16, 0.62, 1, 0.94);
        path.addColorStopRGBA(0.56, 0.23, 0.43, 1, 0.96);
        path.addColorStopRGBA(1, 0.62, 0.28, 0.94, 0.9);
        cr.setSource(path);
        cr.setLineWidth(px(2.5));
        drawArc();
        cr.stroke();

        for (let i = 0; i < prayers.length; i++) {
            const t = prayers.length === 1 ? 0.5 : i / (prayers.length - 1);
            const {x, y} = arcPoint(t, left, right, top, bottom);
            if (i === nextIndex) {
                const halo = new Cairo.RadialGradient(x, y, px(1), x, y, px(15));
                halo.addColorStopRGBA(0, 1, 0.72, 0.24, 0.54);
                halo.addColorStopRGBA(1, 1, 0.58, 0.12, 0);
                cr.setSource(halo);
                cr.arc(x, y, px(15), 0, Math.PI * 2);
                cr.fill();
                cr.setSourceRGBA(1, 0.78, 0.34, 1);
                cr.arc(x, y, px(4.5), 0, Math.PI * 2);
                cr.fill();
                cr.setSourceRGBA(1, 0.94, 0.72, 1);
                cr.arc(x, y, px(1.6), 0, Math.PI * 2);
                cr.fill();
            } else {
                const past = this._arcData.isTomorrow || i < nextIndex;
                cr.setSourceRGBA(0.82, 0.88, 1, past ? 0.72 : 0.42);
                cr.arc(x, y, px(2.2), 0, Math.PI * 2);
                cr.fill();
            }
        }
        cr.$dispose();
    }

    _countdownText(info) {
        return info.isTomorrow ? `Tomorrow · ${info.countdown}` : `in ${info.countdown}`;
    }

    _scheduleCountdown() {
        if (!this.active || !this._nextCountdown)
            return;
        const delay = 60_000 - (Date.now() % 60_000) + 40;
        this.later('prayer-countdown', delay, () => {
            const info = this._prayerStatus(this.daemon.state.prayer?.prayers);
            if (!info)
                return;
            if (info.nextIndex !== this._nextIndex || Boolean(info.isTomorrow) !== this._nextIsTomorrow) {
                this._update();
                return;
            }
            this._nextCountdown.text = this._countdownText(info);
            this._syncProgress(info.progress);
            this._scheduleCountdown();
        });
    }

    onActivate() {
        const info = this._prayerStatus(this.daemon.state.prayer?.prayers);
        if (info && (info.nextIndex !== this._nextIndex || Boolean(info.isTomorrow) !== this._nextIsTomorrow)) {
            this._update();
            return;
        }
        if (info && this._nextCountdown)
            this._nextCountdown.text = this._countdownText(info);
        if (info)
            this._syncProgress(info.progress);
        this._scheduleCountdown();
    }

    onDeactivate() {
        this.cancel('prayer-countdown');
    }
});
