import express from "express";
import crypto from "crypto";

const app = express();

// Capture raw body for signature verification
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}));

// ===== SECRETS =====
const RETELL_SECRET = "key_7f7068e4cd60b69325a912db425a";
const PIPEDRIVE_API_KEY = "5c84f2d40d96dfc8035ed24f2531bc2480e4121e";

// ===== TEST ROUTES =====
app.get("/", (req, res) => {
  res.send("Server is running");
});

app.get("/webhook/retell", (req, res) => {
  res.send("Webhook route exists");
});

// ===== VERIFY SIGNATURE =====
function verifySignature(rawBody, signature) {
  try {
    if (!rawBody || !signature) return false;

    const expected = crypto
      .createHmac("sha256", RETELL_SECRET)
      .update(rawBody)
      .digest("hex");

    return signature === expected;
  } catch (e) {
    console.log("Signature error:", e);
    return false;
  }
}

// ===== PIPEDRIVE REQUEST =====
async function pdRequest(url, method, body) {
  const res = await fetch(
    `https://api.pipedrive.com/v1${url}?api_token=${PIPEDRIVE_API_KEY}`,
    {
      method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined
    }
  );

  const data = await res.json();

  if (!res.ok) {
    console.error("Pipedrive error:", data);
    return null;
  }

  return data;
}

// ===== CREATE PERSON =====
async function createPerson(name, email, phone) {
  const res = await pdRequest("/persons", "POST", {
    name: name || "Unknown",
    email: email ? [{ value: email }] : undefined,
    phone: phone ? [{ value: phone }] : undefined
  });

  return res?.data?.id;
}

// ===== CREATE LEAD =====
async function createLead(personId, summary) {
  const res = await pdRequest("/leads", "POST", {
    title: "Retell Lead",
    person_id: personId,
    note: summary || "No summary"
  });

  return res?.data?.id;
}

// ===== CREATE NOTE =====
async function createNote(personId, leadId, summary) {
  await pdRequest("/notes", "POST", {
    content: summary || "No details",
    person_id: personId,
    lead_id: leadId
  });
}

// ===== MAIN WEBHOOK =====
app.post("/webhook/retell", async (req, res) => {
  try {
    const signature = req.headers["x-retell-signature"];

    // Allow manual test
    if (!signature) {
      console.log("Test request");
      return res.status(200).send("OK");
    }

    // Verify signature
    if (!verifySignature(req.rawBody, signature)) {
      console.log("Invalid signature");
      return res.status(401).send("Invalid signature");
    }

    // Respond immediately
    res.status(200).send("OK");

    const { event, call } = req.body || {};

    console.log("EVENT:", event);

    if (event !== "call_analyzed" || !call) return;

    const analysis = call.call_analysis || {};

    const name = analysis.lead_name || "Unknown";
    const email = analysis.email || "";
    const phone = analysis.phone_number || call.from_number || "";
    const summary = analysis.call_summary || "No summary";

    // Create Pipedrive data
    const personId = await createPerson(name, email, phone);
    const leadId = await createLead(personId, summary);

    await createNote(personId, leadId, summary);

    console.log("SUCCESS: Lead created");

  } catch (err) {
    console.error("ERROR:", err);
  }
});

// ===== IMPORTANT: RAILWAY PORT FIX =====
const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});
