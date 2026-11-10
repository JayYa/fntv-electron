// 主进程的 fn_api 请求：访问授权查进程内的 accessGrant，证书信任查 cert_trust。
import log from '../logger';
import { isTrusted } from '../cert_trust';
import { getAccessCookieHeader } from './accessGrant';
import * as core from './core/request';

export { ApiResponse, FnApiResponseData, HttpMethod, DEFAULT_TIMEOUT } from './core/request';

export const mainContext: core.RequestContext = {
    accessCookie: getAccessCookieHeader,
    skipVerify: isTrusted,
    log,
};

export function request<T = any>(
    baseUrl: string,
    url: string,
    method: core.HttpMethod,
    token: string,
    data?: any,
    extraHeaders?: Record<string, string>,
    axiosConfig?: Record<string, any>,
    timeout?: number,
    tryTimes?: number,
): Promise<core.ApiResponse<T>> {
    return core.request<T>(mainContext, baseUrl, url, method, token, data, extraHeaders, axiosConfig, timeout, tryTimes);
}
