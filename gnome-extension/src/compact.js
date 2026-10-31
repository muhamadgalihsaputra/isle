// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 zickrian

// The resting island: live statuses spread either side of the clock and the rest date, which flank
// the assistant's attentive face so it stays centred. Disabled pages do not leave their status behind.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {paletteFor} from './bot.js';
import {BotIcon} from './botIcon.js';
import {onUiScale, px} from './compat.js';
import * as Format from './format.js';
import * as Palette from './palette.js';
import * as Playback from './playback.js';
import {WeatherWatcher} from './weather.js';
import {watchClock} from './wallClock.js';
import {Art, Bars, PrivacyDots, RecordingDot, Ring, icon, restsAt, label} from './widgets.js';

/** The assistant at rest, in the centre. */
const ASSISTANT_SIZE = 26;

/** Icon and assistant sizes, in CSS pixels. */
const SIZES = {
    hanging: {side: 72, center: 34, ring: 20, bars: 16, moon: 14, call: 15, weather: 16, music: 18},
    inBar: {side: 72, center: 30, ring: 18, bars: 14, moon: 13, call: 14, weather: 14, music: 16},
};
/** The music bars' opacity while the song is paused. */
const PAUSED_OPACITY = 110;
/** How often the focus ring is redrawn; it moves too slowly to need more. */
const RING_REFRESH_S = 5;
/** The focus timer's colour: white while focusing, green on a break. */
export function timerColor(phase) {
    return phase === 'focus' || phase === 'idle' ? Palette.WHITE : Palette.GREEN;
}

/** The closed island's contents; emits `width-changed` when it needs another width. */
export const CompactView = GObject.registerClass({
    Signals: {'width-changed': {}, 'assistant-requested': {}, 'assistant-hovered': {}},
}, class CompactView extends St.Widget {
    /** `privacy` and `call` are the shell's recording and call watchers. */
    _init(daemon, settings, privacy, call) {
        super._init({
            style_class: 'isle-compact',
            layout_manager: new Clutter.BinLayout(),
        });
        this._daemon = daemon;
        this._settings = settings;
        this._privacy = privacy;
        this._call = call;
        this._idle = false;
        this._inBar = false;
        this._voiceEnabled = false;
        this._timeouts = {};
        this._assistantPointerMotion = 0;
        this._widthChangedIdle = 0;

        const row = new St.BoxLayout({style_class: 'isle-compact-row', x_expand: true, y_expand: true});
        this._row = row;
        this.add_child(row);
        // Two pads that share whatever room the row has: whatever the sides weigh, the pads take the
        // same amount each, so the assistant sits in the middle of the notch whatever is on.
        this._rowPad = new St.Widget({x_expand: true});

        this._left = new St.BoxLayout({style_class: 'isle-compact-side isle-compact-clock-side', x_expand: false,
            y_align: Clutter.ActorAlign.CENTER});
        this._clock = label('', 'isle-compact-clock');
        this._moon = new St.Icon({gicon: icon('isle-moon'), icon_size: 14, style_class: 'isle-dnd-moon', y_align: Clutter.ActorAlign.CENTER, visible: false});
        this._clockBox = new St.BoxLayout({style_class: 'isle-compact-clock-box', x_align: Clutter.ActorAlign.START, y_align: Clutter.ActorAlign.CENTER});
        this._clockBox.add_child(this._moon);
        this._clockBox.add_child(this._clock);

        this._restDate = label('', 'isle-compact-rest-date', {y_align: Clutter.ActorAlign.CENTER});

        this._ring = new Ring({size: 20, lineWidth: 3});
        this._recordingDot = new RecordingDot();
        this._recordingTime = label('', 'isle-compact-status-time isle-compact-recording-time');
        this._callIcon = new St.Icon({gicon: icon('isle-phone-symbolic'), icon_size: 15, style_class: 'isle-call-icon', y_align: Clutter.ActorAlign.CENTER});
        this._callTime = label('', 'isle-compact-status-time isle-compact-call-time');
        this._micOff = new St.Icon({gicon: icon('isle-mic-off-symbolic'), icon_size: 15, style_class: 'isle-call-muted', y_align: Clutter.ActorAlign.CENTER});
        this._timerTime = label('', 'isle-compact-status-time');
        this._serviceDown = new St.Icon({gicon: icon('dialog-warning-symbolic'), icon_size: 15, style_class: 'isle-compact-warning', y_align: Clutter.ActorAlign.CENTER});
        this._notificationIcon = new St.Icon({gicon: icon('isle-bell'), icon_size: 15, y_align: Clutter.ActorAlign.CENTER});
        this._notificationCount = label('', 'isle-compact-notification-count');
        this._bars = new Bars({height: 16});

        this._recordingStatus = new St.BoxLayout({style_class: 'isle-compact-status-item', y_align: Clutter.ActorAlign.CENTER});
        this._recordingStatus.add_child(this._recordingDot);
        this._recordingStatus.add_child(this._recordingTime);
        this._callStatus = new St.BoxLayout({style_class: 'isle-compact-status-item isle-compact-call-status', y_align: Clutter.ActorAlign.CENTER});
        this._callStatus.add_child(this._callIcon);
        this._callStatus.add_child(this._callTime);
        this._callStatus.add_child(this._micOff);
        this._timerStatus = new St.BoxLayout({style_class: 'isle-compact-status-item', y_align: Clutter.ActorAlign.CENTER});
        this._timerStatus.add_child(this._ring);
        this._timerStatus.add_child(this._timerTime);
        this._musicArt = new Art({size: SIZES.hanging.music, radius: 4});
        // The song's two signs live in opposite corners, as the island's own music page splits them:
        // the cover at the notch's left edge, the dancing bars at its right edge.
        this._musicStatus = new St.BoxLayout({style_class: 'isle-compact-status-item', y_align: Clutter.ActorAlign.CENTER});
        this._musicStatus.add_child(this._bars);
        this._notificationStatus = new St.BoxLayout({style_class: 'isle-compact-status-item', y_align: Clutter.ActorAlign.CENTER});
        this._notificationStatus.add_child(this._notificationIcon);
        this._notificationStatus.add_child(this._notificationCount);
        this._weatherIcon = new St.Icon({icon_name: 'weather-clear-symbolic', icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER});
        this._weatherTemperature = label('', 'isle-compact-status-time');
        this._weatherStatus = new St.BoxLayout({style_class: 'isle-compact-status-item', y_align: Clutter.ActorAlign.CENTER,
            visible: false});
        this._weatherStatus.add_child(this._weatherIcon);
        this._weatherStatus.add_child(this._weatherTemperature);
        // The first connected GSConnect device's battery, as a phone chip beside the weather.
        this._phoneIcon = new St.Icon({gicon: icon('isle-phone-symbolic'), icon_size: 16,
            y_align: Clutter.ActorAlign.CENTER});
        this._phoneBattery = label('', 'isle-compact-status-time');
        this._phoneStatus = new St.BoxLayout({style_class: 'isle-compact-status-item', y_align: Clutter.ActorAlign.CENTER,
            visible: false});
        this._phoneStatus.add_child(this._phoneIcon);
        this._phoneStatus.add_child(this._phoneBattery);

        this._assistant = new BotIcon(ASSISTANT_SIZE, this._botLook());
        this._assistant.y_align = Clutter.ActorAlign.CENTER;
        this._assistantButton = new St.Button({style_class: 'isle-compact-assistant-button', child: this._assistant,
            can_focus: true, track_hover: true, accessible_name: 'AI assistant', y_align: Clutter.ActorAlign.CENTER});
        this._assistantButton.connect('clicked', () => {
            this._cancel('assistant-hover');
            this.emit('assistant-requested');
        });
        this._assistantButton.connect('motion-event', () => {
            const [x, y] = global.get_pointer();
            this._assistant.lookAtPointer(x, y);
            return Clutter.EVENT_PROPAGATE;
        });
        this._assistantButton.connect('notify::hover', () => {
            if (this._assistantButton.hover) {
                const [x, y] = global.get_pointer();
                this._assistant.lookAtPointer(x, y);
                this._scheduleAssistantHover();
            } else {
                this._cancel('assistant-hover');
            }
        });
        this._openOnChanged = settings.connect('changed::open-on', () => this._scheduleAssistantHover());
        this._botLookChanged = ['bot-shape', 'bot-color', 'bot-glow'].map(key =>
            settings.connect(`changed::${key}`, () => (this._assistant.look = this._botLook())));
        this._statusItems = [this._serviceDown, this._timerStatus, this._recordingStatus, this._callStatus,
            this._notificationStatus, this._musicStatus, this._weatherStatus, this._phoneStatus];
        this._leftStatuses = new St.BoxLayout({style_class: 'isle-compact-status',
            y_align: Clutter.ActorAlign.CENTER});
        this._rightStatuses = new St.BoxLayout({style_class: 'isle-compact-status',
            y_align: Clutter.ActorAlign.CENTER});
        for (const item of this._statusItems)
            this._leftStatuses.add_child(item);
        this._leftSpacer = new St.Widget({x_expand: true});
        this._left.add_child(this._musicArt);
        this._left.add_child(this._leftStatuses);
        this._left.add_child(this._leftSpacer);
        this._left.add_child(this._clockBox);
        this._privacyDots = new PrivacyDots();
        this._right = new St.BoxLayout({style_class: 'isle-compact-side isle-compact-status', x_expand: false, y_align: Clutter.ActorAlign.CENTER});
        this._rightSpacer = new St.Widget({x_expand: true});
        this._right.add_child(this._restDate);
        this._right.add_child(this._rightSpacer);
        this._right.add_child(this._rightStatuses);
        this._right.add_child(this._privacyDots);
        // The clock and the date sit beside the assistant and never move; the live statuses rest
        // at the notch's outer edges, so nothing crowds the centre or reads as a second time.


        this._weather = new WeatherWatcher(settings);
        this._weatherChanged = this._weather.connect('changed', () => {
            this._syncWeather();
            this._refresh();
        });
        this._syncWeather();

        row.add_child(this._rowPad);
        row.add_child(this._left);
        row.add_child(this._assistantButton);
        row.add_child(this._right);
        row.add_child(new St.Widget({x_expand: true}));

        this._daemonChanged = daemon.connect('changed', (_daemon, key) => {
            if (['nowPlaying', 'pomodoro', 'system'].includes(key))
                this._refresh();
        });
        this._settingsChanged = settings.connect('changed::privacy-indicators', () => this._refresh());
        this._pagesChanged = settings.connect('changed::hidden-pages', () => this._refresh());
        this._privacyChanged = privacy.connect('changed', () => this._refresh());
        this._callChanged = call.connect('changed', () => this._refresh());
        this.connect('notify::mapped', () => {
            this._weather.active = this.mapped;
            this._assistant.alive = this.mapped && !this._idle;
            if (this.mapped && !this._idle)
                this._startAssistantPointerTracking();
            else
                this._stopAssistantPointerTracking();
            this._syncBars();
            this._tickCall();
            this._tickRecording();
            this._tickTimer();
            this._refreshRing();
            if (this.mapped)
                this._refresh();
        });
        this._tickClock();
        this._stopClock = watchClock(() => this._tickClock());
        this._weather.active = this.mapped;
        this._refresh();
        // Another scale: the sides are measured again.
        onUiScale(this, () => this._refresh(), {now: false});
        this.connect('destroy', () => this._onDestroy());
    }

    /** The island's natural width: both sides take the wider one's room, so the assistant stays centred. */
    get preferredWidth() {
        const size = SIZES[this._inBar ? 'inBar' : 'hanging'];
        // Gaps match `.isle-compact-clock-side` and `.isle-compact-status`.
        const gap = px(this._inBar ? 10 : 12);
        // Each of the art tile and the statuses box stands a gap from its neighbours, as the side's
        // own spacing lays them out.
        const leftItems = [this._musicArt, this._leftStatuses].filter(item => item.visible)
            .map(item => item.get_preferred_width(-1)[1]);
        const leftWidth = leftItems.reduce((total, width) => total + width + gap, 0) +
            this._clockBox.get_preferred_width(-1)[1];
        // Both sides end flush at the assistant; each item stands a gap from its neighbours.
        // The right side also holds the spacer, which is why one gap per item measures the whole side.
        const rightItems = [this._restDate, this._rightStatuses, this._privacyDots].filter(item => item.visible);
        const rightWidth = rightItems.reduce((total, item) => total + item.get_preferred_width(-1)[1], 0) +
            gap * rightItems.length;
        // The sides take their natural width; the row's two end pads share what room the island has
        // beyond that, so the whole row sits centred and the assistant with it. No side is stretched
        // to the other's width, which left the lighter one's spacer as a long dead stretch.
        // Row padding, one row gap either side of the assistant, and the pads' least width.
        return Math.ceil(2 * px(this._inBar ? 14 : 16) + 2 * px(12) + leftWidth + rightWidth + px(size.center));
    }

    /**
     * Splits the live statuses across the two sides by width, so both carry about the same and the
     * notch grows evenly. The clock and the moon count towards the left, the date and the privacy
     * dots towards the right, before any status is placed: the right side starts heavier, so the
     * statuses lean left and no dead stretch opens beside the clock. Each status in priority order
     * takes the placement that leaves the sides nearest level. Clock-side and date-side slots fill
     * outward from the clock and the date, so the clock and the date flank the assistant unmoved,
     * whatever is active.
     */
    _spreadStatuses(statuses) {
        // Gaps match `.isle-compact-status` (see `preferredWidth`).
        const gap = px(this._inBar ? 10 : 12);
        const widths = statuses.map(item => item.get_preferred_width(-1)[1] + gap);
        // The signature covers which statuses are on; the widths cover their sizes changing without
        // the set changing (a ticking timer, a colder morning): both bring the sides out of level, so
        // either re-spreads. Widths measured before St has laid the last text change out are close
        // enough to keep the sides steady.
        const signature = `${statuses.map(item => this._statusItems.indexOf(item)).join(',')}` +
            `:${widths.join(',')}`;
        if (signature === this._statusSignature)
            return;
        this._statusSignature = signature;

        let leftWidth = this._clockBox.get_preferred_width(-1)[1] + gap;
        let rightWidth = 0;
        for (const item of [this._restDate, this._privacyDots].filter(item => item.visible))
            rightWidth += item.get_preferred_width(-1)[1] + gap;
        const left = [];
        const right = [];
        // What is on stays on its side (its chip keeps its place while another comes or goes:
        // a status appearing would otherwise reshuffle them all); only the new ones choose, and of
        // those the widest first, onto the lighter side, so the sides level whatever is active.
        for (const [index, item] of statuses.entries()) {
            const kept = this._leftStatuses.get_children().includes(item) ? left
                : this._rightStatuses.get_children().includes(item) ? right : null;
            if (kept === left) {
                left.push(item);
                leftWidth += widths[index];
            } else if (kept === right) {
                right.push(item);
                rightWidth += widths[index];
            }
        }
        statuses.filter(item => !left.includes(item) && !right.includes(item))
            .map(item => [item, widths[statuses.indexOf(item)]])
            .sort((a, b) => b[1] - a[1])
            .forEach(([item, own]) => {
                const lighter = leftWidth <= rightWidth ? left : right;
                lighter.push(item);
                if (lighter === left)
                    leftWidth += own;
                else
                    rightWidth += own;
            });
        // Back to priority order, for the slots' fill order below.
        left.sort((a, b) => statuses.indexOf(a) - statuses.indexOf(b));
        right.sort((a, b) => statuses.indexOf(a) - statuses.indexOf(b));

        for (const item of this._statusItems) {
            item.visible = statuses.includes(item);
            const side = left.includes(item) ? this._leftStatuses : this._rightStatuses;
            if (item.get_parent() === side)
                continue;
            if (item.get_parent())
                item.get_parent().remove_child(item);
            side.add_child(item);
        }
        // The outermost slot fills first, then inward, on both sides.
        left.forEach((item, index) => this._leftStatuses.set_child_at_index(item, index));
        right.forEach((item, index) => this._rightStatuses.set_child_at_index(item, index));
        this._leftStatuses.visible = left.length > 0;
        this._rightStatuses.visible = right.length > 0;
    }

    /** Privacy dots are on in Settings and something is using the camera, microphone or screen. */
    _showingPrivacy() {
        return this._settings.get_boolean('privacy-indicators') && this._privacy.any;
    }

    /** Updates the weather chip and its screen-reader name from the last successful reading. */
    _syncWeather() {
        const {temperature, iconName, summary, locationName} = this._weather.state;
        this._weatherIcon.icon_name = iconName || 'weather-clear-symbolic';
        this._weatherTemperature.text = temperature;
        this._weatherStatus.visible = Boolean(temperature);
        this._weatherStatus.accessible_name = [locationName, summary, temperature].filter(Boolean).join(', ');
    }

    /** Shows the unread count on the right beside the other live statuses. */
    set unseenNotifications(unseen) {
        unseen = Number(unseen) || 0;
        if (unseen === this._unseen)
            return;
        this._unseen = unseen;
        this._refresh();
    }

    /** Shows a moon before the time while Do Not Disturb is on. */
    set doNotDisturb(on) {
        if (on === this._moon.visible)
            return;
        this._moon.visible = on;
        this._refresh();
    }

    /** Shows that isled is not running, on the right before anything else. */
    get serviceDown() {
        return Boolean(this._isServiceDown);
    }

    /** Set by the controller's service watch. */
    set serviceDown(down) {
        if (down === Boolean(this._isServiceDown))
            return;
        this._isServiceDown = down;
        this._refresh();
    }

    /** The centred face changes expression while the assistant works. */
    set assistantBusy(busy) {
        if (busy === Boolean(this._assistantBusy))
            return;
        this._assistantBusy = busy;
        this._assistant.form = busy ? 'thinking' : 'attentive';
        this._refresh();
    }

    set voiceEnabled(enabled) {
        this._voiceEnabled = enabled;
        this._assistantButton.accessible_name = enabled ? 'AI assistant' : 'Turn on AI assistant in Settings';
        if (!enabled)
            this._cancel('assistant-hover');
    }

    _scheduleAssistantHover() {
        this._cancel('assistant-hover');
        if (!this._voiceEnabled || !this.mapped || !this._assistantButton.hover ||
            this._settings.get_string('open-on') !== 'hover')
            return;
        this._later('assistant-hover', this._settings.get_int('hover-delay'), () => {
            if (this._voiceEnabled && this.mapped && this._assistantButton.hover &&
                this._settings.get_string('open-on') === 'hover')
                this.emit('assistant-hovered');
        });
    }

    pointerOnAssistant(x, y) {
        let actor = global.stage.get_actor_at_pos(Clutter.PickMode.REACTIVE, x, y);
        while (actor) {
            if (actor === this._assistantButton)
                return true;
            actor = actor.get_parent();
        }
        return false;
    }

    /** Fits the view inside the top bar, like a notch, or below it. */
    set inBar(inBar) {
        if (inBar === this._inBar)
            return;
        this._inBar = inBar;
        const size = SIZES[inBar ? 'inBar' : 'hanging'];
        this._ring.resize(size.ring);
        this._musicArt.resize(size.music, 4);
        this._bars.maxHeight = size.bars;
        this._moon.icon_size = size.moon;
        this._callIcon.icon_size = this._micOff.icon_size = size.call;
        this._weatherIcon.icon_size = size.weather;
        this._phoneIcon.icon_size = size.weather;
        this._assistantButton.set_size(px(size.center), px(size.center));
        if (inBar)
            this.add_style_class_name('isle-compact-in-bar');
        else
            this.remove_style_class_name('isle-compact-in-bar');
        this._refresh();
    }

    /** Whether the user is away (no input for a while); the bars rest meanwhile, nobody is watching. */
    get idle() {
        return this._idle;
    }

    /** Starts or rests the bars. */
    set idle(idle) {
        this._idle = idle;
        this._assistant.alive = this.mapped && !idle;
        if (this.mapped && !idle)
            this._startAssistantPointerTracking();
        else
            this._stopAssistantPointerTracking();
        this._syncBars();
    }

    /** Picks what each side shows, and emits `width-changed` when the island needs another width. */
    _refresh() {
        const {nowPlaying, pomodoro} = this._daemon.state;
        const playing = Playback.isPlaying(nowPlaying);
        // A paused song stays until its player closes; none with the Music page left out.
        const hasTrack = Playback.hasTrack(nowPlaying) && !this._settings.get_strv('hidden-pages').includes('music');
        const focusVisible = !this._settings.get_strv('hidden-pages').includes('focus');
        const timerActive = Boolean(pomodoro && pomodoro.phase !== 'idle' && focusVisible);
        const recording = this._privacy.recording;
        const onCall = this._call.active;
        // The first connected device that reports a battery; its chip says the figure and says red when low.
        const phone = this._daemon.state.system?.devices?.find(device => device.battery !== null &&
            device.battery !== undefined) ?? null;
        this._phoneStatus.visible = !this._isServiceDown && Boolean(phone);
        if (phone) {
            this._phoneBattery.text = `${phone.battery}%`;
            this._phoneStatus.accessible_name = `${phone.name} battery ${phone.battery} percent`;
            this._phoneBattery.style = phone.battery <= 20 ? 'color: #ff453a;' : null;
        }
        // Split every live status across both sides in a stable priority order, so neither side is left
        // bare; a service failure replaces the statuses with a single warning.
        const statuses = this._isServiceDown ? [this._serviceDown] : [
            timerActive && this._timerStatus,
            recording && this._recordingStatus,
            onCall && this._callStatus,
            this._unseen > 0 && this._notificationStatus,
            hasTrack && this._musicStatus,
            this._weather.state.temperature && this._weatherStatus,
            phone && this._phoneStatus,
        ].filter(Boolean);
        this._spreadStatuses(statuses);
        // The cover sits in the left corner while the song plays; the placeholder stands while a
        // player sends no art.
        this._musicArt.visible = !this._isServiceDown && hasTrack;
        this._musicArt.setPath(this._isServiceDown || !hasTrack ? '' : nowPlaying.art_path);
        this._restDate.visible = !this._isServiceDown;
        this._privacyDots.visible = true;
        this._notificationCount.text = this._unseen > 9 ? '9+' : `${this._unseen || ''}`;
        this._micOff.visible = onCall && this._call.muted;

        // On a call the green phone already says the microphone is on, unless another app records too.
        const privacy = this._showingPrivacy() ? this._privacy : {};
        this._privacyDots.update({
            camera: privacy.camera,
            microphone: privacy.microphone && (!onCall || this._call.othersRecording),
            screenShare: privacy.screenShare,
        });

        const opacity = playing ? 255 : PAUSED_OPACITY;
        if (!restsAt(this._bars, 'opacity', opacity))
            this._bars.ease({opacity, duration: 200});
        this._syncBars();
        if (timerActive) {
            this._ring.color = timerColor(pomodoro.phase);
            this._refreshRing();
        } else {
            this._cancel('ring');
            this._cancel('timer');
        }
        if (recording)
            this._tickRecording();
        else
            this._cancel('recording');
        this._tickCall();
        this._tickTimer();

        // Visibility and text changes queue a relayout. Re-render on idle so the controller reads natural
        // sizes after St has processed the new statuses; an immediate measurement can still be cached.
        this.queue_relayout();
        if (this.mapped)
            this._queueWidthChanged();
    }

    _queueWidthChanged() {
        if (this._widthChangedIdle)
            return;
        this._widthChangedIdle = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            this._widthChangedIdle = 0;
            if (!this._destroyed)
                this.emit('width-changed');
            return GLib.SOURCE_REMOVE;
        });
    }

    /** The focus time, call length and recording length tick only while shown. */
    _tickTimer() {
        const {pomodoro} = this._daemon.state;
        if (!pomodoro || pomodoro.phase === 'idle' || !this._timerStatus.visible || !this.mapped) {
            this._cancel('timer');
            return;
        }
        const remaining = pomodoro.running ? Math.max(0, pomodoro.ends_at_ms - Format.nowMs()) : pomodoro.remaining_ms;
        this._timerTime.text = Format.duration(remaining);
        const [r, g, b] = timerColor(pomodoro.phase);
        const style = `color: rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)});`;
        if (this._timerTime.style !== style)
            this._timerTime.style = style;
        if (pomodoro.running)
            this._later('timer', remaining % 1000 || 1000, () => this._tickTimer());
        else
            this._cancel('timer');
    }

    /** The timer ring's progress, redrawn every few seconds while it shows. */
    _refreshRing() {
        const {pomodoro} = this._daemon.state;
        if (!pomodoro || pomodoro.phase === 'idle' || !this.mapped || !this._timerStatus.visible) {
            this._cancel('ring');
            return;
        }
        const remaining = pomodoro.running
            ? Math.max(0, pomodoro.ends_at_ms - Format.nowMs())
            : pomodoro.remaining_ms;
        this._ring.progress = 1 - remaining / pomodoro.duration_ms;
        if (pomodoro.running)
            this._later('ring', RING_REFRESH_S * 1000, () => this._refreshRing());
    }

    /** Bars dance only when on screen, the user is here and the song plays. */
    _syncBars() {
        this._bars.playing = this.mapped && !this._idle &&
            !this._settings.get_strv('hidden-pages').includes('music') && Playback.isPlaying(this._daemon.state.nowPlaying);
    }

    /** Shows how long the screen has been recording, once a second while on screen. */
    _tickRecording() {
        if (!this._privacy.recording || !this.mapped) {
            this._cancel('recording');
            return;
        }
        const elapsedMs = (GLib.get_monotonic_time() - this._privacy.recordingSince) / 1000;
        this._recordingTime.text = Format.duration(elapsedMs);
        this._later('recording', 1000 - (elapsedMs % 1000) + 10, () => this._tickRecording());
    }

    /** Shows how long the call has lasted, once a second while on screen. */
    _tickCall() {
        if (!this._call.active || !this.mapped) {
            this._cancel('call');
            return;
        }
        const elapsedMs = (GLib.get_monotonic_time() - this._call.since) / 1000;
        this._callTime.text = Format.duration(elapsedMs);
        this._later('call', 1000 - (elapsedMs % 1000) + 10, () => this._tickCall());
    }

    /** Sets the clock's text; `watchClock` calls it again as the minute changes. */
    _tickClock() {
        this._clock.text = Format.clockTime();
        const date = Format.longDate();
        if (date !== this._restDate.text) {
            this._restDate.text = date;
            if (this.mapped) {
                this.queue_relayout();
                this._queueWidthChanged();
            }
        }
    }

    /** Runs `callback` once after `ms`, replacing any timeout of the same name. */
    _later(name, ms, callback) {
        this._cancel(name);
        this._timeouts[name] = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(0, Math.round(ms)), () => {
            delete this._timeouts[name];
            callback();
            return GLib.SOURCE_REMOVE;
        });
    }

    /** Drops the timeout of that name, if any. */
    _cancel(name) {
        if (this._timeouts[name]) {
            GLib.source_remove(this._timeouts[name]);
            delete this._timeouts[name];
        }
    }

    /** Keep the resting face aware of the desktop pointer, even when it is outside the notch. */
    _startAssistantPointerTracking() {
        if (this._assistantPointerMotion || !this.mapped || this._idle)
            return;
        const followPointer = (_stage, event) => {
            const [x, y] = event.get_coords();
            this._assistant.lookAtPointer(x, y);
            return Clutter.EVENT_PROPAGATE;
        };
        const [x, y] = global.get_pointer();
        this._assistant.lookAtPointer(x, y);
        this._assistantPointerMotion = global.stage.connect('motion-event', followPointer);
    }

    _stopAssistantPointerTracking() {
        if (!this._assistantPointerMotion)
            return;
        global.stage.disconnect(this._assistantPointerMotion);
        this._assistantPointerMotion = 0;
    }

    /** The assistant's shape and colours, from Settings (see bot.js). */
    _botLook() {
        return {shape: this._settings.get_string('bot-shape'),
            palette: paletteFor(this._settings.get_string('bot-color'), this._settings.get_string('bot-glow'))};
    }

    /** Stops timers and signals, and destroys the signs not in a slot right now. */
    _onDestroy() {
        this._destroyed = true;
        if (this._widthChangedIdle) {
            GLib.source_remove(this._widthChangedIdle);
            this._widthChangedIdle = 0;
        }
        this._stopClock();
        this._stopAssistantPointerTracking();
        for (const name of Object.keys(this._timeouts))
            this._cancel(name);
        this._daemon.disconnect(this._daemonChanged);
        this._settings.disconnect(this._settingsChanged);
        this._settings.disconnect(this._openOnChanged);
        this._settings.disconnect(this._pagesChanged);
        for (const id of this._botLookChanged)
            this._settings.disconnect(id);
        this._privacy.disconnect(this._privacyChanged);
        this._call.disconnect(this._callChanged);
        this._weather.disconnect(this._weatherChanged);
        this._weather.destroy();
    }
});
