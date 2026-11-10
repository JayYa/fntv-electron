// 夸克测试共用：假 NAS 把 item-1 说成夸克直链媒体，直链指向假网盘。
const { startFakeFnMedia, serveBytes } = require('./fakeFnMedia.cjs');
const { startFakeDirectLink, directLinkStream } = require('./fakeDirectLink.cjs');
const { startProxy, get, sessionInput } = require('./proxyService.cjs');

const MIB = 1024 * 1024;
// 比两个 10MiB 分片还大，用来测跨分片边界和末尾。
const FILE = Buffer.from(Array.from({ length: 25 * MIB + 123 }, (_, index) => (index * 7 + (index >> 12)) % 256));

// 夸克是 type 4。
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

// 元信息照常是 206，取数据时网盘忽略 Range 返回整个文件。
function sizeThen(handler) {
    return (req, res) => (req.headers.range === 'bytes=0-0' ? serveBytes(req, res, FILE) : handler(req, res));
}

module.exports = { MIB, FILE, quarkSetup, sizeThen };
