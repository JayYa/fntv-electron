// 已发的客户端按这些值找应用内更新，改了就收不到新版本（CODING_STANDARDS.md 的「稳定标识」）。

// electron-updater 的更新源，package.json 的 build.publish 和 updateChecker.ts 都指向它。
const UPDATE_FEED_URL = 'https://github.com/JayYa/fntv-electron/releases/latest/download/';

// 应用内更新读的更新元数据：Windows 一个，Linux x64 和 arm64 各一个。macOS 不做应用内更新，不核对。
const UPDATE_METADATA = ['latest.yml', 'latest-linux.yml', 'latest-linux-arm64.yml'];

module.exports = { UPDATE_FEED_URL, UPDATE_METADATA };
