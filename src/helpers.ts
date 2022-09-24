
import { config } from "./config";
import { Env, ExtendedUrl } from "./types";

export async function handleRequest(
    request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

    let url = new URL(request.url);
    const proxy = env.PROXY !== undefined ? env.PROXY : config.proxy;
    const domain = url.host.replace(proxy, "org");
    if (config.siteMatrix.includes(domain) && url.pathname === "/") {
        url.pathname = "/www/";
        return Response.redirect(url.toString(), config.redirect);
    }

    // wikipedia.ak1ra.xyz/api/rest_v1/page/summary/<title>
    const mobile = detectMobileDevice(request);
    if (url.pathname.startsWith("/api/rest_")) {
        url = modifyApiRequestUrl(request, domain, mobile)
    }

    const upstreamUrl = toUpstreamUrl(url, domain, mobile);
    const resp = await fetch(upstreamUrl.url.toString());

    // rewrite HTML urls
    const contentType = resp.headers.get("content-type");
    if (contentType !== null && contentType.startsWith("text/html")) {
        const rewriter = new HTMLRewriter()
            .on("a", new AttributeRewriter("href", env, upstreamUrl))
            .on("img", new AttributeRewriter("src", env, upstreamUrl))
            .on("script", new AttributeRewriter("src", env, upstreamUrl))
            .on("link", new AttributeRewriter("href", env, upstreamUrl));
        return rewriter.transform(resp);
    } else {
        return resp;
    }
}

function detectMobileDevice(request: Request): boolean {
    let userAgent = request.headers.get("user-agent");
    if (userAgent === null) {
        return false;
    }

    userAgent = userAgent.toLowerCase();
    const deviceList = ["android", "iphone", "ipad", "ipod", "symbianos", "windows phone"];
    for (let device of deviceList) {
        return userAgent.includes(device.toLowerCase()) ? true : false;
    }
    return false;
}

function modifyApiRequestUrl(request: Request, domain: string, mobile: boolean): URL {
    // wikipedia.ak1ra.xyz/api/rest_v1/page/summary/<title>
    const url = new URL(request.url);
    const referer = request.headers.get("referer");
    // if there is no referer header, we can only return the request.url
    if (referer === null) {
        return url;
    }

    const refererUrl = toUpstreamUrl(new URL(referer), domain, mobile);
    if (refererUrl.region !== null) {
        url.pathname = `/${refererUrl.region}` + url.pathname;
    }

    return url;
}

export function toUpstreamUrl(url: URL, domain: string, mobile: boolean): ExtendedUrl {
    // domain is upstreamDomain
    const upstreamUrl: ExtendedUrl = {
        url: new URL(url.toString()), region: null, mobile: mobile
    };

    // upload.wikimedia.example.com
    if (config.wikimedia.includes(domain)) {
        upstreamUrl.url.host = domain;
        return upstreamUrl;
    }

    // wikipedia.example.com/www/
    if (config.siteMatrix.includes(domain) && url.pathname.startsWith("/www/")) {
        upstreamUrl.url.host = `www.${domain}`;
        upstreamUrl.url.pathname = url.pathname.slice(4);
        return upstreamUrl;
    }

    // wikipedia.example.com/en/
    const split = url.pathname.split("/");
    if (split.length <= 1) {
        return upstreamUrl;
    }
    const region = url.pathname.split("/")[1];
    if (config.siteMatrix.includes(domain) && config.region.includes(region)) {
        upstreamUrl.region = region;
        upstreamUrl.url.host = upstreamUrl.mobile ?
            `${upstreamUrl.region}.m.${domain}` :
            `${upstreamUrl.region}.${domain}`;
        upstreamUrl.url.pathname = url.pathname.slice(upstreamUrl.region.length + 1);
    // wikipedia.example.com/w/load.php
    // /w/load.php will appear when the in-page url rewrite is incomplete
    } else if (config.siteMatrix.includes(domain)) {
        upstreamUrl.url.host = domain;
    }

    return upstreamUrl;
}

export function toProxiedUrl(url: URL, proxy: string, mobile: boolean): ExtendedUrl {
    const proxiedUrl: ExtendedUrl = {
        url: new URL(url.toString()), region: null, mobile: mobile
    };

    // upload.wikimedia.org
    if (config.wikimedia.includes(url.host)) {
        proxiedUrl.url.host = url.host.replace("org", proxy);
        return proxiedUrl;
    }

    // www.wikipedia.org
    let host = url.host.slice(4);
    if (url.host.startsWith("www.") && config.siteMatrix.includes(host)) {
        proxiedUrl.url.host = host.replace("org", proxy);
        proxiedUrl.url.pathname = "/www" + url.pathname;
        return proxiedUrl;
    }

    // en.wikipedia.org || en.m.wikipedia.org
    const split = url.host.split(".");
    if (split.length < 3 || split.length > 4) {
        return proxiedUrl;
    }
    const region = split[0];
    if (config.region.includes(region)) {
        proxiedUrl.region = region;
        proxiedUrl.url.host = `${split.slice(-2)[0]}.${proxy}`;
        proxiedUrl.url.pathname = `/${proxiedUrl.region}${url.pathname}`;
    }

    return proxiedUrl;
}

export class AttributeRewriter {
    env: Env;
    attributeName: string;
    upstreamUrl: ExtendedUrl;
    proxy: string;
    regex = config.siteRegex;

    constructor(attributeName: string, env: Env, upstreamUrl: ExtendedUrl) {
        this.env = env;
        this.attributeName = attributeName;
        this.upstreamUrl = upstreamUrl;
        this.proxy = env.PROXY !== undefined ? env.PROXY : config.proxy;
    }

    element(element: Element) {
        let attribute = element.getAttribute(this.attributeName);
        if (attribute === null) {
            return;
        }

        // Url with host
        // Would someone have a Wikipedia domain with a .org TLD in the pathname?
        // env.REWRITE_IN_PAGE_URL controls whether to enable in-page urls rewrite
        if (this.env.REWRITE_IN_PAGE_URL === "yes" && this.regex.test(attribute)) {
            // fix ERR_INVALID_URL when new URL(attribute)
            // "//upload.wikimedia.org/path/to/file.png"
            if (attribute.startsWith("//")) {
                attribute = this.upstreamUrl.url.protocol + attribute;
            }
            element.setAttribute(
                this.attributeName,
                toProxiedUrl(new URL(attribute), this.proxy, this.upstreamUrl.mobile).url.toString());
        } else {
            // other url or protocol
            if (!/^\/[^\/]/gi.test(attribute)) {
                return;
            }
            // Url from same origin
            if (this.upstreamUrl.region !== null) {
                element.setAttribute(
                    this.attributeName, `/${this.upstreamUrl.region}${attribute}`);
            }
        }
    }
}
