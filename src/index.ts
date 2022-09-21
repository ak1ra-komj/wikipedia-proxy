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
	flags: "gi",

	// ref: https://meta.wikimedia.org/wiki/Wikimedia_projects
	region: "aa|ab|ace|ady|af|ak|als|alt|am|ami|an|ang|ar|arc|ary|arz|as|ast|atj|av|avk|awa|ay|az|azb|ba|ban|bar|bat-smg|bcl|be|be-tarask|be-x-old|bg|bh|bi|bjn|blk|bm|bn|bo|bpy|br|bs|bug|bxr|ca|cbk-zam|cdo|ce|ceb|ch|cho|chr|chy|ckb|co|cr|crh|cs|csb|cu|cv|cy|da|dag|de|din|diq|dsb|dty|dv|dz|ee|el|eml|en|eo|es|et|eu|ext|fa|ff|fi|fiu-vro|fj|fo|fr|frp|frr|fur|fy|ga|gag|gan|gcr|gd|gl|glk|gn|gom|gor|got|gu|guw|gv|ha|hak|haw|he|hi|hif|ho|hr|hsb|ht|hu|hy|hyw|hz|ia|id|ie|ig|ii|ik|ilo|inh|io|is|it|iu|ja|jam|jbo|jv|ka|kaa|kab|kbd|kbp|kcg|kg|ki|kj|kk|kl|km|kn|ko|koi|kr|krc|ks|ksh|ku|kv|kw|ky|la|lad|lb|lbe|lez|lfn|lg|li|lij|lld|lmo|ln|lo|lrc|lt|ltg|lv|mad|mai|map-bms|mdf|mg|mh|mhr|mi|min|mk|ml|mn|mni|mnw|mo|mr|mrj|ms|mt|mus|mwl|my|myv|mzn|na|nah|nap|nds|nds-nl|ne|new|ng|nia|nl|nn|no|nov|nqo|nrm|nso|nv|ny|oc|olo|om|or|os|pa|pag|pam|pap|pcd|pcm|pdc|pfl|pi|pih|pl|pms|pnb|pnt|ps|pt|pwn|qu|rm|rmy|rn|ro|roa-rup|roa-tara|ru|rue|rw|sa|sah|sat|sc|scn|sco|sd|se|sg|sh|shi|shn|shy|si|simple|sk|skr|sl|sm|smn|sn|so|sq|sr|srn|ss|st|stq|su|sv|sw|szl|szy|ta|tay|tcy|te|tet|tg|th|ti|tk|tl|tn|to|tpi|tr|trv|ts|tt|tum|tw|ty|tyv|udm|ug|uk|ur|uz|ve|vec|vep|vi|vls|vo|wa|war|wo|wuu|xal|xh|xmf|yi|yo|yue|za|zea|zh|zh-classical|zh-min-nan|zh-yue|zu",

	// ref: https://meta.wikimedia.org/wiki/Special:SiteMatrix
	siteMatrix: "wikipedia|wiktionary|wikibooks|wikinews|wikiquote|wikisource|wikiversity|wikivoyage",

	wikimedia: "((commons|meta|species|upload|login)\.)?wikimedia",

	// certain path should not be redirected
	pathnamePrefix: "w\/(api|load)\.php|api\/|static\/|\/www\/",
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		return await handleRequest(request, env, ctx);
	},
}

async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
	let url = new URL(request.url);
	// Negative Lookahead
	const redirectPathRegex = new RegExp( `^\/(?!(${config.region}|${config.pathnamePrefix})(\/(m))?).*$`, config.flags);
	const redirectHostRegex = new RegExp( `^(?!${config.wikimedia})\.${config.domain}.*$`, config.flags);

	// index redirect
	if(redirectPathRegex.test(url.pathname) || redirectHostRegex.test(url.host)) {
		if(isMobile(request)) {
			url.pathname = config.redirect.mobile + url.pathname;
		} else {
			url.pathname = config.redirect.desktop + url.pathname;
		}
		return Response.redirect(url.toString(), config.redirect.status);
	}

	// convert request.url to real upstreamUrl
	const upstreamUrl = url2UpstreamUrl(url);
	const resp = await fetch(upstreamUrl.toString());

	return resp;

	// FIXME: rewrite HTML urls
	// const contentType = resp.headers.get("content-type");
	// if(contentType !== null && contentType.startsWith("text/html")) {
	// 	const rewriter = new HTMLRewriter()
	// 		.on("a", new AttributeRewriter("href"))
	// 		.on("img", new AttributeRewriter("src"))
	// 		.on("script", new AttributeRewriter("src"))
	// 		.on("link", new AttributeRewriter("href"))
	// 		.on("meta", new AttributeRewriter("content"));

	// 	return rewriter.transform(resp);
	// } else {
	// 	return resp;
	// }
}

function isMobile(request: Request): boolean {
	let useragent = request.headers.get("user-agent");
	if(useragent === null) { return false; }

	const regex = /(Android|iPhone|iPad|iPod|SymbianOS|Windows Phone)/gi;
	return regex.test(useragent) ? true : false;
}

function url2UpstreamUrl(url: URL): URL {
	// https://wikipedia.example.com/www/
	// https://wikipedia.example.com/en/wiki/Wikipedia
	// https://wikipedia.example.com/zh/m/wiki/Wikipedia
	// regex for pathname
	const wwwRegex = new RegExp( `^\/www`, config.flags );
	const regionRegex = new RegExp( `^\/(${config.region})(\/(m))?`, config.flags );
	// regex for host
	const hostRegex = new RegExp( `^(${config.siteMatrix})\.${config.domain}`, config.flags );

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

function upstreamUrl2Url(url: URL): URL {
	// https://www.wikipedia.org/
	// https://en.wikipedia.org/wiki/Wikipedia
	// https://zh.m.wikipedia.org/wiki/Wikipedia
	// regex for host
	const wwwRegex = new RegExp( `^www\.(${config.siteMatrix})\.org`, config.flags );
	const regionRegex = new RegExp( `^((${config.region})(\.(m))?\.)?(${config.siteMatrix})\.org`, config.flags );
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

class AttributeRewriter {
	attributeName: string;

	constructor(attributeName: string) {
		this.attributeName = attributeName;
	}

	element(element: Element) {
		const attributeRegex = new RegExp( `^(https?:)?\/\/.*(${config.siteMatrix})\.org.*`, config.flags);

		const attribute = element.getAttribute(this.attributeName);
		if(attribute !== null && attributeRegex.test(attribute)) {
			const newAttribute = upstreamUrl2Url(new URL(attribute)).toString();

			console.log(`AttributeRewriter: ${attribute} -> ${newAttribute}`);

			element.setAttribute(this.attributeName, newAttribute);
		}
	}
}