const fs = require('node:fs');
const https = require('node:https');
const path = require('node:path');
const { app, dialog } = require('electron');

const scenario = JSON.parse(process.env.FNTV_ACCESS_CODE_SCENARIO);
const TLS = path.resolve(__dirname, '..', 'fixtures', 'tls');
const DEST = path.resolve(__dirname, '..', '..', 'dest');

app.setPath('userData', scenario.userData);
app.on('window-all-closed', () => undefined);

const answers = [...scenario.answers];
const dialogs = [];
dialog.showMessageBox = async (...args) => {
    const options = args.length > 1 ? args[1] : args[0];
    dialogs.push(options.title);
    const answer = answers.shift() ?? 'cancel';
    return { response: answer === 'cancel' ? 1 : 0, checkboxChecked: answer === 'trust and remember' };
};

function startFakeNas() {
    const server = https.createServer({
        cert: fs.readFileSync(path.join(TLS, 'nas.pem')),
        key: fs.readFileSync(path.join(TLS, 'nas-key.pem')),
    }, (request, response) => {
        if (request.url === '/access_code_verify' && request.headers['x-access-code']) {
            response.writeHead(200, { 'Set-Cookie': 'access-session=granted; Path=/; Secure' });
        } else {
            response.writeHead(404);
        }
        response.end();
    });
    return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server)));
}

async function attempt(baseUrl) {
    const { establishAccessCodeSession } = require(path.join(DEST, 'main', 'common', 'accessCodeSession.js'));
    try {
        const result = await establishAccessCodeSession(baseUrl, '123456');
        return { ok: true, cookie: result.cookie };
    } catch (error) {
        return { ok: false, reason: error.reason, message: error.message };
    }
}

app.whenReady().then(async () => {
    require(path.join(DEST, 'main', 'common', 'webUiSession.js')).trustCertificates();
    const server = await startFakeNas();
    const baseUrl = `https://127.0.0.1:${server.address().port}`;
    if (scenario.remembered) {
        fs.writeFileSync(path.join(scenario.userData, 'trusted-hosts.json'), JSON.stringify([`127.0.0.1:${server.address().port}`]));
    }
    const attempts = [];
    for (let i = 0; i < scenario.attempts; i++) attempts.push(await attempt(baseUrl));
    process.stdout.write(`${JSON.stringify({ attempts, dialogs })}\n`);
    server.close();
    app.exit(0);
}).catch(error => {
    process.stderr.write(`${error.stack}\n`);
    app.exit(1);
});
