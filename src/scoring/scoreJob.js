(function attachScoring(root) {
  const namespace = root.UpworkEnhancer || {};
  const normalizeSettings =
    namespace.normalizeSettings ||
    ((settings) => settings || {});

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  function normalizeText(value) {
    return String(value || "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  function includesPhrase(haystack, phrase) {
    const normalizedPhrase = normalizeText(phrase);
    return Boolean(normalizedPhrase && haystack.includes(normalizedPhrase));
  }

  function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
  }

  function toNumber(value) {
    if (value === null || value === undefined || value === "") return null;
    if (typeof value === "number") return Number.isFinite(value) ? value : null;
    const text = String(value).replace(/[$,%\s,]/g, "");
    if (!text) return null;
    const multiplier = /k$/i.test(text) ? 1000 : /m$/i.test(text) ? 1000000 : 1;
    const parsed = Number(text.replace(/[km]$/i, ""));
    return Number.isFinite(parsed) ? parsed * multiplier : null;
  }

  function reason(key, params) {
    return { key, params: params || {} };
  }

  function countRequirements(text) {
    const signals = [
      "must",
      "required",
      "expert",
      "senior",
      "full stack",
      "figma",
      "backend",
      "frontend",
      "api",
      "database",
      "scraping",
      "automation",
      "extension",
      "ai",
      "authentication",
      "payment"
    ];
    return signals.reduce(
      (count, signal) => count + (text.includes(signal) ? 1 : 0),
      0
    );
  }

  function getBudgetSignals(job) {
    const hourlyMin = toNumber(job.hourlyMin);
    const hourlyMax = toNumber(job.hourlyMax);
    const fixedBudget = toNumber(job.fixedBudget);
    return {
      hourlyMin,
      hourlyMax,
      hourlyBest: hourlyMax || hourlyMin,
      fixedBudget
    };
  }

  function scoreJob(jobInput, settingsInput) {
    const job = jobInput || {};
    const settings = normalizeSettings(settingsInput || namespace.DEFAULT_SETTINGS);
    const text = normalizeText(
      [
        job.title,
        job.description,
        Array.isArray(job.skills) ? job.skills.join(" ") : job.skills,
        job.experienceLevel
      ].join(" ")
    );
    const skillText = normalizeText(
      Array.isArray(job.skills) ? job.skills.join(" ") : job.skills
    );
    const budget = getBudgetSignals(job);

    const positiveReasons = [];
    const negativeReasons = [];
    const riskNotes = [];
    const missingSignals = [];

    const preferredSkillMatches = unique(
      settings.preferredSkills.filter(
        (skill) => includesPhrase(text, skill) || includesPhrase(skillText, skill)
      )
    );
    const avoidedSkillMatches = unique(
      settings.avoidedSkills.filter((skill) => includesPhrase(text, skill))
    );
    const projectTypeMatches = unique(
      settings.preferredProjectTypes.filter((type) => includesPhrase(text, type))
    );
    const blacklistedMatches = unique(
      settings.blacklistedPhrases.filter((phrase) => includesPhrase(text, phrase))
    );

    let matchScore = 50;
    if (preferredSkillMatches.length) {
      matchScore += Math.min(32, preferredSkillMatches.length * 8);
      positiveReasons.push(
        reason("reason.preferredSkillMatch", {
          skills: preferredSkillMatches.slice(0, 5)
        })
      );
    } else {
      matchScore -= 10;
      negativeReasons.push(reason("reason.noPreferredSkillMatch"));
    }

    if (projectTypeMatches.length) {
      matchScore += 10;
      positiveReasons.push(
        reason("reason.projectTypeMatch", {
          types: projectTypeMatches.slice(0, 3)
        })
      );
    }

    if (budget.hourlyBest !== null) {
      if (budget.hourlyBest >= settings.minimumHourlyRate) {
        matchScore += 10;
        positiveReasons.push(reason("reason.hourlyStrong"));
      } else {
        matchScore -= 16;
        negativeReasons.push(reason("reason.hourlyWeak"));
      }
    } else if (budget.fixedBudget !== null) {
      if (budget.fixedBudget >= settings.minimumFixedBudget) {
        matchScore += 10;
        positiveReasons.push(reason("reason.fixedStrong"));
      } else {
        matchScore -= 16;
        negativeReasons.push(reason("reason.fixedWeak"));
      }
    } else {
      matchScore -= 5;
      missingSignals.push(reason("reason.missingBudget"));
    }

    if (avoidedSkillMatches.length) {
      matchScore -= Math.min(25, avoidedSkillMatches.length * 10);
      negativeReasons.push(
        reason("reason.avoidedSkill", {
          skills: avoidedSkillMatches.slice(0, 4)
        })
      );
    }

    if (blacklistedMatches.length) {
      matchScore -= 24;
      riskNotes.push(
        reason("reason.blacklistedPhrase", {
          phrases: blacklistedMatches.slice(0, 4)
        })
      );
    }

    let clientQualityScore = 50;
    if (job.clientPaymentVerified === true) {
      clientQualityScore += 15;
      positiveReasons.push(reason("reason.paymentVerified"));
    } else if (job.clientPaymentVerified === false) {
      clientQualityScore -= 12;
      negativeReasons.push(reason("reason.paymentUnclear"));
    } else {
      clientQualityScore -= 5;
      missingSignals.push(reason("reason.paymentUnclear"));
    }

    const rating = toNumber(job.clientRating);
    if (rating !== null) {
      if (rating >= 4.8) {
        clientQualityScore += 15;
        positiveReasons.push(reason("reason.ratingStrong"));
      } else if (rating >= 4.5) {
        clientQualityScore += 8;
      } else if (rating < 4) {
        clientQualityScore -= 18;
        negativeReasons.push(reason("reason.ratingWeak"));
      }
    }

    const spend = toNumber(job.clientSpend);
    if (spend !== null) {
      if (spend >= 10000) {
        clientQualityScore += 15;
        positiveReasons.push(reason("reason.spendStrong"));
      } else if (spend < 500) {
        clientQualityScore -= 12;
        negativeReasons.push(reason("reason.spendWeak"));
      }
    } else {
      missingSignals.push(reason("reason.missingClientInfo"));
    }

    const hireRate = toNumber(job.clientHireRate);
    if (hireRate !== null) {
      if (hireRate >= 60) {
        clientQualityScore += 8;
        positiveReasons.push(reason("reason.hireRateStrong"));
      } else if (hireRate < 35) {
        clientQualityScore -= 12;
        negativeReasons.push(reason("reason.hireRateWeak"));
      }
    }

    let competitionScore = 60;
    const proposalCount = toNumber(job.proposalCount);
    if (proposalCount !== null) {
      if (proposalCount <= 5) {
        competitionScore += 20;
        positiveReasons.push(reason("reason.lowCompetition"));
      } else if (proposalCount <= 15) {
        competitionScore += 8;
      } else if (proposalCount >= 50) {
        competitionScore -= 30;
        negativeReasons.push(reason("reason.highCompetition"));
      } else if (proposalCount >= 20) {
        competitionScore -= 16;
        negativeReasons.push(reason("reason.highCompetition"));
      }
    } else {
      missingSignals.push(reason("reason.missingCompetition"));
    }

    const postedAgeHours = toNumber(job.postedAgeHours);
    if (postedAgeHours !== null) {
      if (postedAgeHours <= 12) {
        competitionScore += 10;
        positiveReasons.push(reason("reason.freshPost"));
      } else if (postedAgeHours >= 168) {
        competitionScore -= 20;
        negativeReasons.push(reason("reason.stalePost"));
      }
    }

    const interviewCount = toNumber(job.interviewCount);
    if (interviewCount !== null && interviewCount > 0) {
      competitionScore -= interviewCount >= 4 ? 15 : 7;
      negativeReasons.push(reason("reason.activeInterviewing"));
    }

    let riskPenalty = 15;
    if (blacklistedMatches.length) riskPenalty += 30;
    if (includesPhrase(text, "outside upwork") || includesPhrase(text, "telegram") || includesPhrase(text, "whatsapp")) {
      riskPenalty += 32;
      riskNotes.push(reason("reason.offPlatform"));
    }
    if (includesPhrase(text, "unpaid test") || includesPhrase(text, "free sample")) {
      riskPenalty += 35;
      riskNotes.push(reason("reason.unpaidTest"));
    }
    if (
      includesPhrase(text, "various tasks") ||
      includesPhrase(text, "many things") ||
      includesPhrase(text, "everything") ||
      includesPhrase(text, "asap")
    ) {
      riskPenalty += 14;
      riskNotes.push(reason("reason.vagueScope"));
    }
    if (
      budget.fixedBudget !== null &&
      budget.fixedBudget < settings.minimumFixedBudget &&
      countRequirements(text) >= 5
    ) {
      riskPenalty += 18;
      riskNotes.push(reason("reason.unrealisticBudget"));
    }
    if (
      budget.hourlyBest !== null &&
      budget.hourlyBest < settings.minimumHourlyRate &&
      countRequirements(text) >= 5
    ) {
      riskPenalty += 18;
      riskNotes.push(reason("reason.unrealisticBudget"));
    }

    const riskScore = clamp(100 - riskPenalty, 0, 100);
    const riskLevel = riskScore >= 75 ? "low" : riskScore >= 55 ? "medium" : "high";

    matchScore = clamp(Math.round(matchScore), 0, 100);
    clientQualityScore = clamp(Math.round(clientQualityScore), 0, 100);
    competitionScore = clamp(Math.round(competitionScore), 0, 100);

    const overallScore = Math.round(
      matchScore * settings.weights.match +
        clientQualityScore * settings.weights.clientQuality +
        competitionScore * settings.weights.competition +
        riskScore * settings.weights.risk
    );

    let recommendedAction = "maybe";
    if (
      riskLevel === "high" ||
      blacklistedMatches.length ||
      overallScore < settings.thresholds.pass
    ) {
      recommendedAction = "pass";
    } else if (
      overallScore >= settings.thresholds.apply &&
      riskLevel === "low" &&
      !missingSignals.length
    ) {
      recommendedAction = "apply";
    } else if (overallScore >= settings.thresholds.watch && missingSignals.length) {
      recommendedAction = "watch";
    } else if (overallScore >= settings.thresholds.watch) {
      recommendedAction = "maybe";
    }

    return {
      jobId: job.jobId || job.url || "",
      overallScore,
      matchScore,
      clientQualityScore,
      competitionScore,
      riskScore,
      riskLevel,
      recommendedAction,
      positiveReasons: uniqueReasons(positiveReasons).slice(0, 6),
      negativeReasons: uniqueReasons(negativeReasons).slice(0, 6),
      riskNotes: uniqueReasons(riskNotes).slice(0, 6),
      missingSignals: uniqueReasons(missingSignals).slice(0, 6)
    };
  }

  function uniqueReasons(reasons) {
    const seen = new Set();
    return reasons.filter((item) => {
      const key = JSON.stringify(item);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  const api = { scoreJob };
  root.UpworkEnhancer = { ...namespace, ...api };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : window);
