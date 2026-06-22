// ==UserScript==
// @name         Civitai downloader
// @namespace    http://tampermonkey.net/
// @version      1.2.19
// @description  This extension is designed to automatically download Civitai models with their preview images and metadata (JSON).
// @author       nihedon, abel1502
// @match        https://civitai.com/*
// @match        https://civitai.green/*
// @match        https://civitai.red/*
// @connect      civitai.com
// @connect      civitai.green
// @connect      civitai.red
// @icon         https://www.google.com/s2/favicons?sz=64&domain=civitai.com
// @run-at       document-idle
// @require      https://ajax.googleapis.com/ajax/libs/jquery/3.4.1/jquery.min.js
// @downloadURL  https://github.com/nihedon/civitai-downloader/raw/main/civitai-downloader.user.js
// @updateURL    https://github.com/nihedon/civitai-downloader/raw/main/civitai-downloader.user.js
// @resource     MATERIAL_ICONS https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined
// @grant        unsafeWindow
// @grant        GM_xmlhttpRequest
// @grant        GM_download
// @grant        GM_getResourceText
// @grant        GM_addStyle
// ==/UserScript==

const OPT_IMAGE_FILE_ONLY_DEFAULT = true;
const OPT_DESCRIPTION_TXT_DEFAULT = true;
const OPT_SAVE_TO_SUBFOLDER_DEFAULT = false;

const options = [
    {
        key: "image_file_only",
        label: "Image File Only",
        default: OPT_IMAGE_FILE_ONLY_DEFAULT,
    },
    {
        key: "description_txt",
        label: "Description Text",
        default: OPT_DESCRIPTION_TXT_DEFAULT,
    },
    {
        key: "save_to_subfolder",
        label: "Save to Subfolder",
        default: OPT_SAVE_TO_SUBFOLDER_DEFAULT,
        attention: "Enabling this requires additional Tampermonkey configuration.",
        help: "https://github.com/nihedon/civitai-downloader/blob/main/HELP.md",
    },
];

function getOption(key, defaultValue) {
    const val = localStorage.getItem(`civitai_dl_${key}`);
    return val === null ? defaultValue : val === "true";
}

function setOption(key, value) {
    localStorage.setItem(`civitai_dl_${key}`, value);
}

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
const BUTTON_OPTIONAL_BEFORE_STYLE = {
    "top": "0",
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
const OPTIONS_CONTAINER_STYLE = {
    "position": "relative",
    "display": "flex",
    "align-items": "center",
};
const OPTIONS_BTN_STYLE = {
    "cursor": "pointer",
    "display": "flex",
    "align-items": "center",
    "justify-content": "center",
    "width": "30px",
    "height": "30px",
    "border-radius": "4px",
    "transition": "background-color 0.2s",
    "margin-left": "8px",
    "color": "var(--mantine-color-text)",
};
const OPTIONS_MENU_STYLE = {
    "position": "absolute",
    "top": "100%",
    "right": "0",
    "background": "var(--mantine-color-body)",
    "border": "1px solid var(--mantine-color-dark-4)",
    "border-radius": "8px",
    "padding": "12px",
    "z-index": "1000",
    "display": "none",
    "box-shadow": "0 8px 16px rgba(0,0,0,0.4)",
    "min-width": "240px",
    "flex-direction": "column",
    "gap": "8px",
};
const OPTION_ITEM_STYLE = {
    "display": "flex",
    "align-items": "center",
    "gap": "8px",
    "user-select": "none",
    "font-size": "14px",
};

let intervalId;

const createCssSyntax = (selector, dic) =>
    `${selector} { ${
        Object.entries(dic)
            .flatMap((kv) => kv.join(":"))
            .join(";") + ";"
    } }`;

const iconCss = GM_getResourceText("MATERIAL_ICONS");
GM_addStyle(iconCss.replace("@font-face {", "@font-face { font-display: block;"));

const css =
    // Download button effects
    createCssSyntax(".downloader-effect", BUTTON_STYLE) +
    createCssSyntax(".downloader-effect::before", BUTTON_BEFORE_STYLE) +
    createCssSyntax(".downloader-effect-optional::before", BUTTON_OPTIONAL_BEFORE_STYLE) +
    createCssSyntax(".mantine-Menu-dropdown > .mantine-Menu-item.downloader-effect::before", { "top": "0px" }) +
    createCssSyntax(".downloader-effect::after", BUTTON_AFTER_STYLE) +
    createCssSyntax(".downloader-options-container", OPTIONS_CONTAINER_STYLE) +
    createCssSyntax(".downloader-options-btn", OPTIONS_BTN_STYLE) +
    createCssSyntax(".downloader-options-btn:hover", { "background-color": "rgba(255,255,255,0.1)" }) +
    createCssSyntax(".downloader-options-menu", OPTIONS_MENU_STYLE) +
    createCssSyntax(".downloader-options-menu.show", { "display": "flex" }) +
    createCssSyntax(".downloader-option-item", OPTION_ITEM_STYLE) +
    // Prevent layout shift/FOIT for icons
    ".material-symbols-outlined { font-display: block; width: 1em; overflow: hidden; }" +
    // Keyframes
    "@keyframes blink { 0% { opacity: 0; } 100% { opacity: 1; } } " +
    "@keyframes downloader-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } } ";

GM_addStyle(css);

(function () {
    "use strict";

    const orgFetch = unsafeWindow.fetch;
    unsafeWindow.fetch = async (...args) => {
        if (args && args.length > 0 && args[0].startsWith("/api/track/view")) {
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
    if (intervalId !== undefined) {
        clearInterval(intervalId);
        intervalId = undefined;
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
        const colorCodes = [...$btn.css("background-color").matchAll("\\d+")].map((c) => Number.parseInt(c[0]));
        // If the blue component is greater than 0x80, consider it an active.
        if (!(colorCodes[0] < 0x80 && colorCodes[1] < 0x80 && colorCodes[2] > 0x80)) {
            $mainContents.find(".downloader-binded").removeClass("downloader-binded");
            $mainContents.find(".downloader-effect").removeClass("downloader-effect");
        }
    });
    intervalId = setInterval(() => {
        const $downloadButton = $mainContents.find("a[href^='/api/download/models/']");
        if (!$downloadButton.parent().is(".download-button-container")) {
            $downloadButton.each((_, button) => {
                const $button = $(button);
                if ($button.closest(".mantine-Accordion-content").length) {
                    return;
                }
                const $buttonWrapper = $("<div>")
                    .css({
                        "display": "flex",
                        "flex-direction": "row",
                    })
                    .addClass("download-button-container");
                $buttonWrapper.prependTo($button.parent());
                $buttonWrapper.append($button);

                const $optionMenu = createOptionMenu();
                $buttonWrapper.append($optionMenu);

                $optionMenu.closest(".mantine-Card-root").css({
                    "overflow": "visible",
                });
            });
        }

        $downloadButton.each((_, button) => {
            const $button = $(button);
            if ($button.closest(".mantine-Accordion-content").length) {
                $button.addClass("downloader-effect-optional");
            }
        });

        $downloadButton.filter(":not(.downloader-binded):not([data-disabled=true])").each((_, link) => {
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
                    e.preventDefault();
                    e.stopPropagation();
                    const modelUrl = e.currentTarget.href;
                    getModelId(modelUrl).then((modelId) => {
                        downloadAll(modelId, modelUrl);
                    });
                }
            };
            $link.on("click.downloader", allDownloadFunc);
        });
        if ($mainContents.find("[data-tour='model:download']:not(.downloader-binded)").length === 0) {
            clearInterval(intervalId);
            intervalId = undefined;
        }
    }, INTERVAL);
}

function createOptionMenu() {
    const $container = $('<div class="downloader-options-container"></div>');
    const $optBtn = $('<div class="downloader-options-btn" title="Downloader Settings"></div>');
    const $settingsIcon = $("<span>")
        .addClass("material-symbols-outlined settings")
        .css({
            "font-size": "20px",
            "color": "var(--mantine-color-text)",
        })
        .text("settings");
    $optBtn.append($settingsIcon);
    const $menu = $('<div class="downloader-options-menu"></div>');

    const $tooltip2Icon = $("<span>")
        .addClass("material-symbols-outlined tooltip_2")
        .css({
            "font-size": "16px",
            "color": "#ff922b",
        })
        .text("tooltip_2");

    const $helpIcon = $("<a>")
        .addClass("material-symbols-outlined help")
        .css({
            "font-size": "16px",
        })
        .text("help");

    options.forEach((opt) => {
        const isChecked = getOption(opt.key, opt.default);
        const $item = $("<label>").addClass("downloader-option-item");
        const $input = $("<input type='checkbox'>").prop("checked", isChecked).data("key", opt.key);
        const $label = $("<span>").css({ "display": "flex", "align-items": "center" }).text(opt.label);
        $item.append($input).append($label);
        if (opt.attention) {
            $label.append($tooltip2Icon.clone());
            $label.attr("title", opt.attention);
        }
        if (opt.help) {
            const $help = $helpIcon.clone().attr({ "href": opt.help, "target": "_blank", "rel": "noopener noreferrer" });
            $item.append($help);
        }
        $input.on("change", function () {
            setOption(opt.key, this.checked);
        });
        $menu.append($item);
    });

    $optBtn.on("click", (e) => {
        e.stopPropagation();
        $menu.toggleClass("show");
    });

    $(document).on("click", (e) => {
        if (!$(e.target).closest(".downloader-options-container").length) {
            $menu.removeClass("show");
        }
    });

    $container.append($optBtn).append($menu);
    return $container;
}

function getId() {
    return document.location.pathname.split(/[\/\?]/)[2];
}

async function getModelId(modelUrl) {
    const match = document.location.search.match(/modelVersionId=(\d+)/);
    if (match && match.length > 1) {
        return match[1];
    }

    const id = getId();
    const res = await fetch(API_MODELS + id);
    const json = await res.json();
    if (json.modelVersions.length) {
        return json.modelVersions[0].id;
    }
    return modelUrl.match(/models\/(\d+)/)[1];
}

function downloadAll(modelId, modelUrl) {
    const metaInfoToast = Toast.showProgress("Fetching metadata...");
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
                downloadModelFile(modelUrl, fileNameBase, modelInfo.name);
                downloadMetaFile(json, fileNameBase);
                metaInfoToast.showSuccess(`${fileNameBase}.civitai.info downloaded`);
                downloadImageFile(json, fileNameBase, 0);
                if (getOption("description_txt", OPT_DESCRIPTION_TXT_DEFAULT) && description) {
                    downloadDescriptionFile(description, fileNameBase);
                    Toast.showSuccess(`${fileNameBase}.description.txt downloaded`);
                }
            } else {
                metaInfoToast.showInfo("No downloadable file found.");
            }
        },
        onerror: function (err) {
            console.error("Model version fetch failed", err);
            metaInfoToast.showError("Failed to fetch metadata.");
        },
    });
}

function downloadModelFile(modelUrl, fileNameBase, modelFileName) {
    const modelToast = Toast.showProgress(`Preparing ${modelFileName}...`);
    downloadUrl(modelUrl, fileNameBase, modelFileName, {
        onload: () => {
            modelToast.showSuccess(`${modelFileName} downloaded`);
        },
        onerror: (err) => {
            console.error("Model download failed", err);
            modelToast.showError(`Failed to fetch ${modelFileName}`);
        },
        ontimeout: () => {
            modelToast.showError(`Timed out downloading ${modelFileName}`);
        },
    });
}

function downloadImageFile(modelVersionInfo, fileNameBase, imgIdx) {
    const previewToast = Toast.showProgress(`Preparing ${fileNameBase}.preview.png...`);
    let imgs = modelVersionInfo.images;
    if (getOption("image_file_only", OPT_IMAGE_FILE_ONLY_DEFAULT)) {
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
                downloadBlob(blob, fileNameBase, `${fileNameBase}.preview.${ext}`);
                previewToast.showSuccess(`${fileNameBase}.preview.${ext} downloaded`);
            },
            onerror: function (err) {
                console.error("Preview download failed", err);
                previewToast.showError(`Failed to fetch ${fileNameBase}.preview`);
            },
        });
    } else {
        previewToast.showInfo(`No preview image available`);
    }
}

function downloadMetaFile(modelVersionInfo, fileNameBase) {
    const json = [JSON.stringify(modelVersionInfo, null, 4)];
    const blob = new Blob(json, { type: "text/plain" });
    downloadBlob(blob, fileNameBase, `${fileNameBase}.civitai.info`);
}

function downloadDescriptionFile(description, fileNameBase) {
    const blob = new Blob([description], { type: "text/plain" });
    downloadBlob(blob, fileNameBase, `${fileNameBase}.description.txt`);
}

function downloadBlob(blob, fileNameBase, fileName) {
    const objectURL = URL.createObjectURL(blob);
    const cleanup = () => {
        URL.revokeObjectURL(objectURL);
    };
    const callback = {
        onload: cleanup,
        onerror: cleanup,
        ontimeout: cleanup,
    };
    downloadUrl(objectURL, fileNameBase, fileName, callback);
}

function downloadUrl(url, fileNameBase, fileName, callback = () => {}) {
    if (getOption("save_to_subfolder", OPT_SAVE_TO_SUBFOLDER_DEFAULT)) {
        downloadGM(url, fileNameBase, fileName, callback);
    } else {
        downloadHref(url, fileName, callback.onload || (() => {}));
    }
}

function downloadGM(url, fileNameBase, fileName, callback = () => {}) {
    let downloadFileName;
    if (getOption("save_to_subfolder", OPT_SAVE_TO_SUBFOLDER_DEFAULT)) {
        downloadFileName = fileNameBase + "/" + fileName;
    } else {
        downloadFileName = fileName;
    }

    GM_download({
        url: url,
        name: downloadFileName,
        ...callback,
    });
}

/**
 * Downloads via temporary link injection.
 * Used as a fallback when other download managers interfere with GM_download's filename handling.
 */
function downloadHref(url, fileName, callback = () => {}) {
    const $a = $("<a>").attr({ href: url, download: fileName }).appendTo($(document.body));
    $a.get(0).click();
    $a.remove();
    callback();
}

class Toast {
    TOAST_DEFAULT_DURATION = 3000; // ms

    _element = document.createElement("div");
    _messageElement = document.createElement("p");

    _container;
    _timer = 0;

    static TOAST_CONTAINER_STYLE = {
        "position": "fixed",
        "top": "12px",
        "right": "12px",
        "display": "flex",
        "flex-direction": "column",
        "gap": "8px",
        "z-index": "2147483647",
        "pointer-events": "none",
    };
    static TOAST_STYLE = {
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
    static TOAST_MESSAGE_STYLE = {
        "margin": 0,
    };
    static TOAST_PROGRESS_ANIMATION_STYLE = {
        "content": "''",
        "width": "16px",
        "height": "16px",
        "border": "2px solid rgba(255,255,255,0.35)",
        "border-top-color": "#fff",
        "border-radius": "50%",
        "animation": "downloader-spin 1s linear infinite",
    };
    static TOAST_SUCCESS_STYLE = {
        "background": "rgba(0,128,64,0.78)",
        "box-shadow": "0 3px 4px 0px rgba(0,128,64,0.3)",
    };
    static TOAST_ERROR_STYLE = {
        "background": "rgba(180,0,32,0.78)",
        "box-shadow": "0 3px 4px 0px rgba(180,0,32,0.3)",
    };
    static TOAST_CLOSING_STYLE = {
        "animation": `downloader-toast-out ${TOAST_DEFAULT_EASE_DURATION}ms ease-in forwards`,
    };

    static {
        const css =
            createCssSyntax(".downloader-toast-container", Toast.TOAST_CONTAINER_STYLE) +
            createCssSyntax(".downloader-toast", Toast.TOAST_STYLE) +
            createCssSyntax(".downloader-toast-message", Toast.TOAST_MESSAGE_STYLE) +
            createCssSyntax(".downloader-toast.downloader-toast--progress::before", Toast.TOAST_PROGRESS_ANIMATION_STYLE) +
            createCssSyntax(".downloader-toast.downloader-toast--success", Toast.TOAST_SUCCESS_STYLE) +
            createCssSyntax(".downloader-toast.downloader-toast--error", Toast.TOAST_ERROR_STYLE) +
            createCssSyntax(".downloader-toast.downloader-toast--closing", Toast.TOAST_CLOSING_STYLE) +
            "@keyframes downloader-toast-in { from { transform: translateY(-10px); opacity: 0; } to { transform: translateY(0); opacity: 1; } } " +
            "@keyframes downloader-toast-out { from { transform: translateY(0); opacity: 1; } to { transform: translateY(-10px); opacity: 0; } } ";

        GM_addStyle(css);
    }

    constructor() {
        this._container = document.querySelector(".downloader-toast-container");
        if (!this._container) {
            this._container = document.createElement("div");
            this._container.className = "downloader-toast-container";
            document.body.appendChild(this._container);
        }
        this._element = document.createElement("div");
        this._element.classList.add("downloader-toast");

        this._messageElement = document.createElement("p");
        this._messageElement.className = "downloader-toast-message";
        this._element.appendChild(this._messageElement);
    }

    static showInfo(message) {
        const toast = new Toast();
        toast.showInfo(message);
        return toast;
    }

    static showProgress(message) {
        const toast = new Toast();
        toast.showProgress(message);
        return toast;
    }

    static showSuccess(message) {
        const toast = new Toast();
        toast.showSuccess(message);
        return toast;
    }

    static showError(message) {
        const toast = new Toast();
        toast.showError(message);
        return toast;
    }

    showInfo(message) {
        this.show(message, "info");
    }

    showProgress(message) {
        this.show(message, "progress");
    }

    showSuccess(message) {
        this.show(message, "success");
    }

    showError(message) {
        this.show(message, "error");
    }

    show(message, toastType) {
        const duration = this._getDuration(toastType);
        this._setMessage(message, toastType);
        if (!this._element.isConnected) {
            this._container.prepend(this._element);
        } else if (this._timer) {
            clearTimeout(this._timer);
        }
        if (duration > 0) {
            this._timer = setTimeout(() => this._close(), duration);
        }
    }

    _setMessage(message, toastType) {
        this._element.classList.remove(...["info", "progress", "success", "error"].map((t) => `downloader-toast--${t}`));
        this._element.classList.add(`downloader-toast--${toastType}`);
        this._messageElement.textContent = message;
    }

    _getDuration(toastType) {
        return toastType === "progress" ? 0 : this.TOAST_DEFAULT_DURATION;
    }

    _close() {
        if (!this._element.isConnected) {
            return;
        }
        if (this._timer) {
            clearTimeout(this._timer);
        }
        this._element.classList.add("downloader-toast--closing");
        setTimeout(() => {
            if (this._element?.parentElement) {
                this._element.remove();
            }
        }, this.TOAST_DEFAULT_DURATION);
    }
}
