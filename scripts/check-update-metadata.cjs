#!/usr/bin/env node
// 核对更新元数据：electron-builder 打包后，latest*.yml 记录的安装包文件名、size 和 sha512 要和输出目录里的
// 实际文件一致，否则客户端按元数据下载的安装包校验不过，应用内更新失败（docs/adr/0003-release-gate.md）。
// 构建 workflow（build.yml）在打包之后、上传 artifact 之前运行。
// 用法：check-update-metadata.cjs <输出目录> <元数据文件名>...
// 每个问题输出一条 GitHub ::error:: annotation，有问题时退出码为 1；全部一致时每个元数据文件打印一行摘要。
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

async function sha512Of(file) {
    const hash = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('base64');
}

// 一个元数据文件的问题列表（每条是“字段 expected 期望值, actual 实际值”）和全部一致时的摘要。
async function checkMetadata(dir, name) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return { problems: ['file expected in the output directory, actual missing'] };
    const metadata = yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
    const files = Array.isArray(metadata.files) ? metadata.files : [];
    if (files.length === 0) return { problems: [`files expected at least one entry, actual ${files.length}`] };

    const problems = [];
    if (metadata.path !== files[0].url) {
        problems.push(`path expected ${files[0].url} (files[0].url), actual ${metadata.path}`);
        if (!fs.existsSync(path.join(dir, String(metadata.path)))) {
            problems.push(`path expected ${metadata.path} in the output directory, actual missing`);
        }
    }
    if (metadata.sha512 !== files[0].sha512) {
        problems.push(`sha512 expected ${files[0].sha512} (files[0].sha512), actual ${metadata.sha512}`);
    }
    for (const [index, entry] of files.entries()) {
        const installer = path.join(dir, String(entry.url));
        if (!fs.existsSync(installer)) {
            problems.push(`files[${index}].url expected ${entry.url} in the output directory, actual missing`);
            continue;
        }
        const size = fs.statSync(installer).size;
        if (entry.size !== size) problems.push(`files[${index}].size expected ${entry.size}, actual ${size}`);
        const sha512 = await sha512Of(installer);
        if (entry.sha512 !== sha512) problems.push(`files[${index}].sha512 expected ${entry.sha512}, actual ${sha512}`);
    }
    const summary = files.map(entry => `${entry.url} (${entry.size} bytes, sha512 ${entry.sha512})`).join(', ');
    return { problems, summary: `${name}: ${summary} match the installers` };
}

async function main(args) {
    if (args.length < 2) {
        process.stderr.write('用法：check-update-metadata.cjs <输出目录> <元数据文件名>...\n');
        return 2;
    }
    const [dir, ...names] = args;
    let failed = false;
    for (const name of names) {
        const { problems, summary } = await checkMetadata(dir, name);
        for (const problem of problems) console.log(`::error::${name}: ${problem}`);
        if (problems.length > 0) failed = true;
        else console.log(summary);
    }
    return failed ? 1 : 0;
}

main(process.argv.slice(2)).then(code => { process.exitCode = code; });
