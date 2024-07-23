// ==UserScript==
// @name         Civitai downloader
// @namespace    http://tampermonkey.net/
// @version      1.1.4
// @description  This extension is designed to automatically download Civitai models with their preview images and metadata (JSON).
// @author       nihedon
// @match        https://civitai.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=civitai.com
// @run-at       document-end
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.4.1/jquery.min.js
// @downloadURL  https://github.com/nihedon/civitai-downloader/raw/main/civitai-downloader.user.js
// @updateURL    https://github.com/nihedon/civitai-downloader/raw/main/civitai-downloader.user.js
// @grant        none
// ==/UserScript==

const OPT_IMAGE_FILE_ONLY = true;

const $ = jQuery;

const API_MODEL_VERSIONS = "https://civitai.com/api/v1/model-versions/";
const API_MODELS = "https://civitai.com/api/v1/models/";

const INTERVAL = 500;

const GRADIENT_STYLE = {
    "background-image": "linear-gradient(45deg, rgb(106, 232, 247) 10%, rgb(54, 153, 219) 25%, rgb(49, 119, 193) 40%, rgb(149, 86, 243) 57%, rgb(131, 26, 176) 75%, rgb(139, 5, 151) 86%)",
};
const BACKGROUND_STYLE = {
    ...GRADIENT_STYLE,
    "border-width": "0"
};
const BACKGROUND_EFFECT_STYLE = {
    "position": "absolute",
    "top": "0px",
    "left": "0px",
    "width": "100%",
    "height": "100%",
    ...GRADIENT_STYLE,
    "border-width": "0",
    "filter": "blur(4px)",
    "animation": "3s alternate-reverse infinite ease blink"
};
const FOREGROUND_STYLE = {
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
    $('<style>').text(createCssSyntax(".downloader-foreground", FOREGROUND_STYLE)
                    + createCssSyntax(".downloader-background", BACKGROUND_STYLE)
                    + createCssSyntax(".downloader-background_effect", BACKGROUND_EFFECT_STYLE)
                    + "@keyframes blink { 0% { opacity: 0; } 100% { opacity: 1; } } ").appendTo(document.head);

    const orgReflect = Reflect.apply;
    Reflect.apply = (target, thisArg, args) => {
        if (args && args.length > 0 && args[0].startsWith("/api/trpc/track.addView")) {
            bind();
        }
        return orgReflect(target, thisArg, args);
    }
})();

function bind() {
    if (interval_id !== undefined) {
        clearInterval(interval_id);
        interval_id = undefined;
    }
    const $mainContents = $(".mantine-ContainerGrid-root").eq(0);
    // model version buttons
    const $modelVersionButtons = $(".mantine-Container-root > .mantine-Stack-root > .mantine-Group-root .mantine-Button-root");
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
            $mainContents.find(".downloader-background").removeClass("downloader-background");
            $mainContents.find(".downloader-foreground").remove();
            $mainContents.find(".downloader-background_effect").remove();
        }
    });
    interval_id = setInterval(() => {
        $mainContents.find(".mantine-Button-root[type=button]:not(.downloader-binded):not([data-disabled=true])").each((_, link) => {
            const $link = $(link);
            const dlIcon = $link.find("svg").hasClass("tabler-icon-download");
            const text = $link.text();
            $link.addClass("downloader-binded");
            if (!dlIcon && text !== "Download") {
                return;
            }
            $link.addClass("downloader-background");
            $("<div>").addClass("downloader-background_effect").appendTo($link);
            $("<div>").addClass("downloader-foreground").appendTo($link);
            $link.children().eq(0).css({ "position": "inherit", "z-index": "1000" });
            $link.off("click.downloader");
            $link.on("click.downloader", () => {
                getModelId().then(modelId => {
                    downloadAll(modelId);
                });
            });
        });
        if ($mainContents.find(".mantine-Button-root[type=button]:not(.downloader-binded)").length === 0) {
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
    fetch(API_MODEL_VERSIONS + modelId).then(res => res.json()).then(json => {
        const modelInfo = json.files.find(f => f.type !== "Training Data");
        if (modelInfo) {
            const fileNameBase = modelInfo.name.replace(/\.[^\.]+$/, "");
            downloadImageFile(json, fileNameBase, 0);
            downloadMetaFile(json, fileNameBase);
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
        fetch(imgUrl).then(res => res.blob()).then(blob => {
            download(blob, `${fileNameBase}.preview.${img.type === "image" ? "png" : "mp4"}`);
        });
    }
}

function downloadMetaFile(modelVersionInfo, fileNameBase) {
    const json = [JSON.stringify(modelVersionInfo, null, 4)];
    const blob = new Blob(json, { type: "text/plain" });
    download(blob, `${fileNameBase}.civitai.info`);
}

function download(blob, fileName) {
    const objectURL = URL.createObjectURL(blob);
    const $a = $("<a>").attr({ href: objectURL, download: fileName }).appendTo($(document.body));
    $a.get(0).click();
    $a.remove();
    URL.revokeObjectURL(objectURL);
}
