// SPDX-License-Identifier: GPL-3.0-or-later

// Shows isled's reminders when they are due. isled keeps them until shown, so one that fell due
// while the screen was locked (and Isle was off) shows as soon as Isle is back.

import GLib from 'gi://GLib';

/** Waits are cut into naps this long: GLib's clock stops during suspend, the wall clock does not. */
const MAX_NAP_MS = 30 * 1000;

export class ReminderWatcher {
    /** `onDue({id, text}, done)` shows a reminder that is due, and calls `done` once it was on screen. */
    constructor(daemon, onDue) {
        this._daemon = daemon;
        this._onDue = onDue;
        this._timeout = 0;
        this._shown = new Set();
        this._changedId = daemon.connect('changed', (_daemon, key) => {
            if (key === 'reminders')
                this._sync();
        });
        this._sync();
    }

    _sync() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
        const items = this._daemon.state.reminders ?? [];
        // Only those isled still has: the rest were dismissed for good.
        this._shown = new Set([...this._shown].filter(id => items.some(item => item.id === id)));
        const now = Date.now();
        for (const item of items) {
            // Dismissing takes a round trip; don't show it twice meanwhile.
            if (item.due_ms > now || this._shown.has(item.id))
                continue;
            this._shown.add(item.id);
            // isled keeps it until it was really shown (the island may be hidden by a fullscreen window).
            this._onDue(item, () => this._daemon.call('reminders', 'Dismiss', item.id));
        }
        const next = items.find(item => item.due_ms > now);
        if (!next)
            return;
        const wait = Math.min(MAX_NAP_MS, next.due_ms - now + 50);
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, wait, () => {
            this._timeout = 0;
            this._sync();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        if (this._timeout)
            GLib.source_remove(this._timeout);
        this._daemon.disconnect(this._changedId);
    }
}

/** Prayer reminders follow the selected city timezone and remember which ones have already been shown. */
export class PrayerWatcher {
    constructor(daemon, settings, onDue) {
        this._daemon = daemon;
        this._settings = settings;
        this._onDue = onDue;
        this._timeout = 0;
        this._changedId = daemon.connect('changed', (_daemon, key) => {
            if (key === 'prayer')
                this._sync();
        });
        this._settingsIds = [
            settings.connect('changed::prayer-reminders', () => this._sync()),
        ];
        this._sync();
    }

    _sync() {
        if (this._timeout) {
            GLib.source_remove(this._timeout);
            this._timeout = 0;
        }
        const schedule = this._daemon.state.prayer;
        if (schedule?.status === 'error') {
            this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5 * 60_000, () => {
                this._timeout = 0;
                this._daemon.call('prayer', 'RefreshNow');
                return GLib.SOURCE_REMOVE;
            });
            return;
        }
        if (schedule?.status !== 'ready')
            return;
        const cityDate = dateInTimezone(schedule.timezone);
        if (!cityDate)
            return;
        if (cityDate !== schedule.date) {
            this._daemon.call('prayer', 'RefreshForDate', cityDate);
            return;
        }
        const now = Date.now();
        const date = schedule.date;
        const enabled = this._settings.get_boolean('prayer-reminders');
        const already = new Set(this._settings.get_strv('prayer-alerted').filter(item => item.startsWith(`${date}:`)));
        const due = (schedule.prayers ?? []).map(prayer => ({
            prayer,
            at: zonedTime(date, prayer.time, schedule.timezone),
            id: `${date}:${prayer.name}`,
        })).filter(item => Number.isFinite(item.at));
        for (const item of due) {
            if (!enabled || item.at > now || already.has(item.id) || now - item.at > 20 * 60_000)
                continue;
            already.add(item.id);
            this._settings.set_strv('prayer-alerted', [...already]);
            this._onDue({id: item.id, text: `It’s time for ${item.prayer.name} prayer`});
        }
        const upcoming = due.some(item => item.at > now);
        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, enabled && upcoming ? 20_000 : 5 * 60_000, () => {
                this._timeout = 0;
                const cityDate = dateInTimezone(schedule.timezone);
                if (!cityDate)
                    return GLib.SOURCE_REMOVE;
                if (cityDate !== schedule.date)
                    this._daemon.call('prayer', 'RefreshForDate', cityDate);
                else
                    this._sync();
                return GLib.SOURCE_REMOVE;
            });
    }

    destroy() {
        if (this._timeout)
            GLib.source_remove(this._timeout);
        this._daemon.disconnect(this._changedId);
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
    }
}

function dateInTimezone(timezone) {
    try {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone: timezone,
            year: 'numeric', month: '2-digit', day: '2-digit'}).formatToParts(new Date())
            .filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    } catch {
        // A malformed timezone from the upstream service must not break the Shell loop.
        return null;
    }
}

function zonedTime(date, time, timezone) {
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    if (![year, month, day, hour, minute].every(Number.isFinite) || !timezone)
        return NaN;
    const target = Date.UTC(year, month - 1, day, hour, minute);
    let guess = target;
    try {
        const formatter = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone, year: 'numeric', month: 'numeric', day: 'numeric',
            hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
        });
        for (let attempt = 0; attempt < 2; attempt++) {
            const parts = Object.fromEntries(formatter.formatToParts(new Date(guess))
                .filter(part => part.type !== 'literal').map(part => [part.type, Number(part.value)]));
            const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
            guess += target - represented;
        }
        return guess;
    } catch {
        return NaN;
    }
}
