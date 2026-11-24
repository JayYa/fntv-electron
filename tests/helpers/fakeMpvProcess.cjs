class FakeMpvProcess {
    constructor(events, options) {
        this.events = events;
        this.options = options;
        this.path = '';
        this.properties = [];
        this.playlists = [];
        this.seeks = [];
        this.seekAttempts = 0;
        this.seekFailures = options.seekFailures ?? 0;
        this.subtitles = [];
        this.started = false;
        this.stopRequested = false;
        this.exited = false;
        this.pendingStart = null;
    }

    start() {
        if (this.options.startPending) {
            return new Promise((resolve, reject) => {
                this.pendingStart = {
                    finish: () => {
                        if (this.stopRequested) {
                            reject(new Error('stopped while starting'));
                            return;
                        }
                        this.started = true;
                        resolve();
                    },
                    fail: reject,
                };
            });
        }
        if (this.options.startError) {
            return Promise.reject(this.options.startError);
        }
        this.started = true;
        return Promise.resolve();
    }

    stop() {
        if (this.stopRequested || this.exited) return;
        this.stopRequested = true;
        if (!this.started) {
            this.pendingStart?.fail(new Error('stopped while starting'));
            return;
        }
        setImmediate(() => this.exit(0));
    }

    exit(code) {
        if (!this.started || this.exited) return;
        this.exited = true;
        this.events.onExit(this.stopRequested ? 0 : code);
    }

    delivering() {
        return this.started && !this.stopRequested && !this.exited;
    }

    emitProperty(property, value) {
        if (this.delivering()) this.events.onProperty(property, value);
    }

    emitTimePosition(seconds) {
        if (this.delivering()) this.events.onTimePosition(seconds);
    }

    emitSeek(seconds) {
        if (this.delivering()) this.events.onSeek(seconds);
    }

    command(run) {
        if (!this.delivering()) return Promise.reject(new Error('MPV is not running'));
        return Promise.resolve(run());
    }

    loadPlaylist(file) {
        return this.command(() => this.playlists.push(file));
    }

    setProperty(property, value) {
        return this.command(() => {
            this.properties.push([property, value]);
            return this.options.onSetProperty?.(property, value);
        });
    }

    seekTo(seconds) {
        if (this.delivering()) {
            this.seekAttempts++;
            if (this.seekFailures > 0) {
                this.seekFailures--;
                return Promise.reject(new Error('property unavailable'));
            }
        }
        return this.command(() => this.seeks.push(seconds));
    }

    addSubtitles(file) {
        return this.command(() => this.subtitles.push(file));
    }

    playbackInfo() {
        return this.command(() => ({ path: this.path, duration: 1500, percentage: 40 }));
    }
}

function fakeMpvProcesses(options = {}) {
    const started = [];
    return {
        createMpvProcess: (events) => {
            const mpv = new FakeMpvProcess(events, options);
            started.push(mpv);
            return mpv;
        },
        last: () => started[started.length - 1],
    };
}

module.exports = { fakeMpvProcesses };
