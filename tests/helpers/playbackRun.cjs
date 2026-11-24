function beginRun(playback) {
    let run = null;
    void playback.runPlayback((started) => {
        run = started;
        return new Promise(() => {});
    });
    return run;
}

module.exports = { beginRun };
