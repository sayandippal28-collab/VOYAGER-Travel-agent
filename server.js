const express = require("express");
const cors = require("cors");
const fetch = (...args) => import('node-fetch').then(({ default: fetch }) => fetch(...args));

require("dotenv").config();

const app = express();
const PORT = 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("."));

const API_KEY = process.env.OPENAI_API_KEY;
console.log("🔑 OpenAI API Key:", API_KEY ? "Loaded ✅" : "Missing ❌");

// ── Core OpenAI call ──
async function callOpenAI(messages, maxTokens = 2048) {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${API_KEY}`
        },
        body: JSON.stringify({
            model: "gpt-4o-mini",  // cheap, fast, very capable
            messages,
            max_tokens: maxTokens,
            temperature: 0.7
        })
    });

    if (!response.ok) {
        const err = await response.json();
        console.error("❌ OpenAI error:", response.status, JSON.stringify(err));
        throw new Error(`OpenAI API error: ${response.status} — ${err?.error?.message}`);
    }

    const data = await response.json();
    return data?.choices?.[0]?.message?.content;
}

// Health
app.get("/health", (req, res) => {
    res.json({ status: "ok", openai: API_KEY ? "connected" : "not configured" });
});

// Generate itinerary
app.post("/generate", async (req, res) => {
    try {
        const { prompt } = req.body;

        if (!prompt || prompt.length < 3) {
            return res.json({ success: false, error: "Enter a valid prompt" });
        }

        // Mock fallback when no API key
        if (!API_KEY) {
            console.log("⚠️ No API key — using MOCK data");
            const mock = {
                destination: "Paris, France",
                duration: "3 days",
                budgetLevel: "Moderate",
                highlights: ["Eiffel Tower", "Louvre Museum", "Seine River"],
                itinerary: [
                    { day: 1, theme: "Iconic Paris", morning: "Visit the Eiffel Tower at sunrise", afternoon: "Explore the Louvre Museum", evening: "Dinner cruise on the Seine" },
                    { day: 2, theme: "Art & Culture", morning: "Stroll through Montmartre", afternoon: "Visit Musée d'Orsay", evening: "Café hopping in Saint-Germain" },
                    { day: 3, theme: "Hidden Gems", morning: "Explore Le Marais district", afternoon: "Visit Sainte-Chapelle", evening: "Farewell dinner at a bistro" }
                ]
            };
            return res.json({ success: true, itinerary: JSON.stringify(mock) });
        }

        console.log("📍 Generating itinerary for:", prompt);

        const rawText = await callOpenAI([
            {
                role: "system",
                content: `You are a travel planner. Return ONLY a valid JSON object. No markdown, no backticks, no explanation — pure JSON only.

Schema:
{
  "destination": "City, Country",
  "duration": "X days",
  "budgetLevel": "Budget | Moderate | Luxury",
  "highlights": ["highlight1", "highlight2", "highlight3"],
  "itinerary": [
    {
      "day": 1,
      "theme": "Theme name",
      "morning": "Morning activity description",
      "afternoon": "Afternoon activity description",
      "evening": "Evening activity description"
    }
  ]
}

Output ONLY the JSON object. Start with { and end with }.`
            },
            {
                role: "user",
                content: prompt
            }
        ]);

        // Robust JSON extraction
        const firstBrace = rawText.indexOf('{');
        const lastBrace = rawText.lastIndexOf('}');

        if (firstBrace === -1 || lastBrace === -1) {
            console.error("❌ No JSON found in response:", rawText);
            return res.json({ success: false, error: "AI response was not valid JSON" });
        }

        let parsed;
        try {
            parsed = JSON.parse(rawText.slice(firstBrace, lastBrace + 1));
        } catch (e) {
            console.error("❌ JSON parse failed:", e.message);
            return res.json({ success: false, error: "AI returned malformed JSON" });
        }

        if (!parsed.destination || !parsed.itinerary) {
            return res.json({ success: false, error: "AI response missing required fields" });
        }

        console.log(`✅ Itinerary ready for: ${parsed.destination}`);
        res.json({ success: true, itinerary: JSON.stringify(parsed) });

    } catch (err) {
        console.error("❌ Error:", err.message);
        res.json({ success: false, error: err.message || "Failed to generate itinerary" });
    }
});

// Chat assistant
app.post("/chat", async (req, res) => {
    try {
        const { message, history } = req.body;

        if (!message) return res.json({ success: false, error: "No message provided" });

        if (!API_KEY) {
            return res.json({ success: true, reply: "I'm VOYAGER! (Mock mode — add OpenAI API key to .env for real answers.)" });
        }

        const messages = [
            { role: "system", content: "You are VOYAGER, a helpful and friendly travel assistant. Answer travel questions concisely. If asked about non-travel topics, gently redirect to travel." },
            ...(history || []).map(h => ({ role: h.role === "model" ? "assistant" : h.role, content: h.text })),
            { role: "user", content: message }
        ];

        const reply = await callOpenAI(messages, 512);

        if (!reply) return res.json({ success: false, error: "No response from AI" });

        res.json({ success: true, reply });

    } catch (err) {
        console.error("❌ Chat error:", err.message);
        res.json({ success: false, error: err.message || "Chat failed" });
    }
});

// Root
app.get("/", (req, res) => {
    res.sendFile("index.html", { root: "." });
});

app.listen(PORT, () => {
    console.log(`\n🚀 Server running at http://localhost:${PORT}`);
    console.log(`🔑 OpenAI: ${API_KEY ? "Connected ✅" : "NOT configured ⚠️"}\n`);
});
