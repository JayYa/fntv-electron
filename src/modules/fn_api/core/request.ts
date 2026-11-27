import * as crypto from 'crypto';
import axios, { AxiosResponse } from 'axios';
import { setTimeout } from 'timers/promises';
import https from 'https';
import { isCertificateError } from './certificateError';
import { composeCookieHeader } from './cookie';
import { isHttpsPortMismatch } from './httpsPortMismatch';

const api_key = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const api_secret = '16CCEB3D-AB42-077D-36A1-F355324E4237';

export type FnApiFailureKind = 'certificate' | 'https-port-mismatch' | 'failed';

export interface FnApiFailure {
    kind: FnApiFailureKind;
    message: string;
}

export type FnApiResult<T = any> =
    | { ok: true; data: T; movedTo?: string }
    | { ok: false; failure: FnApiFailure };

const failure = (kind: FnApiFailureKind, message: string): FnApiResult<never> => ({ ok: false, failure: { kind, message } });
const failed = (message: string): FnApiResult<never> => failure('failed', message);

export interface FnApiResponseData<T = any> {
    code: number;
    msg: string;
    data: T;
}

export enum HttpMethod {
    GET = 'get',
    POST = 'post',
    PUT = 'put',
    DELETE = 'delete'
}

export function getMd5(text: string): string {
    return crypto.createHash('md5').update(text, 'utf8').digest('hex');
}

export function generateRandomDigits(start: number = 100000, end: number = 1000000): string {
    return Math.floor(Math.random() * (end - start) + start).toString();
}

export function genFnAuthx(url: string, data?: any): string {
    const nonce = generateRandomDigits();
    const timestamp = Date.now();
    const dataJson = data ? JSON.stringify(data) : '';
    const dataJsonMd5 = getMd5(dataJson);

    const signArray = [
        api_key,
        url,
        nonce,
        timestamp.toString(),
        dataJsonMd5,
        api_secret
    ];

    const signStr = signArray.join('_');
    return `nonce=${nonce}&timestamp=${timestamp}&sign=${getMd5(signStr)}`;
}

export const DEFAULT_TIMEOUT = 10000;

export type LogMethod = (message: string, ...args: any[]) => void;

export interface RequestContext {
    accessCookie(baseUrl: string): string;
    skipVerify(baseUrl: string): boolean;
    log: { warn: LogMethod; error: LogMethod; debug?: LogMethod };
    ca?: string[];
}

const agentsWithoutCa = new Map<string, https.Agent>();
const agentsByCa = new WeakMap<string[], Map<string, https.Agent>>();

function httpsAgent(rejectUnauthorized: boolean, ca: string[] | undefined, timeout: number): https.Agent {
    let agents = agentsWithoutCa;
    if (ca) {
        agents = agentsByCa.get(ca) ?? new Map();
        agentsByCa.set(ca, agents);
    }
    const key = `${rejectUnauthorized}|${timeout}`;
    let agent = agents.get(key);
    if (!agent) {
        agent = new https.Agent({
            rejectUnauthorized,
            ...(ca ? { ca } : {}),
            keepAlive: true,
            timeout,
            maxSockets: 10,
        });
        agents.set(key, agent);
    }
    return agent;
}

const MAX_REDIRECTS = 5;

function fnApiBody<T>(body: FnApiResponseData<T> | string): Partial<FnApiResponseData<T>> {
    if (typeof body !== 'string') return body;
    try {
        return JSON.parse(body);
    } catch {
        return {};
    }
}

export type ResponseExpectation = 'json' | 'raw';

export interface FnApiRequest {
    baseUrl: string;
    path: string;
    method: HttpMethod;
    token: string;
    data?: any;
    cookie?: string;
    timeout?: number;
    retries?: number;
    expect?: ResponseExpectation;
}

type ResolvedRequest = Required<Omit<FnApiRequest, 'data' | 'cookie'>> & Pick<FnApiRequest, 'data' | 'cookie'>;

export async function request<T = any>(context: RequestContext, req: FnApiRequest): Promise<FnApiResult<T>> {
    const result = await followingRedirects<T>(context, {
        ...req,
        timeout: req.timeout ?? DEFAULT_TIMEOUT,
        retries: req.retries ?? 5,
        expect: req.expect ?? 'json',
    }, MAX_REDIRECTS);
    if (result.ok && result.movedTo && originOf(result.movedTo) === originOf(req.baseUrl)) {
        const { movedTo: _unchanged, ...sameOrigin } = result;
        return sameOrigin;
    }
    return result;
}

function originOf(baseUrl: string): string {
    return new URL(baseUrl).origin;
}

function describeOriginChange(from: string, to: string): string {
    const before = new URL(from);
    const after = new URL(to);
    const changed = [
        before.protocol !== after.protocol ? '协议' : '',
        before.hostname !== after.hostname ? '主机' : '',
        before.port !== after.port ? '端口' : '',
    ].filter(Boolean);
    return changed.length > 0 ? `换了${changed.join('、')}` : 'NAS 地址不变';
}

async function followingRedirects<T>(
    context: RequestContext,
    req: ResolvedRequest,
    redirectsLeft: number,
): Promise<FnApiResult<T>> {
    const { method, token, timeout, retries, expect, path: url } = req;
    const normalizedBaseUrl = req.baseUrl.replace(/\/+$/, '');
    const fullUrl = normalizedBaseUrl + url;
    let data = req.data;
    if (method === HttpMethod.POST || method === HttpMethod.PUT) {
        data = data || {};
        data["nonce"] = generateRandomDigits();
    }

    const authx = genFnAuthx(url, data);

    const headers = {
        "Content-Type": "application/json",
        "Authorization": token,
        "Authx": authx,
        "Cookie": composeCookieHeader(context.accessCookie(normalizedBaseUrl), req.cookie),
    };

    const shouldIgnoreCert = context.skipVerify(normalizedBaseUrl);

    const config = {
        headers,
        timeout: timeout,
        maxRedirects: 0,
        validateStatus: (status: number) => status >= 200 && status < 400,
        httpsAgent: httpsAgent(!shouldIgnoreCert, context.ca, timeout),
        ...(expect === 'raw' ? { responseType: 'text' as const } : {}),
    };

    for (let attempt = 0; ; attempt++) {
        try {
            let response: AxiosResponse<FnApiResponseData<T>>;

            switch (method) {
                case HttpMethod.GET: response = await axios.get(fullUrl, config); break;
                case HttpMethod.POST: response = await axios.post(fullUrl, data, config); break;
                case HttpMethod.PUT: response = await axios.put(fullUrl, data, config); break;
                case HttpMethod.DELETE: response = await axios.delete(fullUrl, config); break;
                default: throw new Error(`Unsupported method: ${method}`);
            }

            if ([301, 302, 307, 308].includes(response.status)) {
                const location = response.headers.location;

                if (location) {
                    if (redirectsLeft <= 0) {
                        return failed(`重定向次数过多（超过 ${MAX_REDIRECTS} 次）`);
                    }

                    let newBaseUrl = normalizedBaseUrl;
                    let newUrlPath = location;

                    if (location.startsWith('http')) {
                        const parsedUrl = new URL(location);
                        newBaseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
                        newUrlPath = parsedUrl.pathname + parsedUrl.search;
                    }
                    const hop = MAX_REDIRECTS - redirectsLeft + 1;
                    context.log.warn(`检测到重定向 (${response.status})，第 ${hop} 次，${describeOriginChange(normalizedBaseUrl, newBaseUrl)}`);

                    const followed = await followingRedirects<T>(
                        context,
                        { ...req, baseUrl: newBaseUrl, path: newUrlPath, data },
                        redirectsLeft - 1,
                    );
                    if (!followed.ok || followed.movedTo) return followed;
                    return { ...followed, movedTo: newBaseUrl };
                }
                context.log.warn(`检测到重定向 (${response.status})，但响应没有 Location`);
            }

            const contentType = response.headers['content-type'];
            if (typeof contentType !== 'string' || !contentType.includes('application/json')) {
                if (expect === 'raw') {
                    return { ok: true, data: response.data as any };
                }
                return failed(`响应不是 JSON（HTTP ${response.status}，Content-Type: ${contentType ?? '缺失'}）`);
            }

            const res = fnApiBody<T>(response.data);

            if (res.code === 5000 && res.msg === 'invalid sign') {
                if (attempt >= retries) {
                    return failed(`签名错误，已尝试 ${attempt + 1} 次`);
                }

                context.log.warn(`fn_api 请求时签名错误，重试中 attempt = ${attempt + 1}, path: ${url}`);
                await setTimeout(100);
                continue;
            }

            if (res.code !== 0) {
                context.log.error(`fn_api 请求失败`, res);
                return failed(res.msg || `HTTP Error ${response.status}`);
            }

            return { ok: true, data: res.data as T };

        } catch (error: any) {
            const errorCode = error.code || 'UNKNOWN';
            const errorMsg = error.message;
            const responseStatus = error.response?.status ?? '无响应';

            context.log.error(`请求异常: [${errorCode}] ${errorMsg} | HTTP: ${responseStatus} | path: ${url}`);

            if (isCertificateError(error) && !context.skipVerify(normalizedBaseUrl)) {
                context.log.warn(`检测到证书验证错误: code: ${errorCode}, msg: ${errorMsg}, path: ${url}`);
                return failure('certificate', errorMsg);
            }

            if (isHttpsPortMismatch(errorMsg)) {
                return failure('https-port-mismatch', errorMsg);
            }

            if (attempt >= retries) {
                return failed(errorMsg);
            }

            await setTimeout(100);
        }
    }
}
