import * as crypto from 'crypto';
import axios, { AxiosResponse } from 'axios';
import { setTimeout } from 'timers/promises';
import https from 'https';
import { isCertificateError } from './certificateError';
import { composeCookieHeader } from './cookie';
import { isHttpsPortMismatch } from './httpsPortMismatch';

const api_key = 'NDzZTVxnRKP8Z0jXg1VAMonaG8akvh';
const api_secret = '16CCEB3D-AB42-077D-36A1-F355324E4237';

export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    certificateError?: boolean;
    moveUrl?: string;
}

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

export async function request<T = any>(
    context: RequestContext,
    baseUrl: string,
    url: string,
    method: HttpMethod,
    token: string,
    data?: any,
    extraHeaders?: Record<string, string>,
    axiosConfig?: Record<string, any>,
    timeout: number = DEFAULT_TIMEOUT,
    tryTimes: number = 5,
): Promise<ApiResponse<T>> {
    const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
    const fullUrl = normalizedBaseUrl + url;
    if (method === HttpMethod.POST || method === HttpMethod.PUT) {
        data = data || {};
        data["nonce"] = generateRandomDigits();
    }

    const authx = genFnAuthx(url, data);

    const headers = {
        "Content-Type": "application/json",
        "Authorization": token,
        "Authx": authx,
        ...extraHeaders,
        "Cookie": composeCookieHeader(context.accessCookie(normalizedBaseUrl), extraHeaders?.Cookie),
    };

    const shouldIgnoreCert = context.skipVerify(normalizedBaseUrl);

    const config = {
        headers,
        timeout: timeout,
        maxRedirects: 0,
        validateStatus: (status: number) => status >= 200 && status < 400,
        httpsAgent: httpsAgent(!shouldIgnoreCert, context.ca, timeout),
        ...axiosConfig
    };

    for (let attempt = 0; attempt <= tryTimes; attempt++) {
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
                context.log.warn(`检测到重定向 (${response.status}) -> ${location}`);

                if (location) {
                    let newBaseUrl = normalizedBaseUrl;
                    let newUrlPath = location;

                    if (location.startsWith('http')) {
                        const parsedUrl = new URL(location);
                        newBaseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
                        newUrlPath = parsedUrl.pathname + parsedUrl.search;
                    }

                    const recursiveResult = await request<T>(
                        context,
                        newBaseUrl,
                        newUrlPath,
                        method,
                        token,
                        data,
                        extraHeaders,
                        axiosConfig,
                        timeout,
                        tryTimes - 1
                    );

                    return {
                        ...recursiveResult,
                        moveUrl: recursiveResult.moveUrl || newBaseUrl
                    };
                }
            }

            const contentType = response.headers['content-type'];
            if (typeof contentType === 'string' && !contentType.includes('application/json')) {
                return {
                    success: true,
                    data: response.data as any,
                };
            }

            const res = response.data;

            if (res.code === 5000 && res.msg === 'invalid sign') {
                if (attempt >= tryTimes) {
                    return {
                        success: false,
                        message: `尝试次数过多 try_times = ${attempt + 1}`
                    };
                }

                context.log.warn(`fn_api 请求时签名错误，重试中 attempt = ${attempt + 1}, path: ${url}`);
                await setTimeout(100);
                continue;
            }

            if (res.code !== 0) {
                context.log.error(`fn_api 请求失败`, res);
                return { success: false, message: res.msg || `HTTP Error ${response.status}` };
            }

            return {
                success: true,
                data: res.data
            };

        } catch (error: any) {
            const errorCode = error.code || 'UNKNOWN';
            const errorMsg = error.message;
            const responseStatus = error.response?.status ?? '无响应';

            context.log.error(`请求异常: [${errorCode}] ${errorMsg} | HTTP: ${responseStatus} | path: ${url}`);

            if (isCertificateError(error) && !context.skipVerify(normalizedBaseUrl)) {
                context.log.warn(`检测到证书验证错误: code: ${errorCode}, msg: ${errorMsg}, path: ${url}`);

                return {
                    success: false,
                    message: errorMsg,
                    certificateError: true
                } as ApiResponse<T> & { certificateError?: boolean };
            }

            if (attempt >= tryTimes || isHttpsPortMismatch(errorMsg)) {
                return { success: false, message: errorMsg };
            }

            await setTimeout(100);
        }
    }

    return {
        success: false,
        message: '重试逻辑异常'
    };
}
