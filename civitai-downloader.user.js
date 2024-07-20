// ==UserScript==
// @name         Civitai downloader
// @namespace    http://tampermonkey.net/
// @version      1.0
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
const $body = $(document.body);

const API_MODEL_VERSIONS = "https://civitai.com/api/v1/model-versions/";
const API_MODELS = "https://civitai.com/api/v1/models/";

const INTERVAL = 500;
const BACKGROUND_STYLE = {
    "background-image": "linear-gradient(45deg, rgb(106, 232, 247) 10%, rgb(54, 153, 219) 25%, rgb(49, 119, 193) 40%, rgb(149, 86, 243) 57%, rgb(131, 26, 176) 75%, rgb(139, 5, 151) 86%)",
    "box-shadow": "rgba(255, 255, 255, 0.3) 0px 0px 1px 1px inset, rgba(0, 0, 0, 0.8) 0px 1px 2px",
    "border-width": "0"
};
const FOREGROUND_STYLE = {
    "position": "absolute",
    "background-color": "#000000AA",
    "width": "calc(100% - 4px)",
    "height": "calc(100% - 4px)",
    "top": "2px",
    "left": "2px",
    "padding": "4px",
    "border-radius": "4px",
};

(function() {
    'use strict';
    setInterval(() => {
        if (!document.location.pathname.startsWith("/models/")) {
            return;
        }
        $("a:not([data-downloader-binded=true]):not([data-disabled=true])").each((_, link) => {
            const $link = $(link);
            const dlIcon = $link.find("svg").hasClass("tabler-icon-download");
            const text = $link.text();
            $link.attr("data-downloader-binded", true);
            if (!dlIcon && text !== "Download") {
                return;
            }
            $link.css(BACKGROUND_STYLE);
            $("<div>").css(FOREGROUND_STYLE).appendTo($link);
            $link.children().eq(0).css({ "position": "inherit", "z-index": "1000" });
            $link.on("click", () => {
                const id = getId();
                getModelId(id).then(modelId => {
                    downloadAll(modelId);
                });
            });
        });
    }, INTERVAL);
})();

function getId() {
    return document.location.pathname.split(/[\/\?]/)[2];
}

async function getModelId(id) {
    const match = document.location.search.match(/modelVersionId=(\d+)/);
    if (match && match.length > 1) {
        return match[1];
    }

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
    const $a = $("<a>").attr({ href: objectURL, download: fileName }).appendTo($body);
    $a.get(0).click();
    $a.remove();
    URL.revokeObjectURL(objectURL);
}