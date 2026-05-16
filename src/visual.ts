"use strict";

import powerbi from "powerbi-visuals-api";
import * as d3 from "d3";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import { VisualSettingsModel } from "./settings";

import IVisual = powerbi.extensibility.visual.IVisual;
import IVisualHost = powerbi.extensibility.visual.IVisualHost;
import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import DataView = powerbi.DataView;
import ISelectionId = powerbi.visuals.ISelectionId;

interface CauseCategory {
    name: string;
    causes: string[];
    color: string;
    isCustomColor?: boolean;
    selectionId?: ISelectionId;
    tooltipItems: powerbi.extensibility.VisualTooltipDataItem[];
}

interface BoneLayout {
    cat: CauseCategory;
    w: number;
    h: number;
}

interface BonePair {
    top?: BoneLayout;
    bottom?: BoneLayout;
    x?: number;
}

const FALLBACK_COLORS: string[] = [
    "#FF826D", "#F7D267", "#5CC398", "#6CAED6", "#C58CCF", "#E8765F", "#E8C95E", "#55B88C"
];

export class Visual implements IVisual {
    private host: IVisualHost;
    private svg: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private root: d3.Selection<SVGGElement, unknown, null, undefined>;
    private formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualSettingsModel;
    private selectionManager: powerbi.extensibility.ISelectionManager;
    private tooltipService: powerbi.extensibility.ITooltipService;
    private eventService: powerbi.extensibility.IVisualEventService;
    private allowInteractions: boolean;

    constructor(options: VisualConstructorOptions) {
    this.host = options.host;
    this.selectionManager = this.host.createSelectionManager();
    this.tooltipService = this.host.tooltipService;
    this.eventService = options.host.eventService;
    this.allowInteractions = (this.host as any).allowInteractions !== false;
    this.formattingSettingsService = new FormattingSettingsService();
    this.formattingSettings = new VisualSettingsModel();

    this.svg = d3.select(options.element)
        .append("svg")
        .classed("fishbone-svg", true)
        .style("width", "100%")
        .style("height", "100%")
        .attr("preserveAspectRatio", "xMidYMid meet");

    this.root = this.svg.append("g").classed("fishbone-root", true);

    // ✅ ZOOM + PAN (with CTRL filter)
    const zoom = d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 3])
        .filter((event) => {
            return !event.ctrlKey; // ✅ prevents conflict with selection (bonus)
        })
        .on("zoom", (event) => {
            this.root.attr("transform", event.transform.toString());
        });

    this.svg.call(zoom as any);

    // ✅ DOUBLE CLICK RESET (optional bonus)
    this.svg.on("dblclick", () => {
        this.svg.transition().duration(400).call(
            zoom.transform as any,
            d3.zoomIdentity
        );
    });

    this.svg.on("click", () => {
        if (this.allowInteractions) this.selectionManager.clear();
    });

    this.svg.on("contextmenu", (event: PointerEvent) => {
        event.preventDefault();
        if (this.allowInteractions) {
            this.selectionManager.showContextMenu({}, { x: event.clientX, y: event.clientY });
        }
    });
}

    public update(options: VisualUpdateOptions): void {
        if (this.eventService && this.eventService.renderingStarted) {
            this.eventService.renderingStarted(options);
        }

        try {
            this.formattingSettings = this.formattingSettingsService
                .populateFormattingSettingsModel(VisualSettingsModel, options.dataViews?.[0]);

            this.root.selectAll("*").remove();

            const highContrast = !!(this.host.colorPalette.isHighContrast);
            const hcForeground = this.host.colorPalette.foreground?.value || "#FFFFFF";
            const hcBackground = this.host.colorPalette.background?.value || "#000000";

            const bg = highContrast ? hcBackground : this.formattingSettings.fishboneCard.backgroundColor.value.value;
            this.svg.style("background", bg);

            const dataView = options.dataViews?.[0];
            const data = this.parseData(dataView, highContrast);

            let dynamicEffectText = this.formattingSettings.fishboneCard.effectText.value || "PROBLEM OR OUTCOME";

            if (!data.length) {
                this.svg.attr("viewBox", `0 0 800 600`);
                this.renderLandingPage(800, 600, highContrast ? hcForeground : "#333333");
                this.finishRendering(options);
                return;
            }

            this.renderDynamicFishbone(data, dynamicEffectText, highContrast, hcForeground, hcBackground);
            this.finishRendering(options);
        } catch (error) {
            if (this.eventService && this.eventService.renderingFailed) {
                this.eventService.renderingFailed(options, String(error));
            }
            this.svg.attr("viewBox", `0 0 800 600`);
            this.renderError(800, 600, String(error));
        }
    }

    private finishRendering(options: VisualUpdateOptions): void {
        if (this.eventService && this.eventService.renderingFinished) {
            this.eventService.renderingFinished(options);
        }
    }

    private parseData(dataView: DataView | undefined, highContrast: boolean): CauseCategory[] {
        if (!dataView?.categorical?.categories?.length) return [];

        const categorical = dataView.categorical;
        let mainCol: powerbi.DataViewCategoryColumn | undefined;
        let subCol: powerbi.DataViewCategoryColumn | undefined;

        categorical.categories?.forEach(cat => {
            if (cat.source.roles?.mainCause) mainCol = cat;
            if (cat.source.roles?.subCause) subCol = cat;
        });

        if (!mainCol) return [];
        const tooltipValues = categorical.values || [];
        const map = new Map<string, CauseCategory>();
        let colorIndex = 0;

        // Determine whether to auto-generate colors
        const autoGenerate = this.formattingSettings.fishboneCard.autoGenerateCategoryColors.value;
        const mappingValue = this.formattingSettings.fishboneCard.categoryColorMapping.value;

        // Build manual mapping if not auto-generating
        const manualColorMap: { [key: string]: string } = {};
        if (!autoGenerate && mappingValue && mappingValue.trim()) {
            try {
                const lines = mappingValue.split(/\r?\n/);
                for (const line of lines) {
                    const parts = line.split(',');
                    for (const part of parts) {
                        const trimmed = part.trim();
                        if (!trimmed) continue;
                        const kv = trimmed.split(':');
                        if (kv.length === 2) {
                            const cat = kv[0].trim();
                            const col = kv[1].trim();
                            if (cat && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(col)) {
                                manualColorMap[cat.toLowerCase()] = col;
                            }
                        }
                    }
                }
            } catch (e) {
                console.warn("Failed to parse category color mapping:", e);
            }
        }

        const findSolidColor = (obj: any): string | undefined => {
            if (!obj || typeof obj !== "object") return undefined;
            if (obj.solid?.color && typeof obj.solid.color === "string") {
                return obj.solid.color;
            }
            if (typeof obj.color === "string") {
                return obj.color;
            }

            for (const key in obj) {
                if (!Object.prototype.hasOwnProperty.call(obj, key)) continue;
                const nested = obj[key];
                if (nested && typeof nested === "object") {
                    const found = findSolidColor(nested);
                    if (found) return found;
                }
            }

            return undefined;
        };

        const getColorFromDataView = (column: powerbi.DataViewCategoryColumn, index: number): string | undefined => {
            try {
                if (!column || !column.objects) return undefined;
                const categoryObject = column.objects[index];
                return findSolidColor(categoryObject);
            } catch (e) {
                console.warn("Error extracting color from data view objects:", e);
                return undefined;
            }
        };

        for (let i = 0; i < mainCol.values.length; i++) {
            const rawMain = mainCol.values[i];
            if (rawMain == null) continue;

            const mainName = String(rawMain).trim();
            const lowerMain = mainName.toLowerCase();

            if (!mainName || lowerMain === "(blank)" || lowerMain === "null" || lowerMain === "undefined") continue;

            if (!map.has(mainName)) {
                let color: string | undefined;
                let usedFallback = false;
                let isCustomColor = false;

                // 1. Try manual mapping first (only when auto-generate is OFF)
                if (!autoGenerate) {
                    const manual = manualColorMap[mainName.toLowerCase()];
                    if (manual && /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/.test(manual)) {
                        color = manual;
                        isCustomColor = true;
                    }
                }

                // 2. If no manual mapping (or auto-gen is ON), try other sources
                if (!color) {
                    // Try data view objects (user-set colors via Power BI UI)
                    const dataViewColor = getColorFromDataView(mainCol, i);
                    if (dataViewColor) {
                        color = dataViewColor;
                        isCustomColor = true;
                    } else {
                        // Try host palette with a good key that includes queryName for uniqueness
                        const paletteColor = this.host.colorPalette.getColor(`${mainCol.source.queryName}:${mainName}`);
                        if (paletteColor?.value) {
                            color = paletteColor.value;
                        } else {
                            // Fallback to fixed palette
                            color = FALLBACK_COLORS[colorIndex % FALLBACK_COLORS.length];
                            usedFallback = true;
                        }
                    }
                }

                // Only increment colorIndex if we used the fixed fallback palette
                if (usedFallback) {
                    colorIndex++;
                }

                const selectionId = this.host.createSelectionIdBuilder()
                    .withCategory(mainCol, i)
                    .createSelectionId();

                map.set(mainName, {
                    name: mainName,
                    causes: [],
                    color: highContrast ? "#FFFFFF" : color,
                    isCustomColor: isCustomColor,
                    selectionId,
                    tooltipItems: []
                });
            }

            const category = map.get(mainName)!;

            const rawSub = subCol ? subCol.values[i] : null;
            if (rawSub != null) {
                const subName = String(rawSub).trim();
                const lowerSub = subName.toLowerCase();
                if (subName && lowerSub !== "(blank)" && lowerSub !== "null" && lowerSub !== "undefined" && category.causes.indexOf(subName) === -1) {
                    category.causes.push(subName);
                }
            }

            tooltipValues.forEach((valueCol) => {
                const displayName = valueCol.source?.displayName || "Tooltip";
                const value = valueCol.values?.[i];
                if (value !== null && value !== undefined) {
                    if (category.tooltipItems.length === 0) {
                        tooltipValues.forEach((valueCol) => {
                            const displayName = valueCol.source?.displayName || "Tooltip";
                            const value = valueCol.values?.[i];
                            if (value !== null && value !== undefined) {
                                category.tooltipItems.push({
                                    displayName,
                                    value: String(value)
                                });
                            }
                        });
                    };
                }
            });
        }

        const categories = Array.from(map.values());
        categories.sort((a, b) => a.causes.length - b.causes.length);
        return categories;
    }

    private renderDynamicFishbone(
        categories: CauseCategory[],
        effectText: string,
        highContrast: boolean,
        hcForeground: string,
        hcBackground: string
    ): void {
        const s = this.formattingSettings.fishboneCard;
        const fontFamily = s.fontFamily.value || "Segoe UI, sans-serif";
        const baseCauseFontSize = Math.max(9, s.fontSize.value);
        const baseCategoryFontSize = Math.max(10, s.categoryFontSize.value);
        const effectFontSize = Math.max(12, s.effectFontSize.value);
        const boneOpacity = Math.max(10, Math.min(100, s.boneOpacity.value)) / 100;

        const spineColor = highContrast ? hcForeground : s.spineColor.value.value;
        const tailColor = highContrast ? hcForeground : s.tailColor.value.value;
        const headColor = highContrast ? hcForeground : s.headColor.value.value;
        const causeTextColor = highContrast ? hcBackground : s.fontColor.value.value;

        // Override colors if set, otherwise fallback
        
        const overrideOn = s.enableBoneColorOverride.value === true;

        const boneFillOverride = overrideOn ? s.boneFillColor.value.value : "";
        const boneStrokeOverride = overrideOn ? s.boneStrokeColor.value.value : "";

        const needleLineColorProp = s.needleLineColor.value.value;
        const categoryTextColorProp = s.categoryTextColor.value.value;
        const effectTextColorProp = s.effectTextColor.value.value;
        const titleTextColorProp = s.titleTextColor.value.value;

        const actualTitleTextColor = highContrast ? hcForeground : (titleTextColorProp || "#333A3D");
        const actualEffectTextColor = highContrast ? hcForeground : (effectTextColorProp || "#333A3D");
        const actualCategoryTextColor = categoryTextColorProp ? categoryTextColorProp : causeTextColor;
        const actualNeedleLineColor = needleLineColorProp ? needleLineColorProp : (highContrast ? hcForeground : "#FFFFFF");

        const defaultGapY = 28;
        const slantRatio = 1.0;
        const effectW = 200;
        const pairSpacingX = 40;

        const rawPairs: any[] = [];
        let startIndex = 0;

        if (categories.length % 2 !== 0) {
            const topCat = categories[0];
            const topBaseH = Math.max(70, (topCat.causes.length + 1) * defaultGapY + 15);
            const topW = Math.max(120, Math.max(0, ...topCat.causes.map(c => c.length * baseCauseFontSize * 0.65)) + 40);

            rawPairs.push({
                topCat, botCat: undefined,
                reqW: topW,
                reqH: topBaseH
            });
            startIndex = 1;
        }

        for (let i = startIndex; i < categories.length; i += 2) {
            const topCat = categories[i];
            const topBaseH = Math.max(70, (topCat.causes.length + 1) * defaultGapY + 15);
            const topW = Math.max(120, Math.max(0, ...topCat.causes.map(c => c.length * baseCauseFontSize * 0.65)) + 40);

            let botCat, botBaseH = 0, botW = 0;
            if (i + 1 < categories.length) {
                botCat = categories[i + 1];
                botBaseH = Math.max(70, (botCat.causes.length + 1) * defaultGapY + 15);
                botW = Math.max(120, Math.max(0, ...botCat.causes.map(c => c.length * baseCauseFontSize * 0.65)) + 40);
            }

            rawPairs.push({
                topCat, botCat,
                reqW: Math.max(topW, botW),
                reqH: Math.max(topBaseH, botBaseH)
            });
        }

        const globalMaxH = Math.max(0, ...rawPairs.map(p => p.reqH));
        const globalMaxW = Math.max(0, ...rawPairs.map(p => p.reqW));

        const pairs: BonePair[] = rawPairs.map((p, index) => {
            const ratio = rawPairs.length > 1 ? index / (rawPairs.length - 1) : 1;
            const taperH = globalMaxH * (0.7 + 0.3 * ratio);
            const taperW = globalMaxW * (0.7 + 0.3 * ratio);

            const finalH = Math.max(p.reqH, taperH);
            const finalW = Math.max(p.reqW, taperW);

            const pair: BonePair = { top: { cat: p.topCat, w: finalW, h: finalH } };
            if (p.botCat) pair.bottom = { cat: p.botCat, w: finalW, h: finalH };
            return pair;
        });

        const lastPair = pairs[pairs.length - 1];
        const tailH = pairs[0].top!.h;
        const tailW = pairs[0].top!.w * 0.34;

        let currentX = tailW + 80;
        pairs.forEach(p => {
            p.x = currentX + p.top!.w;
            currentX = p.x + pairSpacingX;
        });

        const spineStartX = tailW * 0.8;

        // Head setup: No gap between head and ribs
        const headStartX = currentX - pairSpacingX;
        const nearestRibHeight = lastPair.top!.h * 2;
        const headH = nearestRibHeight * 1.1;
        const headW = headH * 1.0;
        const spineEndX = headStartX + (headW * 0.15);

        const maxTopH = Math.max(0, ...pairs.map(p => p.top!.h));
        const totalW = headStartX + headW + effectW + 60;
        const titleSpace = s.showTitle.value ? 80 : 40;
        const totalH = (maxTopH * 2) + titleSpace + 80;
        const centerY = titleSpace + maxTopH + 20;

        this.svg.attr("viewBox", `-60 -60 ${totalW + 120} ${totalH + 120}`);

        const defs = this.root.append("defs");
        if (s.showShadow.value && !highContrast) {
            const filter = defs.append("filter").attr("id", "fishboneShadow").attr("x", "-20%").attr("y", "-20%").attr("width", "140%").attr("height", "140%");
            filter.append("feDropShadow").attr("dx", 0).attr("dy", 3).attr("stdDeviation", 3).attr("flood-opacity", 0.3);
        }

        if (s.showTitle.value) {
            this.root.append("text").attr("x", totalW / 2).attr("y", 45).attr("text-anchor", "middle").attr("font-family", fontFamily).attr("font-weight", 900).attr("font-size", 36).attr("fill", actualTitleTextColor).text("FISHBONE ANALYSIS");
        }

        this.root.append("line")
            .attr("x1", spineStartX - 20)
            .attr("y1", centerY)
            .attr("x2", spineEndX)
            .attr("y2", centerY)
            .attr("stroke", spineColor)
            .attr("stroke-width", Math.max(2, s.spineThickness.value))
            .attr("stroke-linecap", "round");

        this.drawTail(spineStartX, centerY, tailW, tailH, tailColor, highContrast);

        pairs.forEach(p => {
            if (p.top) {
                this.drawRibAndNeedles(p.top, p.x!, centerY, "upper", slantRatio, baseCauseFontSize, baseCategoryFontSize, fontFamily, causeTextColor, highContrast, hcForeground, boneOpacity, boneFillOverride, boneStrokeOverride, actualNeedleLineColor, actualCategoryTextColor);
            }
            if (p.bottom) {
                this.drawRibAndNeedles(p.bottom, p.x!, centerY, "lower", slantRatio, baseCauseFontSize, baseCategoryFontSize, fontFamily, causeTextColor, highContrast, hcForeground, boneOpacity, boneFillOverride, boneStrokeOverride, actualNeedleLineColor, actualCategoryTextColor);
            }
        });

        this.drawHead(headStartX, centerY, headW, headH, headColor, highContrast);

        this.drawEffectText(effectText, headStartX + headW + 10, centerY, effectW, effectFontSize, fontFamily, actualEffectTextColor);
    }

    private drawRibAndNeedles(
        layout: BoneLayout,
        startX: number,
        centerY: number,
        type: "upper" | "lower",
        slantRatio: number,
        baseCauseFontSize: number,
        baseCatFontSize: number,
        fontFamily: string,
        fontColor: string,
        highContrast: boolean,
        hcForeground: string,
        boneOpacity: number,
        boneFillOverride: string,
        boneStrokeOverride: string,
        needleLineColor: string,
        categoryTextColor: string
    ): void {
        const { cat, w, h } = layout;
        const slantX = h * slantRatio;
        const isUpper = type === "upper";
        const yDir = isUpper ? -1 : 1;
        const endY = centerY + (h * yDir);

        const dynamicCatFontSize = Math.min(baseCatFontSize * 1.8, Math.max(baseCatFontSize, w * 0.08));
        const dynamicCauseFontSize = Math.min(baseCauseFontSize * 1.5, Math.max(baseCauseFontSize, w * 0.06));

        const g = this.root.append("g")
            .classed("fishbone-chevron", true)
            .attr("tabindex", 0)
            .style("cursor", this.allowInteractions ? "pointer" : "default");

        const path = `M ${startX} ${centerY} L ${startX - w} ${centerY} L ${startX - w - slantX} ${endY} L ${startX - slantX} ${endY} Z`;

        const blockColor = highContrast ? "#000000" : (cat.isCustomColor ? cat.color : (boneFillOverride || cat.color));
        const strokeColor = highContrast ? hcForeground : (cat.isCustomColor ? cat.color : (boneStrokeOverride || cat.color));

        g.append("path")
            .attr("d", path)
            .attr("fill", blockColor)
            .attr("stroke", strokeColor)
            .attr("stroke-width", 16)
            .attr("stroke-linejoin", "round")
            .attr("opacity", boneOpacity)
            .attr("filter", !highContrast ? "url(#fishboneShadow)" : null);

        const ribLineStroke = boneStrokeOverride ? boneStrokeOverride : (highContrast ? hcForeground : "#FFFFFF");
        g.append("line")
            .attr("x1", startX).attr("y1", centerY)
            .attr("x2", startX - slantX).attr("y2", endY)
            .attr("stroke", ribLineStroke)
            .attr("stroke-width", 3)
            .attr("opacity", 0.9);

        
        const maxItems = Math.max(cat.causes.length, 1);
        const dynamicGapY = Math.max(18, (h - 20) / (maxItems + 1));


        cat.causes.forEach((cause, idx) => {
            const ny = centerY + ((idx + 1) * dynamicGapY * yDir);
            const nx = startX - ((idx + 1) * dynamicGapY * slantRatio);

            g.append("line")
                .attr("x1", nx).attr("y1", ny)
                .attr("x2", nx - w + 15).attr("y2", ny)
                .attr("stroke", needleLineColor)
                .attr("stroke-width", 1.5)
                .attr("opacity", 0.8);

            g.append("text")
                .attr("x", nx - 6)
                .attr("y", ny - 4)
                .attr("text-anchor", "end")
                .attr("font-family", fontFamily)
                .attr("font-size", dynamicCauseFontSize)
                .attr("font-weight", 600)
                .attr("fill", fontColor)
                .text(cause);
        });

        g.append("text")
            .attr("x", startX - slantX - (w / 2))
            .attr("y", isUpper ? endY - (dynamicCatFontSize / 2 + 6) : endY + dynamicCatFontSize + 8)
            .attr("text-anchor", "middle")
            .attr("font-family", fontFamily)
            .attr("font-weight", 900)
            .attr("font-size", dynamicCatFontSize)
            .attr("fill", categoryTextColor)
            .text(cat.name.toUpperCase());

        const tooltipItems = [
            { displayName: "Category", value: cat.name },
            { displayName: "Count", value: String(cat.causes.length) },
            ...cat.tooltipItems
        ];

        g.on("mouseover", (event: MouseEvent) => {
            g.select("path").attr("opacity", 1);
            if (this.tooltipService?.show) {
                this.tooltipService.show({ coordinates: [event.clientX, event.clientY], isTouchEvent: false, dataItems: tooltipItems, identities: cat.selectionId ? [cat.selectionId] : [] });
            }
        });

        g.on("mousemove", (event: MouseEvent) => {
            if (this.tooltipService?.move) {
                this.tooltipService.move({ coordinates: [event.clientX, event.clientY], isTouchEvent: false, dataItems: tooltipItems, identities: cat.selectionId ? [cat.selectionId] : [] });
            }
        });

        g.on("mouseout", () => {
            g.select("path").attr("opacity", boneOpacity);
            if (this.tooltipService?.hide) this.tooltipService.hide({ immediately: true, isTouchEvent: false });
        });

        g.on("click", (event: PointerEvent) => {
            event.stopPropagation();
            if (this.allowInteractions && cat.selectionId) this.selectionManager.select(cat.selectionId, event.ctrlKey || event.metaKey);
        });
    }

    private drawTail(x: number, y: number, w: number, h: number, color: string, highContrast: boolean): void {
        const g = this.root.append("g").classed("fishbone-tail", true);
        const tailPath = `M ${x} ${y} L ${x - w} ${y - h * 0.5} L ${x - w * 0.6} ${y} L ${x - w} ${y + h * 0.5} Z`;
        const tailStrokeWidth = h * 0.04;
        g.append("path")
            .attr("d", tailPath)
            .attr("fill", color)
            .attr("stroke", color)
            .attr("stroke-width", tailStrokeWidth)
            .attr("stroke-linejoin", "round")
            .attr("filter", !highContrast ? "url(#fishboneShadow)" : null);
    }

    /**
     * SIMPLIFIED HEAD:
     * A clean triangle shape with rounded corners and a circle eye.
     */
    private drawHead(x: number, y: number, w: number, h: number, color: string, highContrast: boolean): void {
    const g = this.root.append("g").classed("fishbone-head", true);

    // ✅ =========================================
    // 🎛️ TRANSFORM CONTROLLER (EDIT THESE ONLY)
    // ✅ =========================================
    const flipX = false;            // ✅ flip horizontally
    const flipY = false;           // vertical flip (rarely needed)
    const rotateDeg = 0;           // try: 0, 180
    const scaleX = 1;              // stretch/shrink
    const scaleY = 1;

    // ✅ compute transform
    const transform = `
        translate(${x + w/2}, ${y})
        rotate(${rotateDeg})
        scale(${flipX ? -scaleX : scaleX}, ${flipY ? -scaleY : scaleY})
        translate(${-(x + w/2)}, ${-y})
    `;

    g.attr("transform", transform);

    // ✅ =========================================
    // 🐟 HEAD SHAPE (KEEP THIS CONSTANT)
    // ✅ =========================================
    const mouthDepth = w * 0.06;
    const mouthHeight = h * 0.08;

        const headPath = `
        M ${x} ${y - h/2}

        L ${x + w} ${y-mouthHeight}
        L ${x + w- mouthDepth*1.1} ${y}
        L ${x + w} ${y+mouthHeight*0.8}

        L ${x} ${y + h/2}
        Z
    `;


    g.append("path")
        .attr("d", headPath)
        .attr("fill", color)
        .attr("stroke", color)
        .attr("stroke-width", 2)
        .attr("stroke-linejoin", "round")
        .attr("filter", !highContrast ? "url(#fishboneShadow)" : null);

    // ✅ =========================================
    // 👁️ EYE
    // ✅ =========================================
    const eyeX = x + w * 0.3;
    const eyeY = y - h * 0.1;
    const eyeR = Math.max(6, h * 0.09);

    g.append("circle")
        .attr("cx", eyeX)
        .attr("cy", eyeY)
        .attr("r", eyeR)
        .attr("fill", "#FFFFFF");

g.append("circle")
            .attr("cx", eyeX + (eyeR * 0.15))
            .attr("cy", eyeY - (eyeR * 0.1))
            .attr("r", eyeR * 0.5)
            .attr("fill", highContrast ? "#FFF" : "#333");
}




    private drawEffectText(text: string, x: number, y: number, maxW: number, fontSize: number, fontFamily: string, fill: string): void {
        const words = text.toUpperCase().split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let current = "";
        const maxChars = Math.max(6, Math.floor(maxW / (fontSize * 0.6)));
        words.forEach(w => {
            const candidate = current ? `${current} ${w}` : w;
            if (candidate.length <= maxChars) current = candidate;
            else { if (current) lines.push(current); current = w; }
        });
        if (current) lines.push(current);

        const lh = fontSize * 1.2;
        const startY = y - (lines.length - 1) * lh / 2;
        lines.forEach((line, i) => {
            this.root.append("text").attr("x", x).attr("y", startY + i * lh).attr("dominant-baseline", "middle").attr("font-family", fontFamily).attr("font-weight", 900).attr("font-size", fontSize).attr("fill", fill).text(line);
        });
    }

    private renderLandingPage(width: number, height: number, color: string): void {
        this.root.append("text").attr("x", width / 2).attr("y", height / 2 - 20).attr("text-anchor", "middle").attr("font-size", 24).attr("fill", color).text("FISHBONE ANALYSIS");
        this.root.append("text").attr("x", width / 2).attr("y", height / 2 + 10).attr("text-anchor", "middle").attr("font-size", 14).attr("fill", "#666").text("Add Main Cause, Sub-Cause, and Problem fields to begin.");
    }

    private renderError(width: number, height: number, message: string): void {
        this.root.append("text").attr("x", width / 2).attr("y", height / 2).attr("text-anchor", "middle").attr("fill", "#C00000").text("Error: " + message.substring(0, 50));
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}