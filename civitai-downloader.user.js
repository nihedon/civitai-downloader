// ==UserScript==
// @name         Civitai downloader
// @namespace    http://tampermonkey.net/
// @version      1.2.8
// @description  This extension is designed to automatically download Civitai models with their preview images and metadata (JSON).
// @author       nihedon
// @match        https://civitai.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=civitai.com
// @run-at       document-idle
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.4.1/jquery.min.js
// @downloadURL  https://github.com/nihedon/civitai-downloader/raw/main/civitai-downloader.user.js
// @updateURL    https://github.com/nihedon/civitai-downloader/raw/main/civitai-downloader.user.js
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// ==/UserScript==

const OPT_IMAGE_FILE_ONLY = true;

const $ = jQuery;

const API_MODEL_VERSIONS = "https://civitai.com/api/v1/model-versions/";
const API_MODELS = "https://civitai.com/api/v1/models/";

const INTERVAL = 500;

const GRADIENT_STYLE = {
    "background-image": "linear-gradient(45deg, rgb(106, 232, 247) 10%, rgb(54, 153, 219) 25%, rgb(49, 119, 193) 40%, rgb(149, 86, 243) 57%, rgb(131, 26, 176) 75%, rgb(139, 5, 151) 86%)",
};
const BUTTON_STYLE = {
    ...GRADIENT_STYLE,
    "border-width": "0",
    "position": "relative",
    "overflow": "initial"
};
const BUTTON_BEFORE_STYLE = {
    "content": "''",
    "position": "absolute",
    "top": "100%",
    "left": "0px",
    "width": "100%",
    "height": "100%",
    ...GRADIENT_STYLE,
    "border-width": "0",
    "filter": "blur(4px)",
    "animation": "3s alternate-reverse infinite ease blink"
};
const BUTTON_AFTER_STYLE = {
    "content": "''",
    "position": "absolute",
    "top": "0px",
    "left": "0px",
    "width": "calc(100% - 4px)",
    "height": "calc(100% - 4px)",
    "margin": "2px",
    "background-color": "#000000AA",
    "border-radius": "4px",
};

var interval_id = undefined;

(function() {
    'use strict';
    const createCssSyntax = (selector, dic) => `${selector} { ${Object.entries(dic).flatMap(kv => kv.join(":")).join(";") + ";"} }`;
    $('<style>').text(createCssSyntax(".downloader-effect", BUTTON_STYLE)
                    + createCssSyntax(".downloader-effect::before", BUTTON_BEFORE_STYLE)
                    + createCssSyntax(".mantine-Menu-dropdown > .mantine-Menu-item.downloader-effect::before", {top: "0px"})
                    + createCssSyntax(".downloader-effect::after", BUTTON_AFTER_STYLE)
                    + "@keyframes blink { 0% { opacity: 0; } 100% { opacity: 1; } } ").appendTo(document.head);

    const orgFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async (...args) => {
        if (args && args.length > 0 && args[0].startsWith("/api/trpc/track.addView")) {
            bind();
        }
        return orgFetch(...args);
    };
    if (document.location.pathname.match(/^\/models\/\d+\//) !== null) {
        bind();
    }
})();

var mainContentsSelector = "main > div:nth-child(2) > div:nth-child(1) > div:nth-of-type(3) > div:nth-child(1) > div:nth-child(1)";

var modelVersionButtonsSelector = ".mantine-Container-root > .mantine-Stack-root > .mantine-Group-root .mantine-Button-root";

function bind() {
    if (interval_id !== undefined) {
        clearInterval(interval_id);
        interval_id = undefined;
    }
    const $mainContents = $(mainContentsSelector);
    // model version buttons
    const $modelVersionButtons = $(modelVersionButtonsSelector);
    $modelVersionButtons.off("click.downloader");
    $modelVersionButtons.on("click.downloader", e => {
        let $btn = $(e.target);
        if (!$btn.hasClass("mantine-Button-root")) {
            $btn = $btn.closest(".mantine-Button-root");
        }
        const colorCodes = [...$btn.css("background-color").matchAll("\\d+")].map(c => parseInt(c[0]));
        // If the blue component is greater than 0x80, consider it an active.
        if (!(colorCodes[0] < 0x80 && colorCodes[1] < 0x80 && colorCodes[2] > 0x80)) {
            $mainContents.find(".downloader-binded").removeClass("downloader-binded");
            $mainContents.find(".downloader-effect").removeClass("downloader-effect");
        }
    });
    interval_id = setInterval(() => {
        $mainContents.find("[data-tour='model:download']:not(.downloader-binded):not([data-disabled=true])").each((_, link) => {
            const $link = $(link);
            const dlIcon = $link.find("svg").hasClass("tabler-icon-download");
            const text = $link.text();
            $link.addClass("downloader-binded");
            if (!dlIcon && text !== "Download") {
                return;
            }
            $link.addClass("downloader-effect");
            $link.children().eq(0).css({ "position": "inherit", "z-index": "1000" });
            $link.off("click.downloader");
            const allDownloadFunc = async (e) => {
                if (e.currentTarget.tagName === "BUTTON") {
                    const $target = $(e.currentTarget);
                    if ($target.next().attr("id") === "mantine-rm-dropdown") {
                        return;
                    }
                    await new Promise(resolve => {
                        let interval = setInterval(() => {
                            if ($target.next().hasClass("mantine-Menu-dropdown")) {
                                resolve();
                                clearInterval(interval);
                            }
                        }, 10)
                    });
                    const $dropdown = $target.next();
                    $dropdown.find("a").each((_, a) => {
                        const $a = $(a);
                        $a.addClass("downloader-effect");
                        $a.children().each((_, div) => $(div).css({ "z-index": "100" }));
                        $a.on("click.downloader", allDownloadFunc);
                    });
                    $dropdown.children().eq(0).css({ "display": "flex", "flex-direction": "column", "row-gap": "3px" });
                    console.info($dropdown);
                } else {
                    await waitForRedirect();
                    getModelId().then(modelId => {
                        downloadAll(modelId);
                    });
                }
            }
            async function waitForRedirect() {
                return new Promise(resolve => {
                    const checkRedirect = async () => {
                        try {
                            const res = await fetch(document.location.href, { method: 'HEAD' });
                            if (res.ok) {
                                resolve();
                            }
                        } catch (e) {
                            setTimeout(checkRedirect, 100);
                        }
                    };
                    checkRedirect();
                });
            }
            $link.on("click.downloader", allDownloadFunc);
        });
        if ($mainContents.find("[data-tour='model:download']:not(.downloader-binded)").length === 0) {
            clearInterval(interval_id);
            interval_id = undefined;
        }
    }, INTERVAL);
}

function getId() {
    return document.location.pathname.split(/[\/\?]/)[2];
}

async function getModelId() {
    const match = document.location.search.match(/modelVersionId=(\d+)/);
    if (match && match.length > 1) {
        return match[1];
    }

    const id = getId();
    const res = await fetch(API_MODELS + id);
    const json = await res.json();
    return json.modelVersions[0].id;
}

function downloadAll(modelId) {
    GM_xmlhttpRequest({
        method: "GET",
        url: API_MODEL_VERSIONS + modelId,
        onload: function(res) {
            const json = JSON.parse(res.responseText);
            const modelInfo = json.files.find(f => f.type !== "Training Data");
            if (modelInfo) {
                const descriptionDiv = $(mainContentsSelector).find("div[class*=ModelVersionDetails_mainSection] div[class*=TypographyStylesWrapper_root]").get(0);
                const description = descriptionDiv ? descriptionDiv.innerText : null;
                const fileNameBase = modelInfo.name.replace(/\.[^\.]+$/, "");
                downloadImageFile(json, fileNameBase, 0);
                downloadMetaFile(json, fileNameBase);
                if (description) {
                    downloadDescriptionFile(description, fileNameBase);
                }
            }
        }
    });
}

function downloadImageFile(modelVersionInfo, fileNameBase, imgIdx) {
    let imgs = modelVersionInfo.images;
    if (OPT_IMAGE_FILE_ONLY) {
        imgs = imgs.filter(img => img.type === "image");
    }
    if (imgs.length > 0) {
        const img = imgs[imgIdx];
        let imgUrl = img.url;
        if (modelVersionInfo.images[imgIdx].width) {
            imgUrl = imgUrl.replace(/\/width=\d+/, '/width=' + modelVersionInfo.images[imgIdx].width);
        }
        GM_xmlhttpRequest({
            method: "GET",
            url: imgUrl,
            responseType: "arraybuffer",
            onload: function(res) {
                const ext = img.type === "image" ? "png" : "mp4";
                const type = img.type === "image" ? `image/${ext}` : `video/${ext}`;
                const blob = new Blob([res.response], { type: type });
                download(blob, `${fileNameBase}.preview.${ext}`);
            }
        });
    }
}

function downloadMetaFile(modelVersionInfo, fileNameBase) {
    const json = [JSON.stringify(modelVersionInfo, null, 4)];
    const blob = new Blob(json, { type: "text/plain" });
    download(blob, `${fileNameBase}.civitai.info`);
}

function downloadDescriptionFile(description, fileNameBase) {
    const blob = new Blob([description], { type: "text/plain" });
    download(blob, `${fileNameBase}.description.txt`);
}

function download(blob, fileName) {
    const objectURL = URL.createObjectURL(blob);
    const $a = $("<a>").attr({ href: objectURL, download: fileName }).appendTo($(document.body));
    $a.get(0).click();
    $a.remove();
    URL.revokeObjectURL(objectURL);
}
