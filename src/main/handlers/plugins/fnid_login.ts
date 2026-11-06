/**
 * FN ID 登录插件
 * 通过 FN Connect OAuth 流程实现 FN ID 登录
 */

/**
 * 判断输入是否为 FN ID。FN ID 会拼进 https://5ddd.com/{fnId}，只放行不改变 URL 结构的字符。
 * FN Connect 页面的校验更严（小写字母开头，只含小写字母、数字和单个连字符），但这些规则
 * 是逐步加的，老 FN ID 可能不满足，这里不跟进，由 FN Connect 页面自己提示。
 * 登录页的 isFnId（resource/login/index.js）保持一致。
 */
export function isFnId(domain: string): boolean {
    if (!domain) return false;
    return /^[A-Za-z0-9_-]{6,30}$/.test(domain.trim());
}

export { handleFnIdLogin } from '../core/fnIdOauthWindow';
