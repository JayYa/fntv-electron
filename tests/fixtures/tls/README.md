# 测试用证书

只给 `tests/proxyService.test.cjs` 的 HTTPS 假 NAS 用，不是真实凭据。

- `ca.pem`：测试用的私有 CA，私钥生成后已删除。
- `nas.pem`、`nas-key.pem`：这个 CA 签发的服务器证书和私钥，SAN 为 `IP:127.0.0.1` 和 `DNS:localhost`，有效期 100 年。

重新生成时，用 `openssl` 新建一个 CA，签发同样 SAN 的服务器证书，然后删掉 CA 私钥。
