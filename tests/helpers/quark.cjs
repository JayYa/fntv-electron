const { startFakeFnMedia, serveBytes } = require('./fakeFnMedia.cjs');
const { startFakeDirectLink, directLinkStream } = require('./fakeDirectLink.cjs');
const { startProxy, get, sessionInput } = require('./proxyService.cjs');

const MIB = 1024 * 1024;
const FILE = Buffer.from(Array.from({ length: 25 * MIB + 123 }, (_, index) => (index * 7 + (index >> 12)) % 256));

async function quarkSetup(t, driveOptions = {}, streamOptions = {}, proxyOptions = {}) {
    const drive = await startFakeDirectLink(t, { media: FILE, ...driveOptions });
    const nas = await startFakeFnMedia(t, {
        streams: { 'item-1': ['media-1'] },
        handlers: { stream: directLinkStream({ urls: [`${drive.origin}/quark.mkv?sign=secret-token`], cloudType: 4, ...streamOptions }) },
    });
    const { service, logs } = await startProxy(t, proxyOptions);
    const session = service.createPlaybackSession(sessionInput(nas));
    const play = (headers = {}) => get(service, `/api/v1/playvideo/item-1?session=${session}`, headers);
    return { drive, nas, service, logs, play };
}

function sizeThen(handler) {
    return (req, res) => (req.headers.range === 'bytes=0-0' ? serveBytes(req, res, FILE) : handler(req, res));
}

module.exports = { MIB, FILE, quarkSetup, sizeThen };
