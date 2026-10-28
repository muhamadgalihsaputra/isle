// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// Shows isled's reminders when they are due. isled keeps them until shown, so one that fell due
// while the screen was locked (and Isle was off) shows as soon as Isle is back.

import GLib from 'gi://GLib';

/** Waits are cut into naps this long: GLib's clock stops during suspend, the wall clock does not. */
const MAX_NAP_MS = 30 * 1000;

const WELLBEING = {
    calories: {entries: 'calorieEntries', goal: 'calorie-goal'},
    water: {entries: 'waterEntries', goal: 'water-goal-ml'},
};

function localDateKey() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function totalToday(entries, kind) {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    const amount = kind === 'water' ? 'amount_ml' : 'calories';
    return entries.reduce((sum, entry) => entry.at_ms >= start.getTime() && entry.at_ms < end.getTime()
        ? sum + (Number(entry[amount]) || 0) : sum, 0);
}

function reachedMilestones(total, goal) {
    return new Set([50, 100].filter(percent => total >= goal * percent / 100));
}

/** Posts each calorie and water goal milestone once per day, only when new entries cross it. */
export class WellbeingWatcher {
    constructor(daemon, settings, onMilestone) {
        this._daemon = daemon;
        this._settings = settings;
        this._onMilestone = onMilestone;
        const day = localDateKey();
        this._state = Object.fromEntries(Object.keys(WELLBEING).map(kind => {
            const {entries, goal: goalKey} = WELLBEING[kind];
            const current = daemon.state[entries];
            const ready = Array.isArray(current);
            const total = ready ? totalToday(current, kind) : 0;
            const goal = settings.get_int(goalKey);
            return [kind, {day, total, ready, shown: reachedMilestones(total, goal)}];
        }));
        this._changedId = daemon.connect('changed', (_daemon, key) => {
            const kind = Object.keys(WELLBEING).find(name => WELLBEING[name].entries === key);
            if (kind)
                this._sync(kind);
        });
    }

    _sync(kind) {
        const {entries: entriesKey, goal: goalKey} = WELLBEING[kind];
        const entries = this._daemon.state[entriesKey];
        if (!Array.isArray(entries))
            return;
        const state = this._state[kind];
        const day = localDateKey();
        const total = totalToday(entries, kind);
        const goal = this._settings.get_int(goalKey);
        if (!state.ready) {
            Object.assign(state, {day, total, ready: true, shown: reachedMilestones(total, goal)});
            return;
        }
        const previous = state.day === day ? state.total : 0;
        if (state.day !== day) {
            state.day = day;
            state.shown.clear();
        }
        state.total = total;
        if (total <= previous)
            return;

        for (const percent of [100, 50]) {
            if (state.shown.has(percent) || previous >= goal * percent / 100 || total < goal * percent / 100)
                continue;
            state.shown.add(percent);
            this._onMilestone({kind, percent, total, goal, date: day});
            return;
        }
    }

    destroy() {
        this._daemon.disconnect(this._changedId);
    }
}

/** Watches isled's reminder list and hands each due one to the island once. */
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

    /** Shows what is due now and sets a timer for the next one. */
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

    /** Stops the timer and lets go of isled's signal. */
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
            this._onDue({id: item.id, prayer: item.prayer.name, time: item.prayer.time, city: schedule.city,
                text: `It’s time for ${item.prayer.name} prayer`});
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
