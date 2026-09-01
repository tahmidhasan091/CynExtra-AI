"use strict";

/**
 * Website Search for CynExtra-AI
 * Keys stay on the server. Frontend never sees them.
 */

async function searchDuckDuckGo(query, limit = 5) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "CynExtra-AI/2.0" },
    signal: AbortSignal.timeout(12000)
  });
  if (!res.ok) {
    throw new Error("DuckDuckGo search failed.");
  }
  const data = await res.json();
  const results = [];

  if (data.AbstractText) {
    results.push({
      title: data.Heading || "Summary",
      snippet: data.AbstractText,
      url: data.AbstractURL || ""
    });
  }

  const related = Array.isArray(data.RelatedTopics) ? data.RelatedTopics : [];
  for (const item of related) {
    if (results.length >= limit) break;
    if (item.Text && item.FirstURL) {
      results.push({
        title: item.Text.slice(0, 80),
        snippet: item.Text,
        url: item.FirstURL
      });
    } else if (Array.isArray(item.Topics)) {
      for (const sub of item.Topics) {
        if (results.length >= limit) break;
        if (sub.Text && sub.FirstURL) {
          results.push({
            title: sub.Text.slice(0, 80),
            snippet: sub.Text,
            url: sub.FirstURL
          });
        }
      }
    }
  }

  return results.slice(0, limit);
}

async function searchSerper(query, limit = 5) {
  const key = process.env.SERPER_API_KEY?.trim();
  if (!key) throw new Error("SERPER_API_KEY is not configured.");

  const res = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": key
    },
    body: JSON.stringify({ q: query, num: limit }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) throw new Error("Serper search failed.");
  const data = await res.json();
  const organic = Array.isArray(data.organic) ? data.organic : [];
  return organic.slice(0, limit).map((r) => ({
    title: r.title || "",
    snippet: r.snippet || "",
    url: r.link || ""
  }));
}

async function searchTavily(query, limit = 5) {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) throw new Error("TAVILY_API_KEY is not configured.");

  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: key,
      query,
      max_results: limit,
      include_answer: false
    }),
    signal: AbortSignal.timeout(15000)
  });

  if (!res.ok) throw new Error("Tavily search failed.");
  const data = await res.json();
  const results = Array.isArray(data.results) ? data.results : [];
  return results.slice(0, limit).map((r) => ({
    title: r.title || "",
    snippet: r.content || "",
    url: r.url || ""
  }));
}

async function webSearch(query, options = {}) {
  const q = String(query || "").trim();
  if (!q) {
    return { success: false, error: "Search query is required.", results: [] };
  }
  if (q.length > 500) {
    return { success: false, error: "Search query is too long.", results: [] };
  }

  const limit = Math.min(Math.max(Number(options.limit) || 5, 1), 10);
  const configuredProvider = (process.env.SEARCH_PROVIDER || "duckduckgo").toLowerCase();
  // Paid/search-key providers gracefully fall back to DuckDuckGo when no key
  // is configured, keeping the free setup usable without exposing secrets.
  const provider =
    configuredProvider === "serper" && !process.env.SERPER_API_KEY?.trim()
      ? "duckduckgo"
      : configuredProvider === "tavily" && !process.env.TAVILY_API_KEY?.trim()
        ? "duckduckgo"
        : configuredProvider;

  try {
    let results = [];
    if (provider === "serper") {
      results = await searchSerper(q, limit);
    } else if (provider === "tavily") {
      results = await searchTavily(q, limit);
    } else {
      results = await searchDuckDuckGo(q, limit);
    }

    return {
      success: true,
      provider,
      query: q,
      results
    };
  } catch (error) {
    console.error("Web search error:", error.message);
    return {
      success: false,
      error: "Website search is temporarily unavailable.",
      results: []
    };
  }
}

function shouldAutoSearch(query) {
  const q = String(query || "").trim();
  if (!q || q.length < 4) return false;
  return /\b(latest|today|tonight|current|currently|now|recent|recently|news|weather|score|price|stock|exchange rate|release|version|update|2026|২০২৬|আজ|এখন|সাম্প্রতিক|খবর|দাম|আবহাওয়া)\b/i.test(q);
}

function formatSearchForPrompt(searchResult) {
  if (!searchResult?.success || !searchResult.results?.length) {
    return "";
  }
  const lines = searchResult.results.map(
    (r, i) =>
      `${i + 1}. ${r.title}\n   ${r.snippet}\n   Source: ${r.url || "N/A"}`
  );
  return `[Web search results for: "${searchResult.query}"]\n${lines.join("\n\n")}`;
}

module.exports = {
  webSearch,
  shouldAutoSearch,
  formatSearchForPrompt
};
