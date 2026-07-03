(function attachUpworkParser(root) {
  const namespace = root.UpworkEnhancer || {};
  const CARD_OVERRIDES = new WeakMap();
  const CLIENT_HISTORY_LIMIT = 10;

  function cleanText(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function textOf(node) {
    if (!node) return "";
    if (!node.querySelectorAll) {
      return cleanText(node.textContent);
    }
    const clone = node.cloneNode(true);
    clone
      .querySelectorAll(
        ".uwe-card-panel, .uwe-sidebar, .uwe-badge, [data-uwe-job-id]"
      )
      .forEach((element) => element.remove());
    return cleanText(clone.textContent);
  }

  function absoluteUrl(value) {
    if (!value) return "";
    try {
      const base =
        root.location && root.location.href
          ? root.location.href
          : "https://www.upwork.com/";
      return new URL(value, base).toString();
    } catch (_) {
      return "";
    }
  }

  function extractJobIdFromUrl(url) {
    const source = String(url || "");
    const tildeMatch = source.match(/~[A-Za-z0-9_]+/);
    if (tildeMatch) return tildeMatch[0];
    try {
      const parsed = new URL(
        source,
        root.location && root.location.href
          ? root.location.href
          : "https://www.upwork.com/"
      );
      const pathMatch = parsed.pathname.match(/^\/jobs\/([^/?#]+)/);
      if (pathMatch) return decodeURIComponent(pathMatch[1]);
    } catch (_) {
      const pathMatch = source.match(/^\/jobs\/([^/?#]+)/);
      if (pathMatch) return decodeURIComponent(pathMatch[1]);
    }
    return "";
  }

  function isJobUrl(value) {
    const url = absoluteUrl(value);
    if (!url) return false;
    try {
      const parsed = new URL(url);
      return /^\/jobs\/[^/?#]+/.test(parsed.pathname) || /\/details\/~[A-Za-z0-9_]+/.test(parsed.pathname);
    } catch (_) {
      return (
        /^https?:\/\/[^/]+\/jobs\/[^/?#]+/.test(url) ||
        /^https?:\/\/[^/]+\/.+\/details\/~[A-Za-z0-9_]+/.test(url)
      );
    }
  }

  function isJobLinkElement(element) {
    return Boolean(
      element &&
        element.matches &&
        element.matches("a[href]") &&
        isJobUrl(element.getAttribute("href")) &&
        !isUtilityJobLink(element)
    );
  }

  function isUtilityJobLink(element) {
    const label = cleanText(
      [
        textOf(element),
        element && element.getAttribute ? element.getAttribute("aria-label") : "",
        element && element.getAttribute ? element.getAttribute("title") : ""
      ].join(" ")
    );
    return /^open job(?: in (?:a )?new window)?$/i.test(label);
  }

  function jobLinksOf(node) {
    if (!node) return [];
    const links = [];
    if (isJobLinkElement(node)) {
      links.push(node);
    }
    if (node.querySelectorAll) {
      links.push(
        ...Array.from(node.querySelectorAll("a[href]")).filter(isJobLinkElement)
      );
    }
    return links;
  }

  function firstText(rootNode, selectors) {
    for (const selector of selectors) {
      const element = rootNode.querySelector(selector);
      const value = textOf(element);
      if (value) return value;
    }
    return "";
  }

  function parseMoneyText(value) {
    const text = String(value || "").replace(/,/g, "");
    const match = text.match(/\$\s*(\d+(?:\.\d+)?)([kKmM])?/);
    if (!match) return null;
    const amount = Number(match[1]);
    if (!Number.isFinite(amount)) return null;
    const suffix = match[2] ? match[2].toLowerCase() : "";
    if (suffix === "k") return amount * 1000;
    if (suffix === "m") return amount * 1000000;
    return amount;
  }

  function parseHourly(text) {
    const source = String(text || "").replace(/,/g, "");
    const hourlyRange = source.match(
      /\$\s*(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:\/?\s*(?:hr|hour)|hourly)/i
    );
    if (hourlyRange) {
      return {
        budgetType: "hourly",
        hourlyMin: Number(hourlyRange[1]),
        hourlyMax: Number(hourlyRange[2])
      };
    }

    const hourlySingle = source.match(
      /\$\s*(\d+(?:\.\d+)?)\s*(?:\/?\s*(?:hr|hour)|hourly)/i
    );
    if (hourlySingle) {
      return {
        budgetType: "hourly",
        hourlyMin: Number(hourlySingle[1]),
        hourlyMax: Number(hourlySingle[1])
      };
    }

    return {};
  }

  function parseFixedBudget(text) {
    const source = String(text || "");
    if (!/fixed|budget|price/i.test(source)) return {};
    const amount = parseMoneyText(source);
    if (amount === null) return {};
    return {
      budgetType: "fixed",
      fixedBudget: amount
    };
  }

  function proposalBucket(min, max, openEnded) {
    if (openEnded && min >= 50) return "extreme";
    if (max <= 5) return "low";
    if (max <= 15) return "moderate";
    if (max <= 50) return "high";
    return "extreme";
  }

  function parseProposalSignal(text) {
    const source = String(text || "");
    const proposalMatch = source.match(
      /(?:proposals?|proposal count)\s*:?\s*(less than\s+\d+|\d+\s*(?:to|-|–)\s*\d+|\d+\+?)/i
    );
    if (!proposalMatch) return {
      count: null,
      label: "",
      bucket: "",
      openEnded: false
    };
    const rawValue = cleanText(proposalMatch[1]);
    const value = rawValue.toLowerCase();
    const lessThan = value.match(/less than\s+(\d+)/);
    if (lessThan) {
      const max = Math.max(0, Number(lessThan[1]) - 1);
      return {
        count: max,
        label: rawValue,
        bucket: proposalBucket(0, max, false),
        openEnded: false
      };
    }
    const range = value.match(/(\d+)\s*(?:to|-|–)\s*(\d+)/);
    if (range) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      return {
        count: max,
        label: rawValue,
        bucket: proposalBucket(min, max, false),
        openEnded: false
      };
    }
    const single = value.match(/(\d+)/);
    const count = single ? Number(single[1]) : null;
    const openEnded = /\+/.test(value);
    return {
      count,
      label: rawValue,
      bucket: count === null ? "" : proposalBucket(count, count, openEnded),
      openEnded
    };
  }

  function parseProposalCount(text) {
    return parseProposalSignal(text).count;
  }

  function parseCount(label, text) {
    const pattern = new RegExp(`(?:${label})\\s*:?\\s*(\\d+)`, "i");
    const match = String(text || "").match(pattern);
    return match ? Number(match[1]) : null;
  }

  function parsePostedAgeHours(text) {
    const match = String(text || "").match(
      /(\d+)\s*(minute|minutes|hour|hours|day|days|week|weeks|month|months)\s+ago/i
    );
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    if (unit.startsWith("minute")) return amount / 60;
    if (unit.startsWith("hour")) return amount;
    if (unit.startsWith("day")) return amount * 24;
    if (unit.startsWith("week")) return amount * 24 * 7;
    if (unit.startsWith("month")) return amount * 24 * 30;
    return null;
  }

  function parseClientSpend(text) {
    const source = String(text || "");
    const match = source.match(/\$\s*[\d,.]+[kKmM]?\+?\s*(?:spent|total spent)/i);
    return match ? parseMoneyText(match[0]) : null;
  }

  function parseRating(text) {
    const match = String(text || "").match(/(\d(?:\.\d+)?)\s*(?:of 5|stars?|rating)/i);
    return match ? Number(match[1]) : null;
  }

  function parseHireRate(text) {
    const match = String(text || "").match(/(\d+)\s*%\s*(?:hire rate|hired|hire)/i);
    return match ? Number(match[1]) : null;
  }

  function parseSkills(rootNode) {
    const selectors = [
      '[data-test*="skill"]',
      '[data-cy*="skill"]',
      ".air3-token",
      ".up-skill-badge",
      ".skill",
      "a[href*='q=']"
    ];
    const values = [];
    for (const selector of selectors) {
      rootNode.querySelectorAll(selector).forEach((element) => {
        const value = textOf(element);
        if (value && value.length <= 48 && !/\$|proposal|posted/i.test(value)) {
          values.push(value);
        }
      });
    }
    return Array.from(new Set(values)).slice(0, 20);
  }

  function parseProposalQuestions(rootNode, fullText) {
    const localBlocks = proposalQuestionBlocks(rootNode);
    for (const block of localBlocks) {
      const questions =
        parseProposalQuestionsFromDomBlock(block) ||
        parseProposalQuestionsFromText(textOf(block));
      if (questions.length) return questions;
    }
    return parseProposalQuestionsFromText(fullText);
  }

  function parseProposalQuestionsFromDomBlock(block) {
    if (!block || !block.querySelectorAll) return null;
    const listItems = Array.from(block.querySelectorAll("li, [role='listitem']"))
      .filter((item) => !item.closest(".uwe-sidebar, .uwe-card-panel, .uwe-badge"))
      .map((item) => cleanProposalQuestion(textOf(item)))
      .filter(Boolean);
    const uniqueItems = uniqueQuestions(listItems);
    return uniqueItems.length ? uniqueItems.slice(0, 12) : null;
  }

  function proposalQuestionBlocks(rootNode) {
    if (!rootNode || !rootNode.querySelectorAll) return [];
    return Array.from(
      rootNode.querySelectorAll(
        "[data-test*='question'], [data-cy*='question'], section, .air3-card-section, .up-card-section, article, div"
      )
    )
      .filter((element) => {
        if (element.closest(".uwe-sidebar, .uwe-card-panel, .uwe-badge")) {
          return false;
        }
        const value = textOf(element);
        return (
          value.length >= 70 &&
          value.length <= 2400 &&
          proposalQuestionMarkerPattern().test(value)
        );
      })
      .sort((a, b) => textOf(a).length - textOf(b).length);
  }

  function proposalQuestionMarkerPattern() {
    return /you will be asked to answer the following questions when submitting a proposal/i;
  }

  function parseProposalQuestionsFromText(value) {
    const text = cleanText(value);
    const marker = proposalQuestionMarkerPattern();
    const markerMatch = text.match(marker);
    if (!markerMatch || markerMatch.index === undefined) return [];

    const start = markerMatch.index + markerMatch[0].length;
    const afterMarker = text.slice(start).replace(/^[:\s]+/, "");
    const sectionEnd = afterMarker.search(
      /\b(?:Skills and Expertise|Activity on this job|About the client|Bid range|Average bid amounts|Project Type|Job link|Client's recent history|Other open jobs|Send a proposal)\b/i
    );
    const segment = cleanText(
      sectionEnd >= 0 ? afterMarker.slice(0, sectionEnd) : afterMarker
    );
    if (!segment) return [];

    const numberedQuestions = parseNumberedQuestions(segment);
    if (numberedQuestions.length) return numberedQuestions;

    return splitUnnumberedQuestions(segment).slice(0, 12);
  }

  function parseNumberedQuestions(segment) {
    const matches = Array.from(segment.matchAll(/(?:^|\s)(\d{1,2})[.)]\s*/g));
    if (!matches.length) return [];

    return matches
      .map((match, index) => {
        const next = matches[index + 1];
        const start = match.index + match[0].length;
        const end = next ? next.index : segment.length;
        return cleanProposalQuestion(segment.slice(start, end));
      })
      .filter(Boolean)
      .slice(0, 12);
  }

  function cleanProposalQuestion(value) {
    const question = cleanText(value)
      .replace(/^[-*•\s]+/, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!question || question.length < 8) return "";
    return question.slice(0, 500);
  }

  function splitUnnumberedQuestions(segment) {
    const source = cleanText(segment);
    if (!source) return [];

    const questionMarkParts = source.match(/[^?]+\?/g);
    if (questionMarkParts && questionMarkParts.length > 1) {
      return uniqueQuestions(questionMarkParts.map(cleanProposalQuestion));
    }

    const parts = source
      .split(
        /\s+(?=(?:Describe|What|Which|How|Why|When|Where|Do|Does|Did|Can|Could|Would|Tell)\b)/i
      )
      .map(cleanProposalQuestion)
      .filter(Boolean);
    return uniqueQuestions(parts.length ? parts : [source]);
  }

  function uniqueQuestions(questions) {
    const seen = new Set();
    return (questions || []).filter((question) => {
      const key = question
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function classifyJobCardContextText(value) {
    const text = cleanText(value);
    if (!text) return "";
    if (
      /client'?s recent history|recent history|jobs in progress|to freelancer:|billed:/i.test(
        text
      )
    ) {
      return "history";
    }
    if (/other open jobs by this client|other open jobs/i.test(text)) {
      return "clientJob";
    }
    return "";
  }

  function contextFromPreviousSiblings(node) {
    let sibling = node && node.previousElementSibling;
    for (let index = 0; sibling && index < 8; index += 1) {
      const context = classifyJobCardContextText(textOf(sibling).slice(0, 1200));
      if (context) return context;
      sibling = sibling.previousElementSibling;
    }
    return "";
  }

  function contextFromLocalHeadings(node) {
    if (!node || !node.querySelectorAll) return "";
    const headingText = Array.from(
      node.querySelectorAll("h1, h2, h3, h4, [role='heading']")
    )
      .slice(0, 8)
      .map(textOf)
      .join(" ");
    return classifyJobCardContextText(headingText);
  }

  function contextFromPreviousHeading(node) {
    if (!node || !node.ownerDocument) return "";
    const followingFlag =
      root.Node && root.Node.DOCUMENT_POSITION_FOLLOWING
        ? root.Node.DOCUMENT_POSITION_FOLLOWING
        : 4;
    const headings = Array.from(
      node.ownerDocument.querySelectorAll("h1, h2, h3, h4, [role='heading']")
    );
    let unclassifiedHeadings = 0;
    for (let index = headings.length - 1; index >= 0; index -= 1) {
      const heading = headings[index];
      if (heading === node || heading.contains(node)) continue;
      if (!(heading.compareDocumentPosition(node) & followingFlag)) continue;
      const context = classifyJobCardContextText(textOf(heading));
      if (context) return context;
      const value = textOf(heading);
      if (/jobs you might like|search|summary|skills|activity|about the client/i.test(value)) {
        continue;
      }
      unclassifiedHeadings += 1;
      if (unclassifiedHeadings >= 4) {
        break;
      }
    }
    return "";
  }

  function detectJobCardContext(card) {
    const ownContext = classifyJobCardContextText(textOf(card).slice(0, 2400));
    if (ownContext) return ownContext;

    const ownerBody = card && card.ownerDocument ? card.ownerDocument.body : null;
    let current = card;
    for (let depth = 0; current && current !== ownerBody && depth < 6; depth += 1) {
      const siblingContext = contextFromPreviousSiblings(current);
      if (siblingContext) return siblingContext;

      if (
        current !== card &&
        (countJobLinks(current) > 2 || textOf(current).length > 3000)
      ) {
        break;
      }

      const headingContext = contextFromLocalHeadings(current);
      if (headingContext) return headingContext;

      current = current.parentElement;
    }
    return "job";
  }

  function titleSelectorsForContext(context) {
    if (context === "history" || context === "clientJob") {
      return [
        '[data-test*="job-title"]',
        '[data-cy*="job-title"]',
        "h2",
        "h3",
        "h4"
      ];
    }
    return [
      '[data-test*="job-title"]',
      "h2",
      "h3",
      "h4"
    ];
  }

  function countJobLinks(node) {
    return jobLinksOf(node).length;
  }

  function contextForLink(link) {
    if (!link || link.closest(".uwe-card-panel, .uwe-sidebar")) return "";

    const previousHeadingContext = contextFromPreviousHeading(link);
    if (previousHeadingContext) return previousHeadingContext;

    let current = link.parentElement;
    for (let depth = 0; current && current !== link.ownerDocument.body && depth < 8; depth += 1) {
      const siblingContext = contextFromPreviousSiblings(current);
      if (siblingContext) return siblingContext;

      if (countJobLinks(current) > 2 || textOf(current).length > 3000) break;

      const directContext = classifyJobCardContextText(textOf(current).slice(0, 2400));
      if (directContext) return directContext;

      const headingContext = contextFromLocalHeadings(current);
      if (headingContext) return headingContext;

      current = current.parentElement;
    }
    return "";
  }

  function nearestHistoryBlock(link) {
    const selectors = [
      "article",
      "li",
      "[data-test*='history']",
      "[data-test*='feedback']",
      "[data-test*='job']",
      ".air3-card-section",
      ".up-card-section"
    ];
    for (const selector of selectors) {
      const match = link.closest(selector);
      if (match && countJobLinks(match) <= 1) return match;
    }
    return link.parentElement || link;
  }

  function collectFollowingText(startElement) {
    const parts = [];
    let current = startElement && startElement.nextElementSibling;
    for (let index = 0; current && index < 8; index += 1) {
      if (
        isJobLinkElement(current) ||
        countJobLinks(current) > 0
      ) {
        break;
      }
      const value = textOf(current);
      if (value) {
        if (/view more|other open jobs|footer navigation/i.test(value)) break;
        parts.push(value);
      }
      current = current.nextElementSibling;
    }
    return parts;
  }

  function historyEntryText(link) {
    const parts = [textOf(link)];
    const block = nearestHistoryBlock(link);
    if (block && block !== link && countJobLinks(block) <= 1) {
      parts.push(textOf(block));
      parts.push(...collectFollowingText(block));
    } else if (link.parentElement && countJobLinks(link.parentElement) <= 1) {
      parts.push(textOf(link.parentElement));
      parts.push(...collectFollowingText(link.parentElement));
    }
    return cleanText(parts.join(" ")).slice(0, 3200);
  }

  function findClientHistoryLinks(doc) {
    const links = jobLinksOf(doc);
    const historyLinks = [];
    const seen = new Set();

    for (const link of links) {
      if (historyLinks.length >= CLIENT_HISTORY_LIMIT) break;
      if (contextForLink(link) !== "history") continue;

      const url = absoluteUrl(link.getAttribute("href"));
      const jobId = extractJobIdFromUrl(url);
      const key = jobId || url || textOf(link);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      CARD_OVERRIDES.set(link, {
        context: "history",
        title: textOf(link) || "Untitled job",
        url,
        text: historyEntryText(link)
      });
      historyLinks.push(link);
    }

    return historyLinks;
  }

  function jobLinkOf(rootNode) {
    return jobLinksOf(rootNode)[0] || null;
  }

  function commonFields(rootNode, fallbackUrl, textOverride) {
    const text = textOverride ? cleanText(textOverride) : textOf(rootNode);
    const link = jobLinkOf(rootNode);
    const url = absoluteUrl((link && link.getAttribute("href")) || fallbackUrl);
    const hourly = parseHourly(text);
    const fixedBudget = parseFixedBudget(text);
    const proposalSignal = parseProposalSignal(text);
    const clientPaymentVerified = /payment verified/i.test(text)
      ? true
      : /payment unverified|payment not verified/i.test(text)
        ? false
        : null;

    return {
      jobId:
        rootNode.getAttribute("data-ev-job-uid") ||
        rootNode.getAttribute("data-job-id") ||
        extractJobIdFromUrl(url),
      url,
      description: text,
      skills: parseSkills(rootNode),
      proposalQuestions: parseProposalQuestions(rootNode, text),
      budgetType: hourly.budgetType || fixedBudget.budgetType || "",
      hourlyMin: hourly.hourlyMin || null,
      hourlyMax: hourly.hourlyMax || null,
      fixedBudget: fixedBudget.fixedBudget || null,
      experienceLevel: firstText(rootNode, [
        '[data-test*="experience"]',
        '[data-cy*="experience"]'
      ]),
      postedAge: (text.match(/(\d+\s+\w+\s+ago)/i) || [])[1] || "",
      postedAgeHours: parsePostedAgeHours(text),
      proposalCount: proposalSignal.count,
      proposalCountLabel: proposalSignal.label,
      proposalCountBucket: proposalSignal.bucket,
      proposalCountIsOpenEnded: proposalSignal.openEnded,
      interviewCount: parseCount("interviewing|interviews?", text),
      inviteCount: parseCount("invites? sent|invites?", text),
      clientPaymentVerified,
      clientRating: parseRating(text),
      clientReviewCount: parseCount("reviews?", text),
      clientSpend: parseClientSpend(text),
      clientHireRate: parseHireRate(text),
      clientAverageHourlyRate: null,
      countryOrTimezone: ""
    };
  }

  function parseJobCard(card) {
    const override = CARD_OVERRIDES.get(card) || {};
    const context = override.context || detectJobCardContext(card);
    const title =
      override.title ||
      firstText(card, titleSelectorsForContext(context)) ||
      textOf(jobLinkOf(card)) ||
      "Untitled job";
    return {
      ...commonFields(card, override.url || "", override.text),
      title,
      source: "list",
      context
    };
  }

  function elementValue(element) {
    if (!element) return "";
    return [
      element.getAttribute && element.getAttribute("href"),
      element.getAttribute && element.getAttribute("value"),
      "value" in element ? element.value : "",
      element.textContent
    ]
      .filter(Boolean)
      .join(" ");
  }

  function matchesCurrentJobId(element, currentJobId) {
    return Boolean(
      currentJobId &&
        element &&
        !element.closest(".uwe-sidebar, .uwe-card-panel, .uwe-badge") &&
        elementValue(element).includes(currentJobId)
    );
  }

  function detailRootCandidateScore(node, currentUrl) {
    if (!node || !node.querySelectorAll || node === node.ownerDocument.body) {
      return 0;
    }
    if (node.closest(".uwe-sidebar, .uwe-card-panel, .uwe-badge")) return 0;
    const text = textOf(node);
    if (text.length < 240 || text.length > 30000) return 0;

    let score = 0;
    if (/^(Summary|Job Description)\b/i.test(text)) score += 4;
    if (/\b(Summary|Job Description)\b/i.test(text)) score += 3;
    if (/Activity on this job|Proposals?\s*:/i.test(text)) score += 3;
    if (/About the client|Payment method|Payment verified|Payment not verified/i.test(text)) {
      score += 3;
    }
    if (/Send a proposal|Apply now|Job link/i.test(text)) score += 2;
    if (/Skills and Expertise|Required Skills|Mandatory skills/i.test(text)) score += 2;
    if (/\b(total spent|hire rate|reviews?|Interviewing|Invites sent)\b/i.test(text)) {
      score += 2;
    }
    if (firstDetailTitle(node, currentUrl)) score += 2;

    const jobLinks = jobLinksOf(node).length;
    if (jobLinks > 4) score -= Math.min(5, jobLinks - 4);
    return score >= 6 ? score : 0;
  }

  function detailRootFromCurrentJobId(doc) {
    if (!doc || !doc.querySelectorAll) return null;
    const currentUrl = documentUrl(doc);
    const currentJobId = extractJobIdFromUrl(currentUrl);
    if (!currentJobId) return null;

    const matches = Array.from(
      doc.querySelectorAll("a[href], input, textarea")
    ).filter((element) => matchesCurrentJobId(element, currentJobId));
    const seen = new Set();
    const candidates = [];

    matches.forEach((match) => {
      let node = match;
      for (let depth = 0; node && node !== doc.body && depth < 10; depth += 1) {
        if (!seen.has(node)) {
          seen.add(node);
          const score = detailRootCandidateScore(node, currentUrl);
          if (score) {
            candidates.push({
              node,
              score,
              textLength: textOf(node).length
            });
          }
        }
        node = node.parentElement;
      }
    });

    candidates.sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      return a.textLength - b.textLength;
    });
    return candidates[0] ? candidates[0].node : null;
  }

  function explicitDetailRootNode(doc) {
    if (!doc || !doc.querySelector) return null;
    return (
      doc.querySelector(".air3-slider-job-details .job-details-content") ||
      doc.querySelector(".air3-slider-job-details") ||
      doc.querySelector("[data-test='job-details']")
    );
  }

  function isSearchListUrl(url) {
    try {
      const parsed = new URL(url, "https://www.upwork.com");
      return /^\/nx\/search\/jobs(?:\/saved)?\/?$/.test(parsed.pathname);
    } catch (_) {
      return /\/nx\/search\/jobs(?:\/saved)?\/?(?:$|[?#])/i.test(
        String(url || "")
      );
    }
  }

  function findDetailRootNode(doc) {
    const currentUrl = documentUrl(doc);
    return (
      explicitDetailRootNode(doc) ||
      detailRootFromCurrentJobId(doc) ||
      (isDetailLikeUrl(currentUrl)
        ? doc.querySelector("[data-test*='job-detail']")
        : null) ||
      doc.querySelector("main") ||
      doc.body
    );
  }

  function isSliderDetailRoot(rootNode) {
    return Boolean(
      rootNode &&
        rootNode.matches &&
        (rootNode.matches(".air3-slider-job-details, .job-details-content") ||
          rootNode.closest(".air3-slider-job-details"))
    );
  }

  function isDetailLikeUrl(url) {
    const source = String(url || "");
    const detailPathPattern = /\/details\/~[A-Za-z0-9_]+(?:[/?#&]|$)/;
    try {
      const parsed = new URL(
        source,
        root.location && root.location.href
          ? root.location.href
          : "https://www.upwork.com/"
      );
      const detailSource = `${parsed.pathname}${parsed.search}`;
      return (
        /^\/jobs\/[^/?#]+\/?$/.test(parsed.pathname) ||
        detailPathPattern.test(detailSource)
      );
    } catch (_) {
      return (
        /^\/jobs\/[^/?#]+\/?$/.test(source) ||
        /^https?:\/\/[^/]+\/jobs\/[^/?#]+\/?$/.test(source) ||
        detailPathPattern.test(source)
      );
    }
  }

  function titleSelectorsForDetail(rootNode, currentUrl) {
    return isSliderDetailRoot(rootNode) || isDetailLikeUrl(currentUrl)
      ? ["h1", "h2", "h3", "h4", '[data-test*="job-title"]']
      : ["h1", '[data-test*="job-title"]'];
  }

  function isSectionHeading(value) {
    return /^(About the client|Activity on this job|Average bid amounts|Boost your proposal|Client's recent history|Cover letter|Hiring activity|Insights|Job details|Other open jobs|Project Type|Skills and Expertise|Your proposed terms)\b/i.test(
      value
    );
  }

  function firstDetailTitle(rootNode, currentUrl) {
    const selector = titleSelectorsForDetail(rootNode, currentUrl).join(", ");
    return Array.from(rootNode.querySelectorAll(selector))
      .filter((element) => !element.closest(".uwe-sidebar, .uwe-card-panel"))
      .map(textOf)
      .find((value) => value && !isSectionHeading(value)) || "";
  }

  function parseJobDetail(doc) {
    const rootNode = findDetailRootNode(doc);
    const currentUrl = documentUrl(doc);
    const documentTitle = cleanText(
      String(doc.title || "").replace(/\s*\|\s*Upwork.*/i, "")
    );
    const title =
      firstDetailTitle(rootNode, currentUrl) ||
      documentTitle ||
      firstText(rootNode, ['[data-cy*="job-title"]']);
    const fields = commonFields(rootNode, currentUrl);
    return {
      ...fields,
      jobId: extractJobIdFromUrl(currentUrl) || fields.jobId,
      url: currentUrl || fields.url,
      title: title || "Untitled job",
      source: "detail",
      context: "job"
    };
  }

  function documentUrl(doc) {
    if (root.location && root.location.href) return root.location.href;
    return doc && doc.location && doc.location.href ? doc.location.href : "";
  }

  function profileUrlFromDocument(doc) {
    const currentUrl = documentUrl(doc);
    if (/\/freelancers\/~[A-Za-z0-9]+/.test(currentUrl)) return currentUrl;

    const publicProfileLink =
      doc && doc.querySelector && doc.querySelector('a[href*="/freelancers/~"]');
    const href =
      publicProfileLink &&
      (publicProfileLink.getAttribute("href") || publicProfileLink.href);
    if (!href) return currentUrl;
    if (/^https?:\/\//i.test(href)) return href;
    if (href.startsWith("/")) return `https://www.upwork.com${href}`;

    try {
      return new URL(href, currentUrl || "https://www.upwork.com").toString();
    } catch (_) {
      return currentUrl;
    }
  }

  function titleProfileParts(doc) {
    const title = String((doc && doc.title) || "");
    const match = title.match(/^(.+?)\s+-\s+(.+?)\s+-\s+Upwork Freelancer/i);
    if (!match) return { name: "", title: "" };
    return {
      name: cleanText(match[1]),
      title: cleanText(match[2])
    };
  }

  function sectionBetween(text, startPattern, endPattern) {
    const source = String(text || "");
    const startMatch = source.match(startPattern);
    if (!startMatch || startMatch.index === undefined) return "";
    const start = startMatch.index + startMatch[0].length;
    const rest = source.slice(start);
    const endMatch = rest.match(endPattern);
    return cleanText(endMatch && endMatch.index !== undefined ? rest.slice(0, endMatch.index) : rest);
  }

  function parseProfileOverview(rootNode, fullText, hourlyRate, title) {
    const candidates = Array.from(
      rootNode.querySelectorAll(
        "[data-test*='overview'], [data-test*='description'], p"
      )
    )
      .map(textOf)
      .filter(
        (value) =>
          value.length >= 80 &&
          !/freelancer plus|profile visibility|boost your profile|project catalog/i.test(
            value
          )
      )
      .sort((a, b) => b.length - a.length);

    if (candidates[0]) return candidates[0].slice(0, 1800);

    let source = "";
    if (hourlyRate && fullText.includes(hourlyRate)) {
      source = fullText.slice(fullText.indexOf(hourlyRate) + hourlyRate.length);
    } else if (title && fullText.includes(title)) {
      source = fullText.slice(fullText.indexOf(title) + title.length);
    }

    return cleanText(
      source.split(/Portfolio|Work history|Skills|Your project catalog|Testimonials/i)[0]
    ).slice(0, 1800);
  }

  function parseProfileLanguages(fullText) {
    const names = [
      "English",
      "Chinese",
      "Japanese",
      "Spanish",
      "French",
      "German",
      "Portuguese",
      "Russian",
      "Korean",
      "Arabic"
    ];
    const pattern = new RegExp(
      `\\b(${names.join("|")}):\\s*([\\s\\S]{1,70}?)(?=\\b(?:${names.join(
        "|"
      )}):|Verifications|Licenses|Education|Linked accounts|$)`,
      "gi"
    );
    return Array.from(fullText.matchAll(pattern))
      .map((match) => `${match[1]}: ${cleanText(match[2])}`)
      .filter((value) => value.length <= 80)
      .slice(0, 10);
  }

  function parseProfilePortfolio(rootNode) {
    const containers = Array.from(
      rootNode.querySelectorAll(
        "[data-test*='portfolio'], [data-test*='project-catalog'], section"
      )
    ).filter((element) => {
      const text = textOf(element).slice(0, 180);
      return /portfolio|project catalog/i.test(text);
    });
    const items = [];
    const seen = new Set();

    containers.forEach((container) => {
      const candidates = Array.from(
        container.querySelectorAll(
          "[data-test*='portfolio-item'], [data-test*='project'], article, li"
        )
      ).filter((element) => element !== container);
      const itemNodes = candidates.length ? candidates : [container];

      itemNodes.forEach((item) => {
        const title = firstText(item, [
          "h3",
          "h4",
          "h5",
          "a[href]",
          "[data-test*='title']"
        ]);
        const description = textOf(item);
        const key = cleanText([title, description].join(" ")).slice(0, 180);
        if (!key || seen.has(key)) return;
        if (!/portfolio|project catalog/i.test(description) && !title) return;
        seen.add(key);
        items.push({
          title: title || cleanText(description).slice(0, 80),
          description: cleanText(description).slice(0, 1200),
          skills: parseSkills(item).slice(0, 12)
        });
      });
    });

    return items.slice(0, 12);
  }

  function parseProfileLocation(fullText) {
    const match = fullText.match(
      /([A-Z][A-Za-z\s.'-]+,\s*[A-Z][A-Za-z\s.'-]+)\s*[–-]\s*\d{1,2}:\d{2}/
    );
    return match ? cleanText(match[1].replace(/\s+,/g, ",")) : "";
  }

  function isLikelyProfilePage(doc) {
    const url = documentUrl(doc);
    if (/\/freelancers\/~[A-Za-z0-9]+/.test(url)) return true;
    if (doc && doc.querySelector && doc.querySelector('a[href*="/freelancers/~"]')) {
      return true;
    }
    const bodyText = textOf((doc && doc.body) || null).slice(0, 4000);
    return /Profile settings|See public view|Work history|Your project catalog/i.test(
      bodyText
    );
  }

  function parseFreelancerProfile(doc) {
    const rootNode =
      doc.querySelector("[data-test*='profile']") ||
      doc.querySelector("main") ||
      doc.body;
    const fullText = textOf(rootNode);
    const parts = titleProfileParts(doc);
    const hourlyRate = (fullText.match(/\$\s*\d+(?:\.\d+)?\s*\/hr/i) || [])[0] || "";
    const title =
      parts.title ||
      firstText(rootNode, [
        "[data-test*='title']",
        "h1",
        "h2",
        "[role='heading']"
      ]);
    const overview = parseProfileOverview(rootNode, fullText, hourlyRate, title);
    const snapshot = {
      name: parts.name || firstText(rootNode, ["h1"]) || "",
      title,
      overview,
      hourlyRate: cleanText(hourlyRate),
      skills: parseSkills(rootNode).slice(0, 30),
      portfolio: parseProfilePortfolio(rootNode),
      languages: parseProfileLanguages(fullText),
      location: parseProfileLocation(fullText),
      profileUrl: profileUrlFromDocument(doc),
      updatedAt: new Date().toISOString()
    };

    return {
      ...snapshot,
      summary: namespace.profileSummaryFromSnapshot
        ? namespace.profileSummaryFromSnapshot(snapshot)
        : [title, overview, snapshot.skills.join(", ")].filter(Boolean).join("\n")
    };
  }

  function findJobCards(doc) {
    const historyLinks = findClientHistoryLinks(doc);
    const links = jobLinksOf(doc);
    const cards = [...historyLinks];
    const seen = new Set(historyLinks);
    links.forEach((link) => {
      if (seen.has(link) || link.closest(".uwe-card-panel, .uwe-sidebar")) return;
      if (contextForLink(link) === "history") return;
      const card = link.closest(
        "[data-test='job-tile'], [data-test*='job-tile'], [data-ev-job-uid], article, section, .up-card, .air3-card"
      );
      if (!card || seen.has(card)) return;
      if (detectJobCardContext(card) === "history" && countJobLinks(card) > 1) {
        return;
      }
      const text = textOf(card);
      if (text.length < 80) return;
      seen.add(card);
      cards.push(card);
    });
    return cards.slice(0, 100);
  }

  function isLikelyDetailPage(doc) {
    const currentUrl = documentUrl(doc);
    const urlLooksDetail = isDetailLikeUrl(currentUrl);
    const explicitRoot = explicitDetailRootNode(doc);
    const currentJobRoot = detailRootFromCurrentJobId(doc);
    const hasDetailContext = Boolean(
      urlLooksDetail ||
        currentJobRoot ||
        (explicitRoot &&
          (isSliderDetailRoot(explicitRoot) || !isSearchListUrl(currentUrl)))
    );
    const rootNode =
      currentJobRoot || explicitRoot || (urlLooksDetail ? findDetailRootNode(doc) : null);
    const hasDomTitle = Boolean(rootNode && firstDetailTitle(rootNode, currentUrl));
    const hasDocumentTitle = Boolean(
      hasDetailContext &&
        cleanText(doc.title).length >= 12 &&
        !/Upwork\s*$/i.test(cleanText(doc.title)) &&
        !/Freelancer from/i.test(cleanText(doc.title))
    );
    const hasTitle = hasDomTitle || hasDocumentTitle;
    const hasDetailText = /payment verified|proposals?|fixed-price|hourly|client/i.test(
      textOf(rootNode || doc.querySelector("main") || doc.body)
    );
    return hasDetailContext && hasTitle && hasDetailText;
  }

  const api = {
    cleanText,
    extractJobIdFromUrl,
    classifyJobCardContextText,
    detectJobCardContext,
    parseJobCard,
    parseJobDetail,
    parseProposalQuestions,
    parseProposalSignal,
    findDetailRootNode,
    findJobCards,
    isDetailLikeUrl,
    isSearchListUrl,
    isLikelyDetailPage,
    isLikelyProfilePage,
    parseFreelancerProfile
  };

  root.UpworkEnhancer = { ...namespace, ...api };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
