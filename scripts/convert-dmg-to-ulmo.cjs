'use strict';

// electron-builder 的 afterAllArtifactBuild 钩子（package.json 的 build.afterAllArtifactBuild）：
// 打包完成后把每个 dmg 从默认的 UDZO（zlib）转成 ULMO（LZMA），其它安装包不动。
//
// - electron-builder 26.x 的 dmg.format 不收 ULMO，27 才支持。升级到 27 后改用 dmg.format: "ULMO"，删掉这个钩子。
// - hdiutil convert 按块复制卷内容，卷名、窗口布局、背景和 /Applications 链接都不变。文件名不变，
//   更新检查按文件名找安装包（src/modules/updater/githubRelease.ts 的 expectedAssetName）。
// - dmg 没有签名（mac.type 是 development，构建时 CSC_IDENTITY_AUTO_DISCOVERY=false），转换不会丢签名。
//   以后给 dmg 签名时要在转换后重新签。
// - dmg 的 blockmap 由 dmg.writeUpdateInfo: false 关掉：它按转换前的文件算出，转换后对不上。
//   更新检查只打开完整安装包的下载地址，不读 blockmap。
// - ULMO 要 macOS 10.15 及以上才能挂载，Electron 45 最低要 macOS 12。
// - 转换失败时抛错，打包命令失败，不会留下半成品。

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');

const ATTEMPTS = 3;

// hdiutil 偶尔报 “Resource temporarily unavailable”，隔几秒重试。
function hdiutil(args) {
    for (let attempt = 1; ; attempt++) {
        try {
            return execFileSync('hdiutil', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
        } catch (error) {
            if (attempt === ATTEMPTS) throw error;
            console.warn(`hdiutil ${args[0]} failed (attempt ${attempt}), retrying: ${error.message}`);
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, attempt * 5000);
        }
    }
}

function convertToUlmo(dmg) {
    const converted = dmg.replace(/\.dmg$/, '.ulmo.dmg');
    fs.rmSync(converted, { force: true });
    const before = fs.statSync(dmg).size;
    hdiutil(['convert', dmg, '-format', 'ULMO', '-o', converted]);
    const format = /^Format: (\S+)$/m.exec(hdiutil(['imageinfo', converted]));
    if (!format || format[1] !== 'ULMO') {
        throw new Error(`${converted} 转换后的格式不是 ULMO：${format ? format[1] : '未知'}`);
    }
    fs.renameSync(converted, dmg);
    console.log(`  • converted to ULMO  file=${dmg} size=${before} -> ${fs.statSync(dmg).size}`);
}

module.exports = async function convertDmgsToUlmo(buildResult) {
    for (const file of buildResult.artifactPaths.filter(file => file.endsWith('.dmg'))) {
        convertToUlmo(file);
    }
    return [];
};
