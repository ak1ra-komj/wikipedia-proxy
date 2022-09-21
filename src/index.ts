/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `wrangler dev src/index.ts` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `wrangler publish src/index.ts --name my-worker` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {}

const config = {
	domain: "example.com",

	protocol: "https:",
	redirect: {
		status: 301,
		desktop: "/zh",
		mobile: "/zh/m",
	},

	// regex pattern
	region: "zh|en|fr",
	matrix: "mediawiki|wikibooks|wikidata|wikinews|wikipedia|wikiquote|wikisource|wikiversity|wikivoyage|wiktionary|((commons|meta|species|upload|login)\.)?wikimedia",
	// /w/load.php, /w/api.php, /static/images
	static: "www|w\/|api\/|static\/|wikipedia\/",
}

export default {
	async fetch( request: Request, env: Env, ctx: ExecutionContext ): Promise<Response> {
		return await handleRequest(request);
	},
}

async function handleRequest(request: Request): Promise<Response> {
	let url = new URL(request.url);
	// Negative Lookahead
	const redirectPathRegex = new RegExp( `^\/(?!(${config.region}|${config.static})(\/(m))?).*$`, "gi");
	const redirectHostRegex = new RegExp( `^(?!(upload|login)\.wikimedia)\.${config.domain}.*$`, "gi");

	if(redirectPathRegex.test(url.pathname) || redirectHostRegex.test(url.host)) {
		if(isMobile(request)) {
			url.pathname = config.redirect.mobile + url.pathname;
		} else {
			url.pathname = config.redirect.desktop + url.pathname;
		}
		return Response.redirect(url.toString(), config.redirect.status);
	}

	const upstreamUrl = await url2UpstreamUrl(url);
	const resp = await fetch(upstreamUrl.toString());

	return new HTMLRewriter().on("a", new elementHandler()).transform(resp);
}

function isMobile(request: Request): boolean {
	let useragent = request.headers.get("user-agent");
	if(useragent === null) { return false; }

	const regex = /(Android|iPhone|iPad|iPod|SymbianOS|Windows Phone)/gi;
	return regex.test(useragent) ? true : false;
}

async function url2UpstreamUrl(url: URL): Promise<URL> {
	// https://wikipedia.example.com/www/
	// https://wikipedia.example.com/en/wiki/Wikipedia
	// https://wikipedia.example.com/zh/m/wiki/Wikipedia
	// regex for pathname
	const wwwRegex = new RegExp( `^\/www`, "gi" );
	const regionRegex = new RegExp( `^\/(${config.region})(\/(m))?`, "gi" );
	// regex for host
	const hostRegex = new RegExp( `^(${config.matrix})\.${config.domain}`, "gi" );

	let upstreamHost = url.host.replace(hostRegex, "$1.org");
	if(wwwRegex.test(url.pathname)) {
		let hostWithPath = url.pathname.replace(wwwRegex, `www.${upstreamHost}`);
		url.href = `${url.protocol}//${hostWithPath}`;
		return url;
	}

	// /zh/m/wiki/Wikipedia => [ /zh/m, zh, /m, m, ...]
	const regionMatch = regionRegex.exec(url.pathname);
	if(regionMatch !== null) {
		let hostWithPath;
		// regionMatch Array's index 0 is match 1, then capturing group 1, 2, 3, ...
		// we use index 3 for capturing group 3 here
		if(regionMatch[3] !== undefined) {
			// mobile, zh.m.wikipedia.org
			hostWithPath = url.pathname.replace(
				regionRegex, `${regionMatch[1]}.${regionMatch[3]}.${upstreamHost}`);
		} else {
			// desktop, zh.wikipedia.org
			hostWithPath = url.pathname.replace(
				regionRegex, `${regionMatch[1]}.${upstreamHost}`);
		}
		url.href = `${url.protocol}//${hostWithPath}`;
		return url;
	} else {
		url.host = upstreamHost;
		return url;
	}
}

async function upstreamUrl2Url(url: URL): Promise<URL> {
	// https://www.wikipedia.org/
	// https://en.wikipedia.org/wiki/Wikipedia
	// https://zh.m.wikipedia.org/wiki/Wikipedia
	// regex for host
	const wwwRegex = new RegExp( `^www\.(${config.matrix})\.org`, "gi" );
	const regionRegex = new RegExp( `^((${config.region})(\.(m))?\.)?(${config.matrix})\.org`, "gi" );
	const upstreamHost = url.host;
	const upstreamPathname = url.pathname;

	if(wwwRegex.test(upstreamHost)) {
		url.host = upstreamHost.replace(wwwRegex, `$1.${config.domain}`);
		url.pathname = ("/www" + upstreamPathname);
		return url;
	}

	// zh.m.wikipedia.org => [ zh.m.wikipedia.org, zh.m., zh, .m, m, wikipedia, ... ]
	// upload.wikimedia.org => [ upload.wikimedia.org, ..., (g5) upload.wikimedia, upload., upload, ... ]
	const regionMatch = regionRegex.exec(upstreamHost);
	if(regionMatch !== null) {
		url.host = regionMatch[5] + config.domain;
		if(regionMatch[2] !== undefined || regionMatch[4] !== undefined) {
			let prefix = `/${regionMatch[2]}/${regionMatch[4]}`.replace(/\/+$/, "");
			url.pathname = prefix + upstreamPathname;
		}
	}
	return url;
}

class elementHandler {
	element(element: Element) {
		let href = element.getAttribute("href");
		console.log(`Incoming element: <${element.tagName} href=${href}`);
	}
}