#!/usr/bin/env node
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');

async function sha512Of(file) {
    const hash = crypto.createHash('sha512');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('base64');
}

async function checkMetadata(dir, name) {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) return { problems: ['file expected in the output directory, actual missing'] };
    let metadata;
    try {
        metadata = yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
    } catch (error) {
        return { problems: [`file expected valid YAML, actual ${error.message.split('\n')[0]}`] };
    }
    const files = Array.isArray(metadata.files) ? metadata.files : [];
    if (files.length === 0) return { problems: [`files expected at least one entry, actual ${files.length}`] };
    const invalid = files.findIndex(entry => entry === null || typeof entry !== 'object');
    if (invalid !== -1) {
        return { problems: [`files[${invalid}] expected a mapping with url, sha512 and size, actual ${JSON.stringify(files[invalid])}`] };
    }

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

main(process.argv.slice(2)).then(code => { process.exitCode = code; }, error => {
    console.log(`::error::check-update-metadata.cjs failed: ${error.message}`);
    process.exitCode = 1;
});
