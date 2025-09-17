// ==UserScript==
// @name         Civitai downloader
// @namespace    http://tampermonkey.net/
// @version      1.2.10
// @description  This extension is designed to automatically download Civitai models with their preview images and metadata (JSON).
// @author       nihedon
// @match        https://civitai.com/*
// @match        https://civitai.green/*
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

const API_MODEL_VERSIONS = `https://${location.hostname}/api/v1/model-versions/`;
const API_MODELS = `https://${location.hostname}/api/v1/models/`;

const INTERVAL = 500;
const TOAST_DEFAULT_DURATION = 3000; // ms
const TOAST_DEFAULT_EASE_DURATION = 160; // ms

const GRADIENT_STYLE = {
    "background-image": "linear-gradient(45deg, rgb(106, 232, 247) 10%, rgb(54, 153, 219) 25%, rgb(49, 119, 193) 40%, rgb(149, 86, 243) 57%, rgb(131, 26, 176) 75%, rgb(139, 5, 151) 86%)",
};
const BUTTON_STYLE = {
    ...GRADIENT_STYLE,
    "border-width": "0",
    "position": "relative",
    "overflow": "initial",
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
    "animation": "3s alternate-reverse infinite ease blink",
};
const BUTTON_AFTER_STYLE = {
    "content": "''",
    "position": "absolute",
    "top": "0px",
    "left": "0px",
    "width": "calc(100% - 4px)",
    "height": "calc(100% - 4px)",
    "margin": "2px",
    "background-color": "var(--mrt-row-hover-background-color)",
    "border-radius": "4px",
};
const TOAST_CONTAINER_STYLE = {
    "position": "fixed",
    "top": "12px",
    "right": "12px",
    "display": "flex",
    "flex-direction": "column",
    "gap": "8px",
    "z-index": "2147483647",
    "pointer-events": "none",
};
const TOAST_STYLE = {
    "min-width": "420px",
    "max-width": "420px",
    "color": "#fff",
    "background": "rgba(80,80,80,0.78)",
    "backdrop-filter": "blur(6px)",
    "padding": "10px 12px",
    "border-radius": "10px",
    "box-shadow": "0 3px 4px 0px rgba(80,80,80,0.3)",
    "display": "flex",
    "align-items": "center",
    "gap": "10px",
    "pointer-events": "auto",
    "font-size": "13px",
    "line-height": "1.4",
    "animation": `downloader-toast-in ${TOAST_DEFAULT_EASE_DURATION}ms ease-out`,
};
const TOAST_MESSAGE_STYLE = {
    "margin": 0,
};
const TOAST_PROGRESS_ANIMATION_STYLE = {
    "content": "''",
    "width": "16px",
    "height": "16px",
    "border": "2px solid rgba(255,255,255,0.35)",
    "border-top-color": "#fff",
    "border-radius": "50%",
    "animation": "downloader-spin 1s linear infinite",
};
const TOAST_SUCCESS_STYLE = {
    "background": "rgba(0,128,64,0.78)",
    "box-shadow": "0 3px 4px 0px rgba(0,128,64,0.3)",
};
const TOAST_ERROR_STYLE = {
    "background": "rgba(180,0,32,0.78)",
    "box-shadow": "0 3px 4px 0px rgba(180,0,32,0.3)",
};
const TOAST_CLOSING_STYLE = {
    "animation": `downloader-toast-out ${TOAST_DEFAULT_EASE_DURATION}ms ease-in forwards`,
};

var interval_id = undefined;

(function () {
    "use strict";
    const createCssSyntax = (selector, dic) =>
        `${selector} { ${
            Object.entries(dic)
                .flatMap((kv) => kv.join(":"))
                .join(";") + ";"
        } }`;
    $("<style>")
        .text(
            // Download button effects
            createCssSyntax(".downloader-effect", BUTTON_STYLE) +
                createCssSyntax(".downloader-effect::before", BUTTON_BEFORE_STYLE) +
                createCssSyntax(".mantine-Menu-dropdown > .mantine-Menu-item.downloader-effect::before", { "top": "0px" }) +
                createCssSyntax(".downloader-effect::after", BUTTON_AFTER_STYLE) +
                // Toast container & items
                createCssSyntax(".downloader-toast-container", TOAST_CONTAINER_STYLE) +
                createCssSyntax(".downloader-toast", TOAST_STYLE) +
                createCssSyntax(".downloader-toast-message", TOAST_MESSAGE_STYLE) +
                createCssSyntax(".downloader-toast.downloader-toast--progress::before", TOAST_PROGRESS_ANIMATION_STYLE) +
                createCssSyntax(".downloader-toast.downloader-toast--success", TOAST_SUCCESS_STYLE) +
                createCssSyntax(".downloader-toast.downloader-toast--error", TOAST_ERROR_STYLE) +
                createCssSyntax(".downloader-toast.downloader-toast--closing", TOAST_CLOSING_STYLE) +
                // Keyframes
                "@keyframes blink { 0% { opacity: 0; } 100% { opacity: 1; } } " +
                "@keyframes downloader-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } " +
                "@keyframes downloader-toast-in { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } } " +
                "@keyframes downloader-toast-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-10px); opacity: 0; } } ",
        )
        .appendTo(document.head);

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

// -------------- Toast Helpers --------------
let __toastSeq = 0;

function getToastContainer() {
    let container = document.querySelector(".downloader-toast-container");
    if (!container) {
        container = document.createElement("div");
        container.className = "downloader-toast-container";
        document.body.appendChild(container);
    }
    return container;
}

function showToast(message, type) {
    const duration = type === "progress" ? 0 : TOAST_DEFAULT_DURATION;
    const container = getToastContainer();
    const toast = document.createElement("div");
    toast.className = `downloader-toast${type ? " downloader-toast--" + type : ""}`;
    toast.dataset.toastId = String(++__toastSeq);
    const toastMessage = document.createElement("p");
    toastMessage.className = "downloader-toast-message";
    toastMessage.textContent = message;
    toast.appendChild(toastMessage);
    container.prepend(toast);
    if (duration && duration > 0) {
        toast.__timer = setTimeout(() => closeToast(toast), duration);
    }
    return toast;
}

function updateToast(toast, message, type) {
    if (!toast || !toast.isConnected) {
        return showToast(message, type);
    }
    const duration = type === "progress" ? 0 : TOAST_DEFAULT_DURATION;
    if (typeof message === "string") {
        const toastMessage = toast.querySelector(".downloader-toast-message");
        if (toastMessage) {
            toastMessage.textContent = message;
        }
    }
    if (type) {
        toast.classList.remove("downloader-toast--info", "downloader-toast--progress", "downloader-toast--success", "downloader-toast--error");
        toast.classList.add("downloader-toast--" + type);
    }
    if (typeof duration === "number") {
        if (toast.__timer) {
            clearTimeout(toast.__timer);
        }
        if (duration > 0) {
            toast.__timer = setTimeout(() => closeToast(toast), duration);
        }
    }
    return toast;
}

function closeToast(toast) {
    if (!toast || !toast.isConnected) {
        return;
    }
    if (toast.__timer) {
        clearTimeout(toast.__timer);
    }
    toast.classList.add("downloader-toast--closing");
    setTimeout(() => {
        if (toast && toast.parentElement) {
            toast.parentElement.removeChild(toast);
        }
    }, TOAST_DEFAULT_DURATION);
}

function bind() {
    if (interval_id !== undefined) {
        clearInterval(interval_id);
        interval_id = undefined;
    }
    const $mainContents = $(mainContentsSelector);
    // model version buttons
    const $modelVersionButtons = $(modelVersionButtonsSelector);
    $modelVersionButtons.off("click.downloader");
    $modelVersionButtons.on("click.downloader", (e) => {
        let $btn = $(e.target);
        if (!$btn.hasClass("mantine-Button-root")) {
            $btn = $btn.closest(".mantine-Button-root");
        }
        const colorCodes = [...$btn.css("background-color").matchAll("\\d+")].map((c) => parseInt(c[0]));
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
                    await new Promise((resolve) => {
                        let interval = setInterval(() => {
                            if ($target.next().hasClass("mantine-Menu-dropdown")) {
                                resolve();
                                clearInterval(interval);
                            }
                        }, 10);
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
                    getModelId().then((modelId) => {
                        downloadAll(modelId);
                    });
                }
            };
            async function waitForRedirect() {
                let modelToast = showToast("Preparing model download...", "progress");
                return new Promise((resolve) => {
                    const checkRedirect = async () => {
                        try {
                            const res = await fetch(document.location.href, { method: "HEAD" });
                            if (res.ok) {
                                updateToast(modelToast, "Model download started", "success");
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
    const metaInfoToast = showToast(`Fetching metadata...`, "progress");
    GM_xmlhttpRequest({
        method: "GET",
        url: API_MODEL_VERSIONS + modelId,
        onload: function (res) {
            const json = JSON.parse(res.responseText);
            const modelInfo = json.files.find((f) => f.type !== "Training Data");
            if (modelInfo) {
                const descriptionDiv = $(mainContentsSelector).find("div[class*=ModelVersionDetails_mainSection] div[class*=TypographyStylesWrapper_root]").get(0);
                const description = descriptionDiv ? descriptionDiv.innerText : null;
                const fileNameBase = modelInfo.name.replace(/\.[^\.]+$/, "");
                downloadMetaFile(json, fileNameBase);
                updateToast(metaInfoToast, `${fileNameBase}.civitai.info download started`, "success");
                downloadImageFile(json, fileNameBase, 0);
                if (description) {
                    downloadDescriptionFile(description, fileNameBase);
                    showToast(`${fileNameBase}.description.txt download started`, "success");
                }
            } else {
                updateToast(metaInfoToast, "No downloadable file found.", "info");
            }
        },
        onerror: function (err) {
            console.error("Model version fetch failed", err);
            updateToast(metaInfoToast, "Failed to fetch metadata.", "error");
        },
    });
}

function downloadImageFile(modelVersionInfo, fileNameBase, imgIdx) {
    const previewToast = showToast(`Preparing ${fileNameBase}.preview.png...`, "progress");
    let imgs = modelVersionInfo.images;
    if (OPT_IMAGE_FILE_ONLY) {
        imgs = imgs.filter((img) => img.type === "image");
    }
    if (imgs.length > 0) {
        const img = imgs[imgIdx];
        let imgUrl = img.url;
        if (modelVersionInfo.images[imgIdx].width) {
            imgUrl = imgUrl.replace(/\/width=\d+/, "/width=" + modelVersionInfo.images[imgIdx].width);
        }
        GM_xmlhttpRequest({
            method: "GET",
            url: imgUrl,
            responseType: "arraybuffer",
            onload: function (res) {
                const ext = img.type === "image" ? "png" : "mp4";
                const type = img.type === "image" ? `image/${ext}` : `video/${ext}`;
                const blob = new Blob([res.response], { type: type });
                download(blob, `${fileNameBase}.preview.${ext}`);
                updateToast(previewToast, `${fileNameBase}.preview.${ext} download started`, "success");
            },
            onerror: function (err) {
                console.error("Preview download failed", err);
                updateToast(previewToast, `Failed to fetch ${fileNameBase}.preview`, "error");
            },
        });
    } else {
        updateToast(previewToast, `No preview image available`, "info");
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
