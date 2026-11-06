/**
 * 生成注入 WebView 的 JavaScript 脚本，不含任何凭据
 * 功能：
 * 1. Hook XHR 和 Fetch，拦截 /oauthapi/authorize 响应获取 code
 * 2. 拦截 /sac/rpcproxy/v1/new-user-guide/status 获取 Cookie
 * 3. 在 /signin 页面自动点击授权按钮
 * 4. 在非 /login 页面获取 sys_config
 */
export function getInjectionScript(): string {
    return `
        (function() {
            console.log("[fntv-electron] Injecting FN ID Login Interceptor...");

            function postMessage(payload) {
                try {
                    payload = payload || {};
                    payload.cookie = document.cookie;
                    window.__fntvBridge(JSON.stringify(payload));
                } catch (e) {
                    console.error("[fntv-electron] postMessage error:", e);
                }
            }

            // 在 /signin 页面自动点击授权按钮
            if (window.location.href.indexOf('/signin') !== -1) {
                setTimeout(function() {
                    var btns = document.querySelectorAll('button');
                    for (var i = 0; i < btns.length; i++) {
                        if (/授权|允许|同意/.test(btns[i].innerText || '')) {
                            btns[i].click();
                            break;
                        }
                    }
                }, 200);
            }

            // Hook XMLHttpRequest
            var originalOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function(method, url) {
                this._method = method;
                this._url = url;
                this._headers = {};
                return originalOpen.apply(this, arguments);
            };

            var originalSetRequestHeader = XMLHttpRequest.prototype.setRequestHeader;
            XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
                this._headers[header] = value;
                return originalSetRequestHeader.apply(this, arguments);
            };

            var originalSend = XMLHttpRequest.prototype.send;
            XMLHttpRequest.prototype.send = function(body) {
                var self = this;
                var originalOnReadyStateChange = self.onreadystatechange;
                self.onreadystatechange = function() {
                    if (self.readyState === 4) {
                        if (self._url && self._url.indexOf("/oauthapi/authorize") !== -1) {
                            try {
                                var json = JSON.parse(self.responseText || "{}");
                                var code = json && json.data ? json.data.code : null;
                                if (code) {
                                    postMessage({ type: "Response", url: self._url, code: String(code) });
                                } else {
                                    postMessage({ type: "Response", url: self._url, body: self.responseText || "" });
                                }
                            } catch (e) {
                                postMessage({ type: "Response", url: self._url, body: self.responseText || "" });
                            }
                        }
                    }
                    if (originalOnReadyStateChange) {
                        originalOnReadyStateChange.apply(this, arguments);
                    }
                };

                if (this._url && this._url.indexOf("/sac/rpcproxy/v1/new-user-guide/status") !== -1) {
                    postMessage({ type: "XHR", url: this._url, headers: (this._headers || {}) });
                }
                return originalSend.apply(this, arguments);
            };

            // Hook Fetch
            var originalFetch = window.fetch;
            window.fetch = function(input, init) {
                var url = input;
                if (typeof input === 'object' && input.url) {
                    url = input.url;
                }

                if (url && url.indexOf("/sac/rpcproxy/v1/new-user-guide/status") !== -1) {
                    var headers = {};
                    if (init && init.headers) {
                        var h = init.headers;
                        if (h instanceof Headers) {
                            h.forEach(function(value, key) { headers[key] = value; });
                        } else {
                            for (var key in h) {
                                if (h.hasOwnProperty(key)) headers[key] = h[key];
                            }
                        }
                    }
                    postMessage({ type: "XHR", url: url, headers: headers });
                }

                return originalFetch.apply(this, arguments).then(function(response) {
                    if (url && url.indexOf("/oauthapi/authorize") !== -1) {
                        var clone = response.clone();
                        clone.text().then(function(text) {
                            try {
                                var json = JSON.parse(text || "{}");
                                var code = json && json.data ? json.data.code : null;
                                if (code) {
                                    postMessage({ type: "Response", url: url, code: String(code) });
                                } else {
                                    postMessage({ type: "Response", url: url, body: text || "" });
                                }
                            } catch (e) {
                                postMessage({ type: "Response", url: url, body: text || "" });
                            }
                        });
                    }
                    return response;
                });
            };

            // 获取 sys_config（在非 /login 页面执行）
            function fetchSysConfigOnce() {
                try {
                    if (window.__fntv_sys_config_requested) return;
                    if (window.location.href.indexOf('/login') !== -1) return;
                    window.__fntv_sys_config_requested = true;
                    fetch('/v/api/v1/sys/config', { credentials: 'include' })
                        .then(function(r) {
                            var contentType = r.headers.get('content-type') || '';
                            if (!r.ok || contentType.indexOf('application/json') === -1) {
                                throw new Error('sys/config did not return JSON');
                            }
                            return r.text();
                        })
                        .then(function(text) {
                            postMessage({
                                type: "SysConfig",
                                url: "/v/api/v1/sys/config",
                                body: text || ""
                            });
                        })
                        .catch(function() {
                            window.__fntv_sys_config_requested = false;
                        });
                } catch (e) {
                    window.__fntv_sys_config_requested = false;
                }
            }

            setTimeout(fetchSysConfigOnce, 800);
            console.log("[fntv-electron] FN ID Login Interceptor Injected.");
        })();
    `;
}

/**
 * 主进程判断页面和脚本执行之间页面可能已经换了，所以脚本先核对 origin 再读取凭据。
 */
export function getLoginAutofillScript(username: string, password: string, pageUrl: string): string {
    const page = new URL(pageUrl);
    return `
        (function() {
            if (window.location.origin !== ${JSON.stringify(page.origin)}
                || window.location.pathname !== ${JSON.stringify(page.pathname)}) return;

            var AUTO_LOGIN_USER = ${JSON.stringify(username)};
            var AUTO_LOGIN_PASS = ${JSON.stringify(password)};

            function triggerInput(input, value) {
                var nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                nativeInputValueSetter.call(input, value);
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new Event('change', { bubbles: true }));
            }

            setTimeout(function() {
                var uInput = document.querySelector('#username, input[name="username"], input[autocomplete="username"]');
                var pInput = document.querySelector('#password, input[name="password"], input[type="password"]');
                if (uInput && AUTO_LOGIN_USER) {
                    triggerInput(uInput, AUTO_LOGIN_USER);
                    if (AUTO_LOGIN_PASS && pInput) {
                        triggerInput(pInput, AUTO_LOGIN_PASS);
                        // 自动点击登录按钮
                        setTimeout(function() {
                            var btn = document.querySelector('button[type="submit"]');
                            if (btn) btn.click();
                        }, 200);
                    }
                }
            }, 200);
        })();
    `;
}

export function getAccessCodeInjectionScript(accessCode: string, pageUrl: string): string {
    return `
        (function() {
            if (window.location.origin !== ${JSON.stringify(new URL(pageUrl).origin)}) return false;
            var input = document.querySelector('#access-code-input, input[name="access-code"]');
            var form = input ? input.closest('form') : null;
            var title = document.querySelector('#page-title');
            if (!input || !form || !title || title.textContent.trim() !== '请输入访问码') return false;
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, ${JSON.stringify(accessCode)});
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new Event('change', { bubbles: true }));
            if (typeof form.requestSubmit === 'function') {
                form.requestSubmit();
            } else {
                var submit = form.querySelector('button[type="submit"], input[type="submit"]');
                if (submit) submit.click();
            }
            return true;
        })();
    `;
}
