const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { TARGETS } = require('./smoke/targets.cjs');
const { asList, root, runStep, workflow } = require('./helpers/workflowSteps.cjs');
const { UPDATE_FEED_URL, UPDATE_METADATA } = require('./helpers/updateFeed.cjs');

const BUILD_AND_SMOKE = './.github/workflows/build-and-smoke.yml';
const BUILD = './.github/workflows/build.yml';

function runStepOutputs(t, job, stepId, env) {
    const result = runStep(t, job, step => step.id === stepId, env);
    assert.equal(result.status, 0, result.stderr);
    return result.outputs;
}

function smokeTargetsOf(t, platform) {
    const outputs = runStepOutputs(t, workflow('build-and-smoke.yml').jobs['select-targets'], 'targets', { PLATFORM: platform });
    return JSON.parse(outputs['smoke-matrix']).include.map(entry => entry.target);
}

function smokeJobsOf(release) {
    return Object.entries(release.jobs).filter(([, job]) => job.uses === BUILD_AND_SMOKE);
}

function platformsOfTargets() {
    return [...new Set(Object.values(TARGETS).map(target => target.platform))].sort();
}

test('publishing a release waits for every build-and-smoke job to succeed', () => {
    const release = workflow('release.yml');
    const smokeJobs = smokeJobsOf(release).map(([name]) => name);
    assert.ok(smokeJobs.length > 0, 'release.yml does not call build-and-smoke.yml');

    const publish = release.jobs.publish;
    const needs = asList(publish.needs);
    for (const name of smokeJobs) {
        assert.ok(needs.includes(name), `publish.needs is missing ${name}`);
        assert.match(publish.if, new RegExp(`needs\\.${name}\\.result == 'success'`), `publish.if does not require ${name} to succeed`);
    }
    assert.doesNotMatch(publish.if, /always\(\)|cancelled\(\)|failure\(\)/);
});

test('the installers uploaded to the release are the ones the smoke tests ran on', () => {
    const release = workflow('release.yml');
    for (const [name, job] of Object.entries(release.jobs)) {
        assert.notEqual(job.uses, BUILD, `${name} builds installers without smoke testing them`);
    }
    assert.equal(smokeJobsOf(release).length, 1);
    const download = release.jobs.publish.steps.find(step => String(step.uses).startsWith('actions/download-artifact@'));
    assert.equal(download.with.pattern, '*-build');
});

test('a release is smoke tested on all five targets', t => {
    const release = workflow('release.yml');
    const [[name, job]] = smokeJobsOf(release);
    const outputs = runStepOutputs(t, release.jobs[asList(job.needs).find(need => need !== 'release-please')], 'matrix', { PLATFORM: 'all' });
    const platforms = JSON.parse(outputs.platforms);
    assert.match(job.strategy.matrix.platform, /fromJSON\(needs\.select-matrix\.outputs\.platforms\)/, name);
    assert.deepEqual(platforms.flatMap(platform => smokeTargetsOf(t, platform)).sort(), Object.keys(TARGETS).sort());
    assert.equal(Object.keys(TARGETS).length, 5);
});

test('macOS installers are smoke tested natively: darwin-x64 on an Intel runner, without Rosetta', t => {
    const job = workflow('build-and-smoke.yml').jobs['select-targets'];
    const outputs = runStepOutputs(t, job, 'targets', { PLATFORM: 'macos' });
    assert.equal(outputs['build-os'], 'macos-latest');
    const runners = Object.fromEntries(JSON.parse(outputs['smoke-matrix']).include.map(entry => [entry.target, entry.runner]));
    assert.deepEqual(runners, { 'darwin-arm64': 'macos-latest', 'darwin-x64': 'macos-26-intel' });
    const steps = workflow('build-and-smoke.yml').jobs.smoke.steps;
    assert.ok(!steps.some(step => /rosetta/i.test(`${step.name} ${step.run ?? ''}`)), 'the smoke job still installs Rosetta');
});

test('release.yml builds only for a release or a manual run, never for a Release PR branch', () => {
    const release = workflow('release.yml');
    const releasePlease = release.jobs['release-please'];
    assert.ok(!('prs_created' in releasePlease.outputs), 'release-please exposes prs_created');
    assert.ok(!('pr' in releasePlease.outputs), 'release-please exposes pr');

    const [[name, job]] = smokeJobsOf(release);
    const selectMatrix = release.jobs[asList(job.needs).find(need => need !== 'release-please')];
    assert.doesNotMatch(selectMatrix.if, /prs_created/);
    assert.equal(job.with.ref, '${{ needs.release-please.outputs.sha || github.sha }}', name);
    assert.doesNotMatch(fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8'), /headBranchName|prs_created/);
});

test('a Release PR is smoke tested by smoke-test.yml because it always changes package.json', () => {
    const smoke = workflow('smoke-test.yml');
    const pullRequest = smoke.on.pull_request;
    assert.ok(pullRequest, 'smoke-test.yml has no pull_request trigger');
    assert.ok(pullRequest.paths.includes('package.json'), 'smoke-test.yml does not run when package.json changes');
    assert.equal(pullRequest.branches, undefined, 'smoke-test.yml filters pull_request by base branch');
    assert.equal(pullRequest['paths-ignore'], undefined);
    assert.match(smoke.jobs.smoke.strategy.matrix.platform, /'\["linux","macos","windows"\]'/);
});

test('each platform in the workflows smoke tests exactly its targets from targets.cjs', t => {
    const platforms = platformsOfTargets();
    assert.deepEqual(platforms, ['linux', 'macos', 'windows']);
    for (const platform of platforms) {
        const expected = Object.keys(TARGETS).filter(id => TARGETS[id].platform === platform).sort();
        assert.deepEqual(smokeTargetsOf(t, platform).sort(), expected, platform);
    }

    const smoke = workflow('smoke-test.yml');
    const prPlatforms = JSON.parse(smoke.jobs.smoke.strategy.matrix.platform.match(/'(\[(?:"[a-z]+",?)+\])'/)[1]);
    assert.deepEqual(prPlatforms.sort(), platforms);
    assert.deepEqual(smoke.on.workflow_dispatch.inputs.platform.options.filter(option => option !== 'all').sort(), platforms);
    const releaseOptions = workflow('release.yml').on.workflow_dispatch.inputs.platform.options;
    for (const platform of platforms) {
        assert.ok(releaseOptions.includes(platform), `release.yml workflow_dispatch has no ${platform}`);
    }
});

const checkReleaseAssets = step => step.name === 'Check release assets';

function missingReleaseAssets(t) {
    const missing = runStep(t, workflow('release.yml').jobs.publish, checkReleaseAssets, { VERSION: '9.9.9' }, cwd => fs.mkdirSync(path.join(cwd, 'dist')));
    assert.notEqual(missing.status, 0);
    return [...missing.stdout.matchAll(/^::error::missing (.+)$/gm)].map(match => match[1]);
}

function runAssetCheckWith(t, names) {
    return runStep(t, workflow('release.yml').jobs.publish, checkReleaseAssets, { VERSION: '9.9.9' }, cwd => {
        fs.mkdirSync(path.join(cwd, 'dist'));
        for (const name of names) fs.writeFileSync(path.join(cwd, 'dist', name), '');
    });
}

test('publish checks for exactly one installer per smoke target', t => {
    const names = missingReleaseAssets(t).filter(name => !UPDATE_METADATA.includes(name));
    for (const [id, target] of Object.entries(TARGETS)) {
        assert.equal(names.filter(name => target.installerPattern.test(name)).length, 1, `${id}: ${names.join(', ')}`);
    }
    assert.equal(names.length, Object.keys(TARGETS).length, names.join(', '));
});

test('publish checks for the update metadata of Windows, Linux x64 and Linux arm64', t => {
    const names = missingReleaseAssets(t);
    assert.deepEqual(names.filter(name => /\.yml$/.test(name)).sort(), [...UPDATE_METADATA].sort());

    const present = runAssetCheckWith(t, names);
    assert.equal(present.status, 0, present.stdout + present.stderr);
    for (const absent of UPDATE_METADATA) {
        const result = runAssetCheckWith(t, names.filter(name => name !== absent));
        assert.notEqual(result.status, 0, `publish proceeds without ${absent}`);
        assert.match(result.stdout, new RegExp(`^::error::missing ${absent.replace(/\./g, '\\.')}$`, 'm'));
    }
});

test('the build artifact carries the update metadata next to the installers', () => {
    const upload = workflow('build.yml').jobs.build.steps.find(step => step.name === 'Upload build artifacts');
    const paths = upload.with.path.split('\n').map(line => line.trim()).filter(Boolean);
    assert.ok(paths.includes('release/latest*.yml'), paths.join(', '));
    assert.equal(upload.with['if-no-files-found'], 'error');
});

const checkUpdateMetadata = step => step.name === 'Check update metadata';

function checkedUpdateMetadata(t, platform) {
    const result = runStep(t, workflow('build.yml').jobs.build, checkUpdateMetadata, {
        PLATFORM: platform,
        NODE_PATH: path.join(root, 'node_modules'),
    }, cwd => {
        fs.mkdirSync(path.join(cwd, 'scripts'));
        fs.copyFileSync(path.join(root, 'scripts', 'check-update-metadata.cjs'), path.join(cwd, 'scripts', 'check-update-metadata.cjs'));
        fs.mkdirSync(path.join(cwd, 'release'));
    });
    assert.notEqual(result.status, 0, `${platform}: ${result.stdout}${result.stderr}`);
    return [...result.stdout.matchAll(/^::error::(\S+): file expected in the output directory, actual missing$/gm)].map(match => match[1]);
}

test('the build checks the update metadata against the installers after packaging and before uploading', () => {
    const steps = workflow('build.yml').jobs.build.steps;
    const index = name => steps.findIndex(step => step.name === name);
    const check = steps.findIndex(checkUpdateMetadata);
    assert.notEqual(check, -1, 'build.yml has no Check update metadata step');
    assert.ok(index('Build application') < check, 'the check must run after Build application');
    assert.ok(check < index('Upload build artifacts'), 'the check must run before Upload build artifacts');
    assert.equal(steps[check].if, "inputs.platform != 'macos'");
    assert.equal(steps[check].env.PLATFORM, '${{ inputs.platform }}');
});

test('the build checks latest.yml on Windows and both Linux metadata files on Linux', t => {
    const windows = checkedUpdateMetadata(t, 'windows');
    const linux = checkedUpdateMetadata(t, 'linux');
    assert.deepEqual(windows, ['latest.yml']);
    assert.deepEqual(linux, ['latest-linux.yml', 'latest-linux-arm64.yml']);
    assert.deepEqual([...windows, ...linux].sort(), [...UPDATE_METADATA].sort());
});

test('electron-builder publishes to the latest release download URL of this repository', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    assert.deepEqual(pkg.build.publish, { provider: 'generic', url: UPDATE_FEED_URL });
    assert.equal(pkg.build.artifactName, 'FNMedia_${version}_${os}_${arch}.${ext}');
    for (const script of ['build:win', 'build:mac', 'build:linux:x64', 'build:linux:arm64']) {
        assert.match(pkg.scripts[script], /--publish never/, script);
    }
});

test('running the Release workflow by hand builds and smoke tests but does not publish', () => {
    const release = workflow('release.yml');
    assert.ok('workflow_dispatch' in release.on);
    assert.match(release.jobs['release-please'].if, /github\.event_name == 'push'/);
    assert.match(release.jobs.publish.if, /needs\.release-please\.outputs\.release_created == 'true'/);
    const [, job] = smokeJobsOf(release)[0];
    assert.match(job.if, /!cancelled\(\)/);
});

test('only release-please and publish can write to the repository', () => {
    const release = workflow('release.yml');
    assert.deepEqual(release.permissions, { contents: 'read' });
    assert.deepEqual(release.jobs.publish.permissions, { contents: 'write' });
    for (const [name, job] of Object.entries(release.jobs)) {
        if (name === 'release-please' || name === 'publish') continue;
        assert.ok(!Object.values(job.permissions ?? {}).includes('write'), `${name} has write permissions`);
    }
});
