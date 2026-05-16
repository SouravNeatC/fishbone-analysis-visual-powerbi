"use strict";

import { formattingSettings } from "powerbi-visuals-utils-formattingmodel";

class FishboneCardSettings extends formattingSettings.SimpleCard {
    public effectText = new formattingSettings.TextInput({
        name: "effectText",
        displayName: "Problem / Outcome Text",
        description: "Text shown to the right of the fish head.",
        placeholder: "PROBLEM OR OUTCOME",
        value: "PROBLEM OR OUTCOME"
    });

    public showTitle = new formattingSettings.ToggleSwitch({
        name: "showTitle",
        displayName: "Show Title",
        description: "Show FISHBONE DIAGRAM title inside the visual.",
        value: false
    });

    public backgroundColor = new formattingSettings.ColorPicker({
        name: "backgroundColor",
        displayName: "Background Color",
        value: { value: "#FFFFFF" }
    });

    public spineColor = new formattingSettings.ColorPicker({
        name: "spineColor",
        displayName: "Spine Color",
        value: { value: "#A59480" }
    });

    public spineThickness = new formattingSettings.NumUpDown({
        name: "spineThickness",
        displayName: "Spine Thickness",
        value: 8
    });

    public headColor = new formattingSettings.ColorPicker({
        name: "headColor",
        displayName: "Fish Head Color",
        value: { value: "#A59480" }
    });

    public tailColor = new formattingSettings.ColorPicker({
        name: "tailColor",
        displayName: "Fish Tail Color",
        value: { value: "#A59480" }
    });

    public fontSize = new formattingSettings.NumUpDown({
        name: "fontSize",
        displayName: "Cause Font Size",
        value: 12
    });

    public fontFamily = new formattingSettings.TextInput({
        name: "fontFamily",
        displayName: "Font Family",
        placeholder: "Segoe UI, sans-serif",
        value: "Segoe UI, sans-serif"
    });

    public fontColor = new formattingSettings.ColorPicker({
        name: "fontColor",
        displayName: "Cause Font Color",
        value: { value: "#FFFFFF" }
    });

    public categoryFontSize = new formattingSettings.NumUpDown({
        name: "categoryFontSize",
        displayName: "Category Font Size",
        value: 13
    });

    public effectFontSize = new formattingSettings.NumUpDown({
        name: "effectFontSize",
        displayName: "Problem Text Font Size",
        value: 20
    });

    public boneOpacity = new formattingSettings.NumUpDown({
        name: "boneOpacity",
        displayName: "Bone Opacity (%)",
        value: 92
    });

    public showShadow = new formattingSettings.ToggleSwitch({
        name: "showShadow",
        displayName: "Show Shadow",
        description: "Adds soft shadow like the reference image.",
        value: true
    });

    public enableBoneColorOverride = new formattingSettings.ToggleSwitch({
        name: "enableBoneColorOverride",
        displayName: "Override Bone Colors",
        description: "When enabled, uses Bone Fill and Bone Stroke colors for all chevrons instead of category colors.",
        value: false
    });

    public boneFillColor = new formattingSettings.ColorPicker({
        name: "boneFillColor",
        displayName: "Bone Fill Color",
        description: "Override color for the fishbone chevrons.",
        value: { value: "#6A1B9A" } // empty means use data-driven color
    });

    public boneStrokeColor = new formattingSettings.ColorPicker({
        name: "boneStrokeColor",
        displayName: "Bone Stroke Color",
        description: "Override stroke color for the fishbone chevrons.",
        value: { value: "#6A1B9A" }
    });

    public needleLineColor = new formattingSettings.ColorPicker({
        name: "needleLineColor",
        displayName: "Needle Line Color",
        description: "Color of the small lines indicating causes.",
        value: { value: "#FFFFFF" }
    });

    public categoryTextColor = new formattingSettings.ColorPicker({
        name: "categoryTextColor",
        displayName: "Category Text Color",
        description: "Color of the main cause category names.",
        value: { value: "#333A3D"
    }});

    public effectTextColor = new formattingSettings.ColorPicker({
        name: "effectTextColor",
        displayName: "Problem Text Color",
        description: "Color of the problem/outcome text.",
        value: { value: "#333A3D"
    }});

    public titleTextColor = new formattingSettings.ColorPicker({
        name: "titleTextColor",
        displayName: "Title Text Color",
        description: "Color of the FISHBONE ANALYSIS title.",
        value: { value: "#333A3D"
    }});

    // Toggle to auto-generate category colors from data
    public autoGenerateCategoryColors = new formattingSettings.ToggleSwitch({
        name: "autoGenerateCategoryColors",
        displayName: "Auto-generate Category Colors",
        description: "When enabled, assigns a color to each category automatically (uses default palette). Disable to manually define mappings below.",
        value: true
    });

    // Manual mapping (used when autoGenerate is off)
    public categoryColorMapping = new formattingSettings.TextArea({
        name: "categoryColorMapping",
        displayName: "Category Color Mapping",
        description: "Each line: 'Category Name:#FF0000'. Use commas or new lines to separate mappings. Ignored when Auto-generate is ON.",
        placeholder: "Sales:#FF0000\nMarketing:#00FF00\nEngineering:#0000FF",
        value: ""
    });

    public name: string = "fishboneSettings";
    public displayName: string = "Fishbone Settings";
    public slices = [
        this.effectText,
        this.showTitle,
        this.backgroundColor,
        this.spineColor,
        this.spineThickness,
        this.headColor,
        this.tailColor,
        this.fontSize,
        this.fontFamily,
        this.fontColor,
        this.categoryFontSize,
        this.effectFontSize,
        this.boneOpacity,
        this.showShadow,
        this.enableBoneColorOverride,
        this.boneFillColor,
        this.boneStrokeColor,
        this.needleLineColor,
        this.categoryTextColor,
        this.effectTextColor,
        this.titleTextColor,
        this.autoGenerateCategoryColors,
        this.categoryColorMapping
    ];
}

export class VisualSettingsModel extends formattingSettings.Model {
    public fishboneCard = new FishboneCardSettings();
    public cards = [this.fishboneCard];
}