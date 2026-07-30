"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };

  // code.ts
  var TAG_PREFIX = "@@AminoHelps@@";
  var DEFAULTS = { checkColors: true, checkText: true, checkSpacing: true, checkDetached: true, checkRadius: true };
  var latestParams = DEFAULTS;
  var isExecuting = false;
  var PRIORITY_COLORS = {
    critical: { r: 0.88, g: 0.17, b: 0.17 },
    warning: { r: 0.93, g: 0.58, b: 0.07 },
    info: { r: 0.18, g: 0.46, b: 0.88 }
  };
  var AMINO_RADII = [2, 4, 8, 12, 16, 24, 32, 40, 48, 64];
  async function getActiveModes(rootNode) {
    var _a;
    const modes = [];
    if (!("resolvedVariableModes" in rootNode))
      return { brandName: "Unknown", modes };
    const resolvedModes = rootNode.resolvedVariableModes;
    if (!resolvedModes)
      return { brandName: "Unknown", modes };
    const modeNameCounts = {};
    for (const collectionId of Object.keys(resolvedModes)) {
      const modeId = resolvedModes[collectionId];
      try {
        const collection = await figma.variables.getVariableCollectionByIdAsync(collectionId);
        if (collection) {
          const modeEntry = collection.modes.find((m) => m.modeId === modeId);
          const modeName = (_a = modeEntry == null ? void 0 : modeEntry.name) != null ? _a : modeId;
          modes.push({ collectionName: collection.name, modeName });
          const parts = modeName.split("/");
          for (const p of parts) {
            const clean = p.trim();
            if (clean && clean.length > 1)
              modeNameCounts[clean] = (modeNameCounts[clean] || 0) + 1;
          }
        }
      } catch (e) {
      }
    }
    let brandName = "Unknown";
    let maxCount = 0;
    for (const [name, count] of Object.entries(modeNameCounts)) {
      if (count > maxCount) {
        maxCount = count;
        brandName = name;
      }
    }
    return { brandName, modes };
  }
  function detectElementRole(node) {
    if (node.type === "TEXT")
      return "text";
    const nameLower = node.name.toLowerCase();
    if (nameLower.includes("icon") || nameLower.includes("ico-") || nameLower.includes("_icon"))
      return "icon";
    if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION" || node.type === "STAR" || node.type === "POLYGON")
      return "icon";
    if (node.type === "INSTANCE" || node.type === "COMPONENT") {
      if (node.width <= 48 && node.height <= 48)
        return "icon";
    }
    if (node.type === "LINE")
      return "border";
    if ((node.type === "RECTANGLE" || node.type === "ELLIPSE") && node.width <= 32 && node.height <= 32)
      return "icon";
    if (node.type === "FRAME" || node.type === "RECTANGLE" || node.type === "ELLIPSE" || node.type === "SECTION")
      return "background";
    return "unknown";
  }
  function classifyTokenName(varName) {
    const lower = varName.toLowerCase();
    if (lower.includes("/text/") || lower.includes("text-0") || lower.includes("text-black") || lower.includes("text-white") || lower.includes("text-inverse") || lower.includes("text-brand") || lower.includes("text-link"))
      return "text";
    if (lower.includes("/icon/") || lower.includes("icon-") || lower.includes("/icon"))
      return "icon";
    if (lower.includes("/bg/") || lower.includes("bg-primary") || lower.includes("bg-secondary") || lower.includes("bg-brand") || lower.includes("bg-surface") || lower.includes("bg-overlay"))
      return "bg";
    if (lower.includes("/border") || lower.includes("border-"))
      return "border";
    return "unknown";
  }
  var ROLE_ALLOWED_TOKENS = {
    text: ["text"],
    icon: ["icon", "text"],
    background: ["bg"],
    border: ["border"],
    unknown: ["text", "icon", "bg", "border", "unknown"]
  };
  var ROLE_SUGGESTED_TOKEN = {
    text: "Semantic/Text/text-01",
    icon: "Semantic/Icon/icon-01",
    background: "Semantic/bg/Global/Primary/bg-primary-01",
    border: "Semantic/Borders/border-05",
    unknown: ""
  };
  var ROLE_LABELS = {
    text: "Text",
    icon: "Icon",
    background: "Background",
    border: "Border",
    unknown: "Element"
  };
  async function checkTokenMapping(node) {
    const issues = [];
    if (!node.boundVariables)
      return issues;
    const role = detectElementRole(node);
    if (role === "unknown")
      return issues;
    const allowedTokens = ROLE_ALLOWED_TOKENS[role];
    const roleLabel = ROLE_LABELS[role];
    const suggested = ROLE_SUGGESTED_TOKEN[role];
    const fillBindings = node.boundVariables.fills;
    if (fillBindings && Array.isArray(fillBindings)) {
      for (const alias of fillBindings) {
        if (!alias || !alias.id)
          continue;
        try {
          const variable = await figma.variables.getVariableByIdAsync(alias.id);
          if (!variable)
            continue;
          const tokenCat = classifyTokenName(variable.name);
          if (tokenCat === "unknown")
            continue;
          if (!allowedTokens.includes(tokenCat)) {
            issues.push({
              node,
              issue: `${roleLabel} fill using ${tokenCat} token: ${variable.name}`,
              category: "Token Mapping",
              priority: "critical",
              dsToken: suggested,
              solution: `${roleLabel} should use ${allowedTokens.join("/")} token \u2192 ${suggested}`
            });
          }
        } catch (e) {
        }
      }
    }
    const strokeBindings = node.boundVariables.strokes;
    if (strokeBindings && Array.isArray(strokeBindings)) {
      for (const alias of strokeBindings) {
        if (!alias || !alias.id)
          continue;
        try {
          const variable = await figma.variables.getVariableByIdAsync(alias.id);
          if (!variable)
            continue;
          const tokenCat = classifyTokenName(variable.name);
          if (tokenCat === "unknown")
            continue;
          if (tokenCat !== "border") {
            issues.push({
              node,
              issue: `Stroke using ${tokenCat} token: ${variable.name}`,
              category: "Token Mapping",
              priority: "warning",
              dsToken: "Semantic/Borders/border-05",
              solution: `Strokes should use border token \u2192 Semantic/Borders/border-05`
            });
          }
        } catch (e) {
        }
      }
    }
    return issues;
  }
  function suggestColorToken(node, isStroke) {
    if (isStroke)
      return "Semantic/Borders/border-05";
    if (node.type === "TEXT")
      return "Semantic/Text/text-01";
    return "Semantic/bg/Global/Primary/bg-primary-01";
  }
  function suggestTextStyle(fontSize) {
    if (fontSize >= 32)
      return "Display/Large/Bold";
    if (fontSize >= 24)
      return "Display/Medium/Bold";
    if (fontSize >= 20)
      return "Display/Small/Medium";
    if (fontSize >= 16)
      return "Body/Large/Medium";
    if (fontSize >= 14)
      return "Body/Medium/Medium";
    if (fontSize >= 12)
      return "Caption/Large/Medium";
    if (fontSize >= 10)
      return "Label/Small/Medium";
    return "Label/X small/Bold";
  }
  function findClosestRadius(value) {
    let best = AMINO_RADII[0];
    let bestDist = Math.abs(value - best);
    for (const r of AMINO_RADII) {
      const d = Math.abs(value - r);
      if (d < bestDist) {
        bestDist = d;
        best = r;
      }
    }
    return best;
  }
  async function runAudit(params) {
    const selection = figma.currentPage.selection;
    const roots = selection.length > 0 ? [...selection] : [...figma.currentPage.children];
    const allNodes = [];
    function collect(node) {
      if (node.name.startsWith(TAG_PREFIX))
        return;
      allNodes.push(node);
      if ("children" in node) {
        for (const child of node.children)
          collect(child);
      }
    }
    for (const r of roots)
      collect(r);
    const referenceNode = roots[0];
    const brandInfo = await getActiveModes(referenceNode);
    const issues = [];
    for (const node of allNodes) {
      if (params.checkColors && "fills" in node) {
        const fills = node.fills;
        if (Array.isArray(fills)) {
          const hasBound = node.boundVariables && node.boundVariables.fills && node.boundVariables.fills.length > 0;
          const hasStyle = "fillStyleId" in node && node.fillStyleId && node.fillStyleId !== "";
          if (!hasBound && !hasStyle) {
            for (const f of fills) {
              if (f.type === "SOLID" && f.visible !== false) {
                const hex = "#" + [f.color.r, f.color.g, f.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
                const token = suggestColorToken(node, false);
                issues.push({ node, issue: `Hardcoded fill: ${hex}`, category: "Color", priority: "critical", dsToken: token, solution: `Use Amino token \u2192 ${token}` });
              }
            }
          }
        }
      }
      if (params.checkColors && "strokes" in node) {
        const strokes = node.strokes;
        if (Array.isArray(strokes)) {
          const hasBound = node.boundVariables && node.boundVariables.strokes && node.boundVariables.strokes.length > 0;
          const hasStyle = "strokeStyleId" in node && node.strokeStyleId && node.strokeStyleId !== "";
          if (!hasBound && !hasStyle) {
            for (const s of strokes) {
              if (s.type === "SOLID" && s.visible !== false) {
                const hex = "#" + [s.color.r, s.color.g, s.color.b].map((c) => Math.round(c * 255).toString(16).padStart(2, "0")).join("");
                const token = suggestColorToken(node, true);
                issues.push({ node, issue: `Hardcoded stroke: ${hex}`, category: "Color", priority: "warning", dsToken: token, solution: `Use Amino token \u2192 ${token}` });
              }
            }
          }
        }
      }
      if (params.checkText && node.type === "TEXT") {
        const textNode = node;
        if (!textNode.textStyleId || textNode.textStyleId === "") {
          const fontSize = typeof textNode.fontSize === "number" ? textNode.fontSize : 14;
          const suggested = suggestTextStyle(fontSize);
          issues.push({ node, issue: `No text style (${fontSize}px)`, category: "Typography", priority: "critical", dsToken: suggested, solution: `Apply Amino style \u2192 ${suggested}` });
        }
      }
      if (params.checkRadius && "cornerRadius" in node) {
        const n = node;
        if (typeof n.cornerRadius === "number" && n.cornerRadius > 0) {
          const hasBound = n.boundVariables && n.boundVariables.topLeftRadius;
          if (!hasBound && !AMINO_RADII.includes(n.cornerRadius)) {
            const closest = findClosestRadius(n.cornerRadius);
            issues.push({ node, issue: `Non-standard radius: ${n.cornerRadius}px`, category: "Radius", priority: "info", dsToken: `Primitive/Radius/radius-${closest}`, solution: `Use Amino token \u2192 Primitive/Radius/radius-${closest} (${closest}px)` });
          }
        }
      }
      if (params.checkDetached && node.type === "FRAME") {
        const frame = node;
        const pluginData = frame.getPluginData("defn");
        if (pluginData && pluginData.includes("detached")) {
          issues.push({ node, issue: "Detached component", category: "Component", priority: "critical", dsToken: "Original Amino component", solution: "Re-attach to original Amino library component" });
        }
      }
      if (params.checkColors) {
        const mappingIssues = await checkTokenMapping(node);
        issues.push(...mappingIssues);
      }
    }
    issues.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      return order[a.priority] - order[b.priority];
    });
    return { issues, brandInfo };
  }
  async function placeCommentPins(issues, targetBounds) {
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    const created = [];
    const CARD_W = 220;
    const CARD_GAP = 6;
    const LINE_GAP = 24;
    const frameLeftX = Math.round(targetBounds.x);
    const frameRightX = Math.round(targetBounds.x + targetBounds.width);
    const frameMidX = Math.round(targetBounds.x + targetBounds.width / 2);
    const limit = Math.min(issues.length, 30);
    const occupiedLeft = [];
    const occupiedRight = [];
    function findFreeY(desiredY, cardH, occupied) {
      let y = desiredY;
      let tries = 0;
      while (tries < 200) {
        let overlap = false;
        for (const slot of occupied) {
          if (y < slot.y + slot.h + CARD_GAP && y + cardH + CARD_GAP > slot.y) {
            y = slot.y + slot.h + CARD_GAP;
            overlap = true;
            break;
          }
        }
        if (!overlap)
          break;
        tries++;
      }
      return Math.round(y);
    }
    for (let i = 0; i < limit; i++) {
      const issue = issues[i];
      const node = issue.node;
      if (!node || node.removed)
        continue;
      const nodeBounds = node.absoluteBoundingBox;
      if (!nodeBounds)
        continue;
      const color = PRIORITY_COLORS[issue.priority];
      const nodeMidX = Math.round(nodeBounds.x + nodeBounds.width / 2);
      const isLeft = nodeMidX < frameMidX;
      const PAD = 8;
      const TEXT_W = CARD_W - PAD * 2;
      const headerText = figma.createText();
      headerText.fontName = { family: "Inter", style: "Bold" };
      headerText.characters = `#${i + 1}  ${issue.priority.toUpperCase()} \u2014 ${issue.category}`;
      headerText.fontSize = 10;
      headerText.fills = [{ type: "SOLID", color }];
      headerText.resize(TEXT_W, headerText.height);
      headerText.textAutoResize = "HEIGHT";
      const layerText = figma.createText();
      layerText.fontName = { family: "Inter", style: "Medium" };
      layerText.characters = `Layer: ${node.name.slice(0, 35)}`;
      layerText.fontSize = 9;
      layerText.fills = [{ type: "SOLID", color: { r: 0.5, g: 0.5, b: 0.5 } }];
      layerText.resize(TEXT_W, layerText.height);
      layerText.textAutoResize = "HEIGHT";
      const issueText = figma.createText();
      issueText.fontName = { family: "Inter", style: "Regular" };
      issueText.characters = issue.issue || "No description";
      issueText.fontSize = 10;
      issueText.fills = [{ type: "SOLID", color: { r: 0.2, g: 0.2, b: 0.2 } }];
      issueText.resize(TEXT_W, issueText.height);
      issueText.textAutoResize = "HEIGHT";
      const tokenText = figma.createText();
      tokenText.fontName = { family: "Inter", style: "Medium" };
      tokenText.characters = issue.solution || "Check Amino DS";
      tokenText.fontSize = 9;
      tokenText.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.38, b: 0.72 } }];
      tokenText.resize(TEXT_W, tokenText.height);
      tokenText.textAutoResize = "HEIGHT";
      const gap = 2;
      const totalH = PAD + headerText.height + gap + layerText.height + gap + issueText.height + gap + tokenText.height + PAD;
      const card = figma.createFrame();
      card.name = `${TAG_PREFIX}#${i + 1}`;
      card.resize(CARD_W, totalH);
      card.cornerRadius = 6;
      card.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
      card.strokes = [{ type: "SOLID", color }];
      card.strokeWeight = 1.5;
      card.strokeAlign = "INSIDE";
      card.effects = [{ type: "DROP_SHADOW", color: { r: 0, g: 0, b: 0, a: 0.08 }, offset: { x: 0, y: 1 }, radius: 4, spread: 0, visible: true, blendMode: "NORMAL", boundVariables: {} }];
      card.clipsContent = false;
      figma.currentPage.appendChild(card);
      card.appendChild(headerText);
      headerText.x = PAD;
      headerText.y = PAD;
      let yPos = PAD + headerText.height + gap;
      card.appendChild(layerText);
      layerText.x = PAD;
      layerText.y = yPos;
      yPos += layerText.height + gap;
      card.appendChild(issueText);
      issueText.x = PAD;
      issueText.y = yPos;
      yPos += issueText.height + gap;
      card.appendChild(tokenText);
      tokenText.x = PAD;
      tokenText.y = yPos;
      const nodeMidY = Math.round(nodeBounds.y + nodeBounds.height / 2);
      const cardH = totalH;
      const desiredY = nodeMidY - cardH / 2;
      if (isLeft) {
        const cardY = findFreeY(desiredY, cardH, occupiedLeft);
        card.x = frameLeftX - LINE_GAP - CARD_W;
        card.y = cardY;
        occupiedLeft.push({ y: cardY, h: cardH });
        const ncx = Math.round(nodeBounds.x), ccx = card.x + CARD_W;
        const ccy = Math.round(cardY + cardH / 2);
        const line = figma.createLine();
        line.name = `${TAG_PREFIX}Line #${i + 1}`;
        line.strokeWeight = 1;
        line.strokes = [{ type: "SOLID", color, opacity: 0.6 }];
        line.dashPattern = [4, 3];
        figma.currentPage.appendChild(line);
        const dx = ncx - ccx, dy = nodeMidY - ccy, len = Math.sqrt(dx * dx + dy * dy), angle = Math.atan2(dy, dx);
        line.resize(len, 0);
        line.x = ccx;
        line.y = ccy;
        line.rotation = -angle * (180 / Math.PI);
        created.push(line);
        const dot = figma.createEllipse();
        dot.name = `${TAG_PREFIX}Dot #${i + 1}`;
        dot.resize(6, 6);
        dot.fills = [{ type: "SOLID", color }];
        figma.currentPage.appendChild(dot);
        dot.x = ncx - 3;
        dot.y = nodeMidY - 3;
        created.push(dot);
      } else {
        const cardY = findFreeY(desiredY, cardH, occupiedRight);
        card.x = frameRightX + LINE_GAP;
        card.y = cardY;
        occupiedRight.push({ y: cardY, h: cardH });
        const ncx = Math.round(nodeBounds.x + nodeBounds.width), ccx = card.x;
        const ccy = Math.round(cardY + cardH / 2);
        const line = figma.createLine();
        line.name = `${TAG_PREFIX}Line #${i + 1}`;
        line.strokeWeight = 1;
        line.strokes = [{ type: "SOLID", color, opacity: 0.6 }];
        line.dashPattern = [4, 3];
        figma.currentPage.appendChild(line);
        const dx = ccx - ncx, dy = ccy - nodeMidY, len = Math.sqrt(dx * dx + dy * dy), angle = Math.atan2(dy, dx);
        line.resize(len, 0);
        line.x = ncx;
        line.y = nodeMidY;
        line.rotation = -angle * (180 / Math.PI);
        created.push(line);
        const dot = figma.createEllipse();
        dot.name = `${TAG_PREFIX}Dot #${i + 1}`;
        dot.resize(6, 6);
        dot.fills = [{ type: "SOLID", color }];
        figma.currentPage.appendChild(dot);
        dot.x = ncx - 3;
        dot.y = nodeMidY - 3;
        created.push(dot);
      }
      created.push(card);
    }
    return created;
  }
  async function createReportTable(issues, brandInfo) {
    await figma.loadFontAsync({ family: "Inter", style: "Regular" });
    await figma.loadFontAsync({ family: "Inter", style: "Bold" });
    await figma.loadFontAsync({ family: "Inter", style: "Medium" });
    const TABLE_W = 700;
    const report = figma.createFrame();
    report.name = `${TAG_PREFIX}Audit Report`;
    report.resize(TABLE_W, 1);
    report.layoutMode = "VERTICAL";
    report.primaryAxisSizingMode = "AUTO";
    report.paddingTop = 28;
    report.paddingBottom = 28;
    report.paddingLeft = 28;
    report.paddingRight = 28;
    report.itemSpacing = 20;
    report.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 } }];
    report.cornerRadius = 16;
    report.strokes = [{ type: "SOLID", color: { r: 0.9, g: 0.9, b: 0.9 } }];
    report.strokeWeight = 1;
    const title = figma.createText();
    title.fontName = { family: "Inter", style: "Bold" };
    title.characters = "Amino Helps \u2014 Design Audit Report";
    title.fontSize = 20;
    title.fills = [{ type: "SOLID", color: { r: 0.08, g: 0.08, b: 0.08 } }];
    report.appendChild(title);
    if (brandInfo.modes.length > 0) {
      const modeBox = figma.createFrame();
      modeBox.name = `${TAG_PREFIX}Modes`;
      modeBox.layoutMode = "VERTICAL";
      modeBox.primaryAxisSizingMode = "AUTO";
      modeBox.counterAxisSizingMode = "AUTO";
      modeBox.paddingTop = 10;
      modeBox.paddingBottom = 10;
      modeBox.paddingLeft = 14;
      modeBox.paddingRight = 14;
      modeBox.itemSpacing = 4;
      modeBox.cornerRadius = 10;
      modeBox.fills = [{ type: "SOLID", color: { r: 0.96, g: 0.96, b: 0.98 } }];
      report.appendChild(modeBox);
      modeBox.layoutAlign = "STRETCH";
      const brandLbl = figma.createText();
      brandLbl.fontName = { family: "Inter", style: "Bold" };
      brandLbl.characters = `Brand: ${brandInfo.brandName}`;
      brandLbl.fontSize = 14;
      brandLbl.fills = [{ type: "SOLID", color: { r: 0.15, g: 0.3, b: 0.7 } }];
      modeBox.appendChild(brandLbl);
      const modeSummary = figma.createText();
      modeSummary.fontName = { family: "Inter", style: "Regular" };
      const uniqueModes = [...new Set(brandInfo.modes.map((m) => m.modeName))];
      modeSummary.characters = `Active modes: ${uniqueModes.join(", ")}`;
      modeSummary.fontSize = 11;
      modeSummary.fills = [{ type: "SOLID", color: { r: 0.4, g: 0.4, b: 0.5 } }];
      modeBox.appendChild(modeSummary);
    }
    const critCount = issues.filter((i) => i.priority === "critical").length;
    const warnCount = issues.filter((i) => i.priority === "warning").length;
    const infoCount = issues.filter((i) => i.priority === "info").length;
    const summaryText = figma.createText();
    summaryText.fontName = { family: "Inter", style: "Medium" };
    summaryText.characters = `Total: ${issues.length} issues  |  Critical: ${critCount}  |  Warning: ${warnCount}  |  Info: ${infoCount}`;
    summaryText.fontSize = 13;
    summaryText.fills = [{ type: "SOLID", color: { r: 0.25, g: 0.25, b: 0.25 } }];
    report.appendChild(summaryText);
    const divider1 = figma.createRectangle();
    divider1.name = `${TAG_PREFIX}divider`;
    divider1.resize(TABLE_W - 56, 1);
    divider1.fills = [{ type: "SOLID", color: { r: 0.92, g: 0.92, b: 0.92 } }];
    report.appendChild(divider1);
    divider1.layoutAlign = "STRETCH";
    let currentPriority = null;
    const maxIssues = Math.min(issues.length, 60);
    for (let i = 0; i < maxIssues; i++) {
      const issue = issues[i];
      if (issue.priority !== currentPriority) {
        currentPriority = issue.priority;
        if (i > 0) {
          const spacer = figma.createFrame();
          spacer.name = `${TAG_PREFIX}spacer`;
          spacer.resize(10, 8);
          spacer.fills = [];
          report.appendChild(spacer);
        }
        const sectionTitle = figma.createText();
        sectionTitle.fontName = { family: "Inter", style: "Bold" };
        sectionTitle.characters = `${issue.priority.toUpperCase()} (${issue.priority === "critical" ? critCount : issue.priority === "warning" ? warnCount : infoCount})`;
        sectionTitle.fontSize = 12;
        sectionTitle.fills = [{ type: "SOLID", color: PRIORITY_COLORS[issue.priority] }];
        report.appendChild(sectionTitle);
      }
      const row = figma.createFrame();
      row.name = `${TAG_PREFIX}Row ${i + 1}`;
      row.layoutMode = "VERTICAL";
      row.primaryAxisSizingMode = "AUTO";
      row.paddingTop = 8;
      row.paddingBottom = 8;
      row.paddingLeft = 12;
      row.paddingRight = 12;
      row.itemSpacing = 3;
      row.cornerRadius = 8;
      row.fills = i % 2 === 0 ? [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.99 } }] : [];
      report.appendChild(row);
      row.layoutAlign = "STRETCH";
      const line1 = figma.createText();
      line1.fontName = { family: "Inter", style: "Bold" };
      line1.characters = `#${i + 1}  ${issue.node.name}`;
      line1.fontSize = 11;
      line1.fills = [{ type: "SOLID", color: { r: 0.12, g: 0.12, b: 0.12 } }];
      line1.textAutoResize = "WIDTH_AND_HEIGHT";
      row.appendChild(line1);
      line1.layoutAlign = "STRETCH";
      const line2 = figma.createText();
      line2.fontName = { family: "Inter", style: "Regular" };
      line2.characters = `Issue: ${issue.issue}  |  Category: ${issue.category}`;
      line2.fontSize = 11;
      line2.fills = [{ type: "SOLID", color: { r: 0.35, g: 0.35, b: 0.35 } }];
      line2.textAutoResize = "WIDTH_AND_HEIGHT";
      row.appendChild(line2);
      line2.layoutAlign = "STRETCH";
      const line3 = figma.createText();
      line3.fontName = { family: "Inter", style: "Medium" };
      line3.characters = `Fix: ${issue.solution}`;
      line3.fontSize = 11;
      line3.fills = [{ type: "SOLID", color: { r: 0.1, g: 0.35, b: 0.7 } }];
      line3.textAutoResize = "WIDTH_AND_HEIGHT";
      row.appendChild(line3);
      line3.layoutAlign = "STRETCH";
    }
    const footer = figma.createText();
    footer.fontName = { family: "Inter", style: "Regular" };
    footer.characters = `Generated by Amino Helps  \u2022  ${(/* @__PURE__ */ new Date()).toLocaleDateString()}  \u2022  Amino Design System`;
    footer.fontSize = 10;
    footer.fills = [{ type: "SOLID", color: { r: 0.6, g: 0.6, b: 0.6 } }];
    report.appendChild(footer);
    return report;
  }
  async function clearAllGeneratedNodes() {
    let count = 0;
    const toRemove = [];
    for (const child of figma.currentPage.children) {
      if (child.name.startsWith(TAG_PREFIX)) {
        toRemove.push(child);
        count++;
      }
    }
    for (const node of toRemove)
      node.remove();
    return count;
  }
  async function runAuditAction(params) {
    const target = figma.currentPage.selection.length > 0 ? figma.currentPage.selection[0] : null;
    if (!target) {
      figma.notify("Select a frame to audit", { timeout: 3e3 });
      return;
    }
    await clearAllGeneratedNodes();
    const { issues, brandInfo } = await runAudit(params);
    if (issues.length === 0) {
      figma.notify("No issues found \u2014 aligned with Amino Design System!", { timeout: 3e3 });
      return;
    }
    const targetBounds = target.absoluteBoundingBox;
    if (targetBounds) {
      await placeCommentPins(issues, targetBounds);
    }
    const reportTable = await createReportTable(issues, brandInfo);
    figma.currentPage.appendChild(reportTable);
    if (targetBounds) {
      reportTable.x = Math.round(targetBounds.x + targetBounds.width + 280);
      reportTable.y = Math.round(targetBounds.y);
    }
    const critCount = issues.filter((i) => i.priority === "critical").length;
    const warnCount = issues.filter((i) => i.priority === "warning").length;
    const infoCount = issues.filter((i) => i.priority === "info").length;
    figma.notify(`Amino Helps: ${issues.length} issues \u2014 ${critCount} critical, ${warnCount} warning, ${infoCount} info`, { timeout: 5e3 });
    figma.currentPage.selection = [reportTable];
    figma.viewport.scrollAndZoomIntoView([reportTable]);
  }
  function pushActionStates() {
    const sel = figma.currentPage.selection;
    const enabled = sel.length > 0;
    const label = enabled ? `Audit "${sel[0].name.slice(0, 18)}"` : "Select a frame";
    figma.ui.postMessage({
      type: "action-state",
      actions: {
        audit: { enabled, label },
        clear: { enabled: true, label: "Clear all" }
      }
    });
  }
  figma.showUI(__uiFiles__["ui"], { width: 280, height: 400 });
  pushActionStates();
  figma.on("selectionchange", () => {
    if (!isExecuting)
      pushActionStates();
  });
  figma.ui.onmessage = (msg) => {
    if (msg.type === "resize" && msg.height) {
      figma.ui.resize(280, Math.max(120, Math.min(900, Math.round(msg.height))));
      return;
    }
    if (msg.type === "action") {
      if (msg.id === "audit") {
        latestParams = __spreadValues(__spreadValues({}, DEFAULTS), msg.params);
        isExecuting = true;
        runAuditAction(latestParams).catch((e) => figma.notify(String(e), { error: true })).finally(() => {
          isExecuting = false;
          pushActionStates();
        });
      }
      if (msg.id === "clear") {
        clearAllGeneratedNodes().then((count) => {
          figma.notify(count > 0 ? `Cleared ${count} items` : "Nothing to clear", { timeout: 3e3 });
          pushActionStates();
        });
      }
    }
  };
})();
